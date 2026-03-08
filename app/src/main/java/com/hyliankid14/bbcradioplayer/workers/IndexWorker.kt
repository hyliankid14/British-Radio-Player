package com.hyliankid14.bbcradioplayer.workers

import android.content.Context
import android.util.Log
import com.hyliankid14.bbcradioplayer.Episode
import com.hyliankid14.bbcradioplayer.IndexPreference
import com.hyliankid14.bbcradioplayer.Podcast
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

                // Download pre-built index from GitHub Pages.
                // Always force a fresh download for full reindex (user initiated or first install).
                val remoteClient = RemoteIndexClient(context)
                val downloadedIndex = try {
                    remoteClient.downloadIndex(forceDownload = true) { msg, pct ->
                        onProgress(msg, pct, false)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "GitHub Pages index download failed: ${e.message}")
                    null
                }

                if (downloadedIndex == null) {
                    onProgress("Index download failed. Please check your internet connection.", -1, false)
                    Log.e(TAG, "Unable to download index from GitHub Pages")
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
                Log.d(TAG, "Reindex from GitHub Pages complete: podcasts=${podcasts.size}, episodes=$inserted")
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
                    Log.w(TAG, "GitHub Pages index download failed: ${e.message}")
                    null
                }

                if (downloadedIndex == null) {
                    onProgress("Index download failed. Please check your internet connection.", -1, false)
                    Log.e(TAG, "Unable to download index from GitHub Pages")
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

                onProgress(
                    "Incremental index complete: newPodcasts=$newPodcasts, newEpisodes=$inserted",
                    100, false
                )
                Log.d(TAG, "Incremental reindex from GitHub Pages: newPodcasts=$newPodcasts, newEpisodes=$inserted")
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
}
