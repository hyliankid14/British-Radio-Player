package com.hyliankid14.bbcradioplayer.workers

import android.content.Context
import android.util.Log
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
                onProgress("Fetching podcasts...", 0, false)
                val repo = PodcastRepository(context)
                val podcasts = repo.fetchPodcasts(forceRefresh = true)
                if (podcasts.isEmpty()) {
                    onProgress("No podcasts to index", 100, false)
                    return@withContext
                }

                onProgress("Indexing ${podcasts.size} podcasts...", 5, false)
                val store = IndexStore.getInstance(context)
                store.replaceAllPodcasts(podcasts)

                // Push podcast metadata to the remote server index (best-effort)
                val remoteClient = RemoteIndexClient(context)
                val serverAvailable = try { remoteClient.isServerAvailable() } catch (_: Exception) { false }
                if (serverAvailable) {
                    try {
                        remoteClient.pushPodcasts(podcasts)
                        Log.d(TAG, "Pushed ${podcasts.size} podcasts to remote index")
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to push podcasts to remote index: ${e.message}")
                    }
                }

                // Fetch & index episodes per-podcast (streamed) to avoid building a huge in-memory list.
                // NOTE: We intentionally do NOT wipe the episode FTS table before indexing.
                // The index is additive — previously indexed episodes are preserved even after they
                // fall off the BBC RSS feed. This ensures saved searches continue to surface
                // historical results that are no longer available via RSS.
                var totalEpisodesDiscovered = 0
                var processedEpisodes = 0

                // Begin episode-phase just above the earlier podcasts step (5%) so the
                // progress indicator advances smoothly instead of jumping.
                onProgress("Indexing episodes (streamed)...", 6, true)

                for ((i, p) in podcasts.withIndex()) {
                    if (!isActive) break
                    // Fetch episodes for this podcast and report monotonic overall-percent updates
                    val eps = try { repo.fetchEpisodesIfNeeded(p, forceRefresh = true) } catch (e: Exception) { emptyList() }
                    if (eps.isEmpty()) {
                        // No episodes discovered — treat this podcast as complete and emit the
                        // per-podcast completion percent (monotonic mapping).
                        val completedPct = computePodcastCompletePercent(i, podcasts.size)
                        onProgress("Indexed episodes for: ${p.title}", completedPct, true)
                        continue
                    }

                    Log.d(TAG, "Fetched ${eps.size} episodes for ${p.title} (ID: ${p.id})")
                    if (eps.isNotEmpty()) {
                        val first = eps.first()
                        val last = eps.last()
                        Log.d(TAG, "  First episode: '${first.title}' pubDate='${first.pubDate}'")
                        Log.d(TAG, "  Last episode: '${last.title}' pubDate='${last.pubDate}'")
                    }

                    // Count discovered episodes for diagnostics only (do NOT use for UI percent)
                    totalEpisodesDiscovered += eps.size

                    // Only insert episodes not already present in the index to avoid FTS duplicates
                    // and to preserve the accumulated history of older episodes.
                    val existingIds = try { store.getEpisodeIdsForPodcast(p.id) } catch (e: Exception) { emptySet() }
                    val newEps = eps.filter { it.id.isNotBlank() && !existingIds.contains(it.id) }
                    if (newEps.isEmpty()) {
                        val completedPct = computePodcastCompletePercent(i, podcasts.size)
                        onProgress("No new episodes for: ${p.title}", completedPct, true)
                        Log.d(TAG, "No new episodes for ${p.title} (${eps.size} fetched, all already indexed)")
                        continue
                    }

                    Log.d(TAG, "Indexing ${newEps.size} new episodes for ${p.title} (${eps.size - newEps.size} already indexed)")

                    // Enrich each episode's description with the podcast title (helps joint queries)
                    val enriched = newEps.map { ep -> ep.copy(description = listOfNotNull(ep.description, p.title).joinToString(" ")) }

                    // Push new episodes to the remote server index (best-effort)
                    if (serverAvailable) {
                        try {
                            remoteClient.pushEpisodes(p.id, enriched)
                        } catch (e: Exception) {
                            Log.w(TAG, "Failed to push episodes for ${p.id} to remote: ${e.message}")
                        }
                    }

                    // Insert in bounded-size batches via IndexStore.appendEpisodesBatch
                    try {
                        var inserted = 0
                        val batchSize = 500
                        val chunks = enriched.chunked(batchSize)

                        for (chunk in chunks) {
                            if (!isActive) break
                            val added = try { store.appendEpisodesBatch(chunk) } catch (oom: OutOfMemoryError) {
                                // try smaller chunks if we hit memory pressure
                                var fallback = 0
                                for (small in chunk.chunked(50)) fallback += store.appendEpisodesBatch(small)
                                fallback
                            }
                            inserted += added
                            processedEpisodes += added

                            // Report monotonic overall episode percent based on processedInPodcast
                            val overallPct = computeOverallEpisodePercent(i, podcasts.size, inserted, newEps.size)
                            onProgress("Indexing episodes for: ${p.title}", overallPct, true)

                            // Give SQLite a chance to service other threads / GC
                            try { Thread.yield() } catch (_: Throwable) {}
                        }

                        // When we've finished inserting *all* episodes for this podcast, advance the
                        // overall episode progress to the podcast-complete mark so the UI progress
                        // bar reaches the per-podcast completion point.
                        val completedPct = computePodcastCompletePercent(i, podcasts.size)
                        onProgress("Indexed episodes for: ${p.title}", completedPct, true)
                        Log.d(TAG, "Indexed $inserted new episodes for ${p.title}")
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to append episodes for ${p.id}: ${e.message}")
                    }
                }

                // final progress report (best-effort)
                onProgress("Index complete: ${podcasts.size} podcasts, $processedEpisodes episodes", 100, false)
                Log.d(TAG, "Reindex complete: podcasts=${podcasts.size}, episodes=$processedEpisodes")
                try {
                    store.setLastReindexTime(System.currentTimeMillis())
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to persist last reindex time: ${e.message}")
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
                onProgress("Fetching podcasts...", 0, false)
                val repo = PodcastRepository(context)
                val podcasts = try { repo.fetchPodcasts(forceRefresh = true) } catch (e: Exception) { emptyList<Podcast>() }
                if (podcasts.isEmpty()) {
                    onProgress("No podcasts found", 100, false)
                    return@withContext
                }

                val store = IndexStore.getInstance(context)
                val remoteClient = RemoteIndexClient(context)
                val serverAvailable = try { remoteClient.isServerAvailable() } catch (_: Exception) { false }
                var processedEpisodes = 0
                var newEpisodes = 0
                var newPodcasts = 0

                // We will map progress to per-podcast completion percent so the bar advances
                // as each podcast is processed.
                for ((i, p) in podcasts.withIndex()) {
                    if (!isActive) break
                    onProgress("Checking: ${p.title}", -1, true)

                    // Ensure podcast row exists and is up-to-date
                    val had = store.hasPodcast(p.id)
                    try {
                        store.upsertPodcast(p)
                        if (!had) newPodcasts++
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to upsert podcast ${p.id}: ${e.message}")
                    }

                    // Push podcast to remote server if it's new (best-effort)
                    if (!had && serverAvailable) {
                        try { remoteClient.pushPodcasts(listOf(p)) } catch (e: Exception) {
                            Log.w(TAG, "Failed to push new podcast ${p.id} to remote: ${e.message}")
                        }
                    }

                    // Fetch episodes for this podcast and only append those not already indexed
                    val eps = try { repo.fetchEpisodesIfNeeded(p, forceRefresh = true) } catch (e: Exception) { emptyList() }
                    if (eps.isEmpty()) {
                        val completedPct = computePodcastCompletePercent(i, podcasts.size)
                        onProgress("Indexed episodes for: ${p.title}", completedPct, true)
                        continue
                    }

                    val existingIds = store.getEpisodeIdsForPodcast(p.id)
                    val missing = eps.filter { it.id.isNotBlank() && !existingIds.contains(it.id) }
                    if (missing.isEmpty()) {
                        val completedPct = computePodcastCompletePercent(i, podcasts.size)
                        onProgress("No new episodes for: ${p.title}", completedPct, true)
                        continue
                    }

                    // Enrich missing episodes and append in chunks
                    val enriched = missing.map { ep -> ep.copy(description = listOfNotNull(ep.description, p.title).joinToString(" ")) }

                    // Push new episodes to the remote server index (best-effort)
                    if (serverAvailable) {
                        try {
                            remoteClient.pushEpisodes(p.id, enriched)
                        } catch (e: Exception) {
                            Log.w(TAG, "Failed to push new episodes for ${p.id} to remote: ${e.message}")
                        }
                    }

                    try {
                        var inserted = 0
                        val batchSize = 500
                        val chunks = enriched.chunked(batchSize)
                        for (chunk in chunks) {
                            if (!isActive) break
                            val added = try { store.appendEpisodesBatch(chunk) } catch (oom: OutOfMemoryError) {
                                var fallback = 0
                                for (small in chunk.chunked(50)) fallback += store.appendEpisodesBatch(small)
                                fallback
                            }
                            inserted += added
                            newEpisodes += added
                            processedEpisodes += added

                            // Report a reasonable overall percent for UI (per-podcast mapping)
                            val overallPct = computeOverallEpisodePercent(i, podcasts.size, inserted, enriched.size)
                            onProgress("Indexing new episodes for: ${p.title}", overallPct, true)

                            try { Thread.yield() } catch (_: Throwable) {}
                        }

                        // Mark podcast complete
                        val completedPct = computePodcastCompletePercent(i, podcasts.size)
                        onProgress("Indexed episodes for: ${p.title}", completedPct, true)
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to append new episodes for ${p.id}: ${e.message}")
                    }
                }

                onProgress("Incremental index complete: newPodcasts=${newPodcasts}, newEpisodes=${newEpisodes}", 100, false)
                Log.d(TAG, "Incremental reindex complete: newPodcasts=${newPodcasts}, newEpisodes=${newEpisodes}")
                try {
                    store.setLastReindexTime(System.currentTimeMillis())
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to persist last reindex time: ${e.message}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Incremental reindex failed", e)
                onProgress("Index failed: ${e.message}", -1, false)
            }
        }
    }
}
