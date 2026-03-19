package com.hyliankid14.bbcradioplayer.workers

import android.content.Context
import android.util.Log
import com.hyliankid14.bbcradioplayer.Episode
import com.hyliankid14.bbcradioplayer.EpisodeDateParser
import com.hyliankid14.bbcradioplayer.IndexPreference
import com.hyliankid14.bbcradioplayer.Podcast
import com.hyliankid14.bbcradioplayer.PodcastEpisodeNotifier
import com.hyliankid14.bbcradioplayer.PodcastSubscriptions
import com.hyliankid14.bbcradioplayer.RemoteIndexClient
import com.hyliankid14.bbcradioplayer.db.IndexStore
import com.hyliankid14.bbcradioplayer.PodcastRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.isActive

/**
 * IndexWorker: performs an on-disk FTS index build for podcasts and episodes using SQLite FTS4.
 * Implemented without Room to avoid KAPT dependency issues.
 */
object IndexWorker {
    private const val TAG = "IndexWorker"

    /**
     * Compute a monotonic overall percent for episode-indexing by giving each podcast an
     * equal slice of the 6..99% range. Designed to be lightweight (no extra network I/O)
     * and predictable so the UI never moves backwards when later podcasts add more
     * episodes than earlier ones.
     *
     * Parameters are 0-based podcastIndex, total podcastsCount, number processed in the
     * current podcast and the current podcast's episode count. Returns an int in [6,99].
     */
    internal fun computeOverallEpisodePercent(podcastIndex: Int, podcastsCount: Int, processedInPodcast: Int, podcastEpisodeCount: Int): Int {
        if (podcastsCount <= 0) return 100
        // Start episode-phase just after the initial podcast-listing step (5%), so the
        // UI moves smoothly from left->right without jumping. Map episodes into 6..99.
        val base = 6.0
        val totalRange = 93.0 // map episodes to 6..99
        val weightPerPodcast = totalRange / podcastsCount.toDouble()
        val idx = podcastIndex.coerceIn(0, podcastsCount - 1)
        val perPodcastProgress = if (podcastEpisodeCount <= 0) 1.0 else (processedInPodcast.toDouble() / podcastEpisodeCount.toDouble()).coerceIn(0.0, 1.0)
        val pct = base + (idx * weightPerPodcast) + (perPodcastProgress * weightPerPodcast)
        return pct.toInt().coerceIn(6, 99)
    }

    /**
     * Compute a simple, monotonic per-podcast completion percent mapped into 6..99.
     * This advances only when a podcast is fully indexed so the UI progress moves
     * steadily from left->right as podcasts complete.
     */
    internal fun computePodcastCompletePercent(podcastIndexZeroBased: Int, podcastsCount: Int): Int {
        if (podcastsCount <= 0) return 100
        // Match the episode-phase mapping into 6..99 so per-podcast completion advances
        // smoothly from the episode base to the end.
        val base = 6
        val end = 99
        val idx = (podcastIndexZeroBased + 1).coerceIn(1, podcastsCount) // 1..N
        val pct = base + ((idx * (end - base)) / podcastsCount)
        return pct.coerceIn(base, end)
    }

    suspend fun reindexAll(context: Context, onProgress: (String, Int, Boolean) -> Unit = { _, _, _ -> }) {
        withContext(Dispatchers.IO) {
            try {
                onProgress("Starting index...", -1, false)

                // Download pre-built index from GCS (or GitHub Pages fallback).
                // Always force a fresh download for full reindex (user initiated or first install).
                val remoteClient = RemoteIndexClient(context)
                val downloadedIndex = try {
                    remoteClient.downloadIndex(forceDownload = true) { msg, pct ->
                        onProgress(msg, pct, false)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Remote index download failed: ${e.message}")
                    null
                }

                if (downloadedIndex == null) {
                    onProgress("Index download failed. Please check your internet connection.", -1, false)
                    Log.e(TAG, "Unable to download index from remote source")
                    return@withContext
                }

                if (!isActive) return@withContext

                val store = IndexStore.getInstance(context)
                val podcasts = downloadedIndex.podcasts
                val episodes = downloadedIndex.episodes
                Log.d(TAG, "Applying downloaded index: ${podcasts.size} podcasts, ${episodes.size} episodes")

                // Clear old local index before applying new remote index
                onProgress("Clearing old index...", 19, false)
                try {
                    store.clearAllEpisodes()
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to clear old episode index: ${e.message}")
                }

                onProgress("Applying ${podcasts.size} podcasts...", 20, false)
                store.replaceAllPodcasts(podcasts)

                // Insert episodes in bounded batches with smooth progress reporting.
                val batchSize = 500
                var inserted = 0
                for (batch in episodes.chunked(batchSize)) {
                    if (!isActive) break
                    try {
                        store.appendEpisodesBatch(batch)
                    } catch (oom: OutOfMemoryError) {
                        for (small in batch.chunked(50)) store.appendEpisodesBatch(small)
                    }
                    inserted += batch.size
                    val pct = if (episodes.isEmpty()) 99 else (20 + (inserted * 79) / episodes.size).coerceIn(20, 99)
                    onProgress("Indexing episodes... ($inserted/${episodes.size})", pct, true)
                    try { Thread.yield() } catch (_: Throwable) {}
                }

                onProgress(
                    "Index complete: ${podcasts.size} podcasts, $inserted episodes " +
                    "(from ${downloadedIndex.generatedAt})",
                    100, false
                )
                Log.d(TAG, "Reindex from remote source complete: podcasts=${podcasts.size}, episodes=$inserted")
                try { store.setLastReindexTime(System.currentTimeMillis()) } catch (e: Exception) {
                    Log.w(TAG, "Failed to persist last reindex time: ${e.message}")
                }
                if (downloadedIndex.generatedAt.isNotBlank()) {
                    try { IndexPreference.setLastGeneratedAt(context, downloadedIndex.generatedAt) } catch (e: Exception) {
                        Log.w(TAG, "Failed to persist last generated_at: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Reindex failed", e)
                onProgress("Index failed: ${e.message}", -1, false)
            }
        }
    }

    /**
     * Incremental indexing: only index new podcasts and episodes not currently present
     * in the on-disk FTS index. Designed for scheduled runs to keep the index fresh
     * without performing a full rebuild.
     */
    suspend fun reindexNewOnly(context: Context, onProgress: (String, Int, Boolean) -> Unit = { _, _, _ -> }) {
        withContext(Dispatchers.IO) {
            try {
                onProgress("Starting incremental index...", -1, false)

                val remoteClient = RemoteIndexClient(context)

                // Compare the remote index's generated_at against the last
                // successfully applied value.  This fetches only the tiny
                // companion metadata file (~200 bytes) before committing to
                // a full 250 MB+ download.
                val lastGeneratedAt = IndexPreference.getLastGeneratedAt(context)
                val isNewer = remoteClient.isRemoteIndexNewer(lastGeneratedAt)
                if (!isNewer) {
                    onProgress("Podcast index is up to date — skipping download", 100, false)
                    return@withContext
                }

                val downloadedIndex = try {
                    // Force a fresh download: isRemoteIndexNewer() confirmed the remote
                    // is newer than our last applied index, so bypass the disk cache.
                    remoteClient.downloadIndex(forceDownload = true) { msg, pct ->
                        onProgress(msg, pct, false)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Remote index download failed: ${e.message}")
                    null
                }

                if (downloadedIndex == null) {
                    onProgress("Index download failed. Please check your internet connection.", -1, false)
                    Log.e(TAG, "Unable to download index from remote source")
                    return@withContext
                }

                if (!isActive) return@withContext

                val store = IndexStore.getInstance(context)
                val podcasts = downloadedIndex.podcasts
                val episodes = downloadedIndex.episodes

                // Upsert all podcasts from the downloaded index
                var newPodcasts = 0
                for (p in podcasts) {
                    if (!isActive) break
                    val had = store.hasPodcast(p.id)
                    try {
                        store.upsertPodcast(p)
                        if (!had) newPodcasts++
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to upsert podcast ${p.id}: ${e.message}")
                    }
                }

                // Append only episodes not already indexed
                val newEpisodes = mutableListOf<Episode>()
                // Group by podcastId to batch the existing-ID lookups
                val byPodcast = episodes.groupBy { it.podcastId }
                for ((podcastId, eps) in byPodcast) {
                    if (!isActive) break
                    val existingIds = try { store.getEpisodeIdsForPodcast(podcastId) } catch (_: Exception) { emptySet() }
                    newEpisodes.addAll(eps.filter { it.id.isNotBlank() && !existingIds.contains(it.id) })
                }

                var inserted = 0
                for (batch in newEpisodes.chunked(500)) {
                    if (!isActive) break
                    try { store.appendEpisodesBatch(batch) } catch (oom: OutOfMemoryError) {
                        for (small in batch.chunked(50)) store.appendEpisodesBatch(small)
                    }
                    inserted += batch.size
                    onProgress("Indexing new episodes... ($inserted/${newEpisodes.size})", -1, true)
                    try { Thread.yield() } catch (_: Throwable) {}
                }

                // Notify subscribers about genuinely new episodes (only those added since
                // the previous index update). Also advances lastSeenId so that
                // SubscriptionRefreshReceiver does not re-fire a duplicate notification.
                notifyNewEpisodesForSubscriptions(context, podcasts, episodes, newEpisodes)

                onProgress(
                    "Incremental index complete: newPodcasts=$newPodcasts, newEpisodes=$inserted",
                    100, false
                )
                Log.d(TAG, "Incremental reindex from remote source: newPodcasts=$newPodcasts, newEpisodes=$inserted")
                try { store.setLastReindexTime(System.currentTimeMillis()) } catch (e: Exception) {
                    Log.w(TAG, "Failed to persist last reindex time: ${e.message}")
                }
                if (downloadedIndex.generatedAt.isNotBlank()) {
                    try { IndexPreference.setLastGeneratedAt(context, downloadedIndex.generatedAt) } catch (e: Exception) {
                        Log.w(TAG, "Failed to persist last generated_at: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Incremental reindex failed", e)
                onProgress("Index failed: ${e.message}", -1, false)
            }
        }
    }

    /**
     * Fire a notification for each subscribed + notifications-enabled podcast that has at least
     * one episode in [newEpisodes] (i.e. episodes genuinely new since the last index update).
     *
     * To prevent [SubscriptionRefreshReceiver] from re-firing a duplicate notification on its
     * next scheduled run, `lastSeenId` in `podcast_last_episode` SharedPreferences is advanced to
     * the overall latest episode for each notified podcast (from the full GCS episode list).
     */
    private fun notifyNewEpisodesForSubscriptions(
        context: Context,
        podcasts: List<Podcast>,
        allEpisodes: List<Episode>,
        newEpisodes: List<Episode>
    ) {
        if (newEpisodes.isEmpty()) return
        val notifEnabledIds = PodcastSubscriptions.getNotificationsEnabledIds(context)
        if (notifEnabledIds.isEmpty()) return

        val podcastById = podcasts.associateBy { it.id }
        val newByPodcast = newEpisodes.groupBy { it.podcastId }
        val allByPodcast = allEpisodes.groupBy { it.podcastId }
        val lastEpPrefs = context.getSharedPreferences("podcast_last_episode", Context.MODE_PRIVATE)

        for ((podcastId, podcastNewEps) in newByPodcast) {
            if (!notifEnabledIds.contains(podcastId)) continue
            val podcast = podcastById[podcastId] ?: continue

            try {
                // Pick the most recently published new episode to display in the notification.
                val latestNew = podcastNewEps.maxByOrNull {
                    EpisodeDateParser.parsePubDateToEpoch(it.pubDate)
                } ?: continue

                // Advance lastSeenId to the overall latest episode for this podcast so that
                // SubscriptionRefreshReceiver does not re-fire a duplicate notification.
                val overallLatest = allByPodcast[podcastId]
                    ?.maxByOrNull { EpisodeDateParser.parsePubDateToEpoch(it.pubDate) }
                if (overallLatest != null) {
                    lastEpPrefs.edit().putString(podcastId, overallLatest.id).apply()
                }

                PodcastEpisodeNotifier.notifyNewEpisode(context, podcast, latestNew.title)
                Log.d(TAG, "Notified new episode for podcast=$podcastId episodeId=${latestNew.id}")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to notify new episode for podcast=$podcastId: ${e.message}")
            }
        }
    }
}
