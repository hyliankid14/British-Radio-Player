package com.hyliankid14.bbcradioplayer

import android.content.Context
import com.hyliankid14.bbcradioplayer.db.IndexStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant

object SavedSearchManager {
    private fun parseCloudGeneratedEpoch(raw: String?): Long {
        if (raw.isNullOrBlank()) return 0L
        return try {
            Instant.parse(raw).toEpochMilli()
        } catch (_: Exception) {
            0L
        }
    }

    suspend fun checkForUpdates(context: Context) {
        withContext(Dispatchers.IO) {
            try {
                val searches = SavedSearchesPreference.getSavedSearches(context)
                    .filter { it.query.isNotBlank() }
                if (searches.isEmpty()) return@withContext

                val index = IndexStore.getInstance(context)
                if (!index.hasAnyEpisodes()) return@withContext

                val repo = PodcastRepository(context)
                val allPodcasts = try { repo.fetchPodcasts(forceRefresh = true) } catch (_: Exception) { emptyList() }
                if (allPodcasts.isEmpty()) return@withContext

                val cloudLatestEpoch = try {
                    parseCloudGeneratedEpoch(RemoteIndexClient(context).fetchRemoteIndexMeta()?.generatedAt)
                } catch (_: Exception) {
                    0L
                }

                for (search in searches) {
                    val filter = PodcastFilter(
                        genres = search.genres.toSet(),
                        minDuration = search.minDuration,
                        maxDuration = search.maxDuration,
                        searchQuery = ""
                    )
                    val allowed = repo.filterPodcasts(allPodcasts, filter).map { it.id }.toSet()
                    if (allowed.isEmpty()) continue

                    val matches = try { index.searchEpisodes(search.query, 200) } catch (_: Exception) { emptyList() }
                    if (matches.isEmpty()) {
                        if (search.notificationsEnabled) {
                            SavedSearchesPreference.updateLastSeenEpisodeIds(context, search.id, emptyList(), 0L)
                        } else {
                            SavedSearchesPreference.updateLastMatchEpoch(context, search.id, 0L)
                        }
                        continue
                    }

                    val filtered = matches.filter { allowed.contains(it.podcastId) }
                    val ids = filtered.map { it.episodeId }.distinct().take(50)

                    if (ids.isEmpty()) {
                        if (search.notificationsEnabled) {
                            SavedSearchesPreference.updateLastSeenEpisodeIds(context, search.id, emptyList(), 0L)
                        } else {
                            SavedSearchesPreference.updateLastMatchEpoch(context, search.id, 0L)
                        }
                        continue
                    }

                    val latestEpoch = if (cloudLatestEpoch > 0L) {
                        cloudLatestEpoch
                    } else {
                        try { index.getLatestEpisodePubDateEpoch(ids) } catch (_: Exception) { 0L }
                    }

                    if (search.notificationsEnabled) {
                        val lastSeen = search.lastSeenEpisodeIds.toSet()
                        val newIds = if (lastSeen.isEmpty()) ids else ids.filterNot { lastSeen.contains(it) }

                        if (newIds.isNotEmpty()) {
                            val exampleTitle = filtered.firstOrNull { newIds.contains(it.episodeId) }?.title ?: ""
                            SavedSearchNotifier.notifyNewMatches(context, search, exampleTitle, newIds.size)
                        }

                        SavedSearchesPreference.updateLastSeenEpisodeIds(context, search.id, ids, latestEpoch)
                    } else {
                        SavedSearchesPreference.updateLastMatchEpoch(context, search.id, latestEpoch)
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
                if (!index.hasAnyEpisodes()) return@withContext

                val repo = PodcastRepository(context)
                val allPodcasts = try { repo.fetchPodcasts(forceRefresh = false) } catch (_: Exception) {
                    emptyList()
                }
                if (allPodcasts.isEmpty()) return@withContext

                val cloudLatestEpoch = try {
                    parseCloudGeneratedEpoch(RemoteIndexClient(context).fetchRemoteIndexMeta()?.generatedAt)
                } catch (_: Exception) {
                    0L
                }

                fun parseEpoch(raw: String?): Long = IndexStore.parsePubEpoch(raw)

                for (search in searches) {
                    val filter = PodcastFilter(
                        genres = search.genres.toSet(),
                        minDuration = search.minDuration,
                        maxDuration = search.maxDuration,
                        searchQuery = ""
                    )
                    val allowed = repo.filterPodcasts(allPodcasts, filter).map { it.id }.toSet()
                    if (allowed.isEmpty()) continue

                    val matches = try { index.searchEpisodes(search.query, 200) } catch (_: Exception) {
                        continue
                    }
                    if (matches.isEmpty()) continue

                    val filtered = matches.filter { allowed.contains(it.podcastId) }
                    val ids = filtered.map { it.episodeId }.distinct().take(50)
                    if (ids.isEmpty()) continue

                    var latestEpoch = if (cloudLatestEpoch > 0L) {
                        cloudLatestEpoch
                    } else {
                        try { index.getLatestEpisodePubDateEpoch(ids) } catch (_: Exception) {
                            0L
                        }
                    }
                    if (latestEpoch == 0L) {
                        for (hit in filtered) {
                            val cached = repo.getEpisodesFromCache(hit.podcastId) ?: continue
                            val candidate = cached.firstOrNull { it.id == hit.episodeId } ?: continue
                            val epoch = parseEpoch(candidate.pubDate)
                            if (epoch > latestEpoch) latestEpoch = epoch
                        }
                    }

                    // Only persist when we have a confirmed positive epoch to avoid
                    // overwriting a valid stored date with 0 due to a transient failure.
                    if (latestEpoch > 0L) {
                        SavedSearchesPreference.updateLastMatchEpoch(context, search.id, latestEpoch)
                    }
                }
            } catch (_: Exception) {
                // best-effort background refresh
            }
        }
    }
}
