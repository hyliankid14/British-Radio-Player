package com.hyliankid14.bbcradioplayer

import android.content.Context
import com.hyliankid14.bbcradioplayer.db.IndexStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object SavedSearchManager {
    // Maximum age of an episode to qualify for a "new episode match" push notification.
    // Prevents historical or archive episodes (e.g. from months or years ago) from triggering
    // push notifications when re-indexed or re-added to an RSS feed.
    private const val MAX_NOTIFICATION_EPISODE_AGE_MS = 14 * 24 * 60 * 60 * 1000L // 14 days

    // Grace period before search creation date to consider episodes "new" if no previous match exists.
    private const val SEARCH_CREATION_GRACE_PERIOD_MS = 48 * 60 * 60 * 1000L // 48 hours

    // Maximum number of seen episode IDs retained per saved search.
    private const val MAX_SEEN_EPISODE_IDS = 200

    suspend fun checkForUpdates(context: Context) {
        withContext(Dispatchers.IO) {
            try {
                val searches = SavedSearchesPreference.getSavedSearches(context)
                    .filter { it.query.isNotBlank() }
                if (searches.isEmpty()) return@withContext

                val index = IndexStore.getInstance(context)

                val repo = PodcastRepository(context)
                val allPodcasts = try { repo.fetchPodcasts(forceRefresh = true) } catch (_: Exception) { emptyList() }
                    .ifEmpty { repo.getAvailablePodcastsNow() }
                if (allPodcasts.isEmpty()) {
                    android.util.Log.w("SavedSearchManager", "checkForUpdates: no podcast list available, skipping")
                    return@withContext
                }

                val remote = RemoteIndexClient(context)
                val now = System.currentTimeMillis()
                val freshnessThreshold = now - MAX_NOTIFICATION_EPISODE_AGE_MS

                for (search in searches) {
                    val filter = PodcastFilter(
                        genres = search.genres.toSet(),
                        minDuration = search.minDuration,
                        maxDuration = search.maxDuration,
                        searchQuery = ""
                    )
                    val allowed = repo.filterPodcasts(allPodcasts, filter).map { it.id }.toSet()
                    if (allowed.isEmpty()) continue

                    val matches = try {
                        val remoteMatches = remote.searchEpisodes(search.query, 500, 0)
                        if (remoteMatches.isNotEmpty()) remoteMatches else index.searchEpisodes(search.query, 500)
                    } catch (_: Exception) {
                        try { index.searchEpisodes(search.query, 500) } catch (_: Exception) { emptyList() }
                    }
                    if (matches.isEmpty()) continue

                    val filtered = matches.filter { allowed.contains(it.podcastId) }
                    if (filtered.isEmpty()) continue

                    // Resolve publication epoch for each episode and sort newest-first
                    val sortedWithEpoch = filtered.map { ep ->
                        var epoch = EpisodeDateParser.parsePubDateToEpoch(ep.pubDate)
                        if (epoch == 0L) {
                            epoch = index.getLatestEpisodePubDateEpoch(listOf(ep.episodeId))
                        }
                        ep to epoch
                    }.sortedByDescending { it.second }

                    val latestEpoch = sortedWithEpoch.firstOrNull()?.second ?: 0L
                    val currentMatchIds = sortedWithEpoch.map { it.first.episodeId }.distinct()

                    // Only persist a non-zero epoch and ensure lastMatchEpoch never decreases
                    val epochToStore = maxOf(search.lastMatchEpoch, latestEpoch).takeIf { it > 0L }

                    if (search.notificationsEnabled) {
                        val lastSeen = search.lastSeenEpisodeIds.toSet()

                        if (lastSeen.isEmpty()) {
                            // First run or after reinstall: seed state without notifying so that
                            // only genuinely new episodes trigger a notification next time.
                            SavedSearchesPreference.updateLastSeenEpisodeIds(
                                context,
                                search.id,
                                currentMatchIds.take(MAX_SEEN_EPISODE_IDS),
                                epochToStore
                            )
                        } else {
                            // An episode is only a "new match" if:
                            // 1. Its ID has not been seen before.
                            // 2. Its publication date is valid (> 0L).
                            // 3. Its publication date is within the freshness window (last 14 days) —
                            //    preventing archive episodes from months/years ago triggering notifications.
                            // 4. It is strictly newer than the previously recorded latest match date
                            //    (or if lastMatchEpoch == 0, published after search creation).
                            val newEpisodes = sortedWithEpoch.filter { (ep, epEpoch) ->
                                !lastSeen.contains(ep.episodeId) &&
                                epEpoch > 0L &&
                                epEpoch >= freshnessThreshold &&
                                if (search.lastMatchEpoch > 0L) {
                                    epEpoch > search.lastMatchEpoch
                                } else {
                                    epEpoch >= (search.createdAt - SEARCH_CREATION_GRACE_PERIOD_MS)
                                }
                            }

                            if (newEpisodes.isNotEmpty()) {
                                val exampleTitle = newEpisodes.first().first.title
                                SavedSearchNotifier.notifyNewMatches(context, search, exampleTitle, newEpisodes.size)
                            }

                            // Accumulate seen IDs with newest first, capped to MAX_SEEN_EPISODE_IDS
                            val updatedSeenIds = (currentMatchIds + lastSeen).distinct().take(MAX_SEEN_EPISODE_IDS)
                            SavedSearchesPreference.updateLastSeenEpisodeIds(context, search.id, updatedSeenIds, epochToStore)
                        }
                    } else if (epochToStore != null && epochToStore != search.lastMatchEpoch) {
                        SavedSearchesPreference.updateLastMatchEpoch(context, search.id, epochToStore)
                    }
                }
            } catch (_: Exception) {
                // best-effort background check
            }
        }
    }

    suspend fun refreshLatestMatchDates(context: Context) {
        withContext(Dispatchers.IO) {
            try {
                val searches = SavedSearchesPreference.getSavedSearches(context)
                    .filter { it.query.isNotBlank() }
                if (searches.isEmpty()) return@withContext

                val index = IndexStore.getInstance(context)

                val repo = PodcastRepository(context)
                // Try a fresh network fetch; if it fails fall back to the on-disk cache so
                // the refresh succeeds even when the device is temporarily offline.
                val allPodcasts = try { repo.fetchPodcasts(forceRefresh = true) } catch (_: Exception) {
                    emptyList()
                }.ifEmpty { repo.getAvailablePodcastsNow() }
                if (allPodcasts.isEmpty()) {
                    android.util.Log.w("SavedSearchManager", "refreshLatestMatchDates: no podcast list available, skipping")
                    return@withContext
                }

                val remote = RemoteIndexClient(context)

                for (search in searches) {
                    val filter = PodcastFilter(
                        genres = search.genres.toSet(),
                        minDuration = search.minDuration,
                        maxDuration = search.maxDuration,
                        searchQuery = ""
                    )
                    val allowed = repo.filterPodcasts(allPodcasts, filter).map { it.id }.toSet()
                    if (allowed.isEmpty()) continue

                    val matches = try {
                        val remoteMatches = remote.searchEpisodes(search.query, 500, 0)
                        if (remoteMatches.isNotEmpty()) remoteMatches else index.searchEpisodes(search.query, 500)
                    } catch (_: Exception) {
                        try { index.searchEpisodes(search.query, 500) } catch (_: Exception) { continue }
                    }
                    if (matches.isEmpty()) continue

                    val filtered = matches.filter { allowed.contains(it.podcastId) }
                    if (filtered.isEmpty()) continue

                    val ids = filtered.map { it.episodeId }.distinct().take(50)
                    // Use EpisodeDateParser which normalises timezone strings (GMT, UTC, +HH:MM)
                    // and supports more date formats than IndexStore.parsePubEpoch.
                    var latestEpoch = filtered.maxOfOrNull { EpisodeDateParser.parsePubDateToEpoch(it.pubDate) } ?: 0L
                    if (latestEpoch == 0L && ids.isNotEmpty()) {
                        // pubDate strings were missing or unparseable — fall back to the
                        // pre-computed pubEpoch values stored in the local SQLite index.
                        latestEpoch = index.getLatestEpisodePubDateEpoch(ids)
                    }
                    if (latestEpoch == 0L) {
                        for (hit in filtered) {
                            val cached = repo.getEpisodesFromCache(hit.podcastId) ?: continue
                            val candidate = cached.firstOrNull { it.id == hit.episodeId } ?: continue
                            val epoch = EpisodeDateParser.parsePubDateToEpoch(candidate.pubDate)
                            if (epoch > latestEpoch) latestEpoch = epoch
                        }
                    }

                    // Only persist when we have a confirmed positive epoch and it advances the stored date.
                    val newEpoch = maxOf(search.lastMatchEpoch, latestEpoch)
                    if (newEpoch > 0L && newEpoch != search.lastMatchEpoch) {
                        SavedSearchesPreference.updateLastMatchEpoch(context, search.id, newEpoch)
                    }
                }
            } catch (_: Exception) {
                // best-effort background refresh
            }
        }
    }
}
