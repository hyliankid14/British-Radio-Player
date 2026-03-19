package com.hyliankid14.bbcradioplayer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SubscriptionRefreshReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val pendingResult = goAsync()
        val minutes = SubscriptionRefreshPreference.getIntervalMinutes(context)
        if (minutes <= 0) {
            pendingResult.finish()
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val subscribedIds = PodcastSubscriptions.getSubscribedIds(context)
                if (subscribedIds.isNotEmpty()) {
                    val repo = PodcastRepository(context)
                    val allPodcasts = try { repo.fetchPodcasts(forceRefresh = true) } catch (_: Exception) { emptyList() }
                    val subscribed = allPodcasts.filter { subscribedIds.contains(it.id) }
                    val autoDownloadEnabled = DownloadPreferences.isAutoDownloadEnabled(context)
                    val autoDownloadLimit = DownloadPreferences.getAutoDownloadLimit(context).coerceAtLeast(1)

                    // For each subscribed podcast, fetch episodes and check for new ones
                    for (podcast in subscribed) {
                        val episodes = try { repo.fetchEpisodesIfNeeded(podcast) } catch (_: Exception) { emptyList() }
                        if (episodes.isEmpty()) continue

                        val sortedEpisodes = episodes.sortedByDescending {
                            EpisodeDateParser.parsePubDateToEpoch(it.pubDate)
                        }

                        if (autoDownloadEnabled) {
                            // Determine the target set: the N newest unplayed episodes that
                            // should be auto-downloaded according to the limit.
                            val targetEpisodes = sortedEpisodes
                                .filter { !PlayedEpisodesPreference.isPlayed(context, it.id) }
                                .take(autoDownloadLimit)
                            val targetIds = targetEpisodes.map { it.id }.toSet()
                            // Delete auto-downloads that are no longer in the target set before
                            // starting new downloads so the count never exceeds the limit.
                            DownloadedEpisodes.getDownloadedEpisodesForPodcast(context, podcast.id)
                                .filter { it.isAutoDownloaded && it.id !in targetIds }
                                .forEach { EpisodeDownloadManager.deleteDownload(context, it.id, showToast = false) }
                            for (episode in targetEpisodes) {
                                if (!DownloadedEpisodes.isDownloaded(context, episode)) {
                                    try {
                                        EpisodeDownloadManager.downloadEpisode(context, episode, podcast.title, isAutoDownload = true)
                                    } catch (_: Exception) { }
                                }
                            }
                        }

                        if (!PodcastSubscriptions.isNotificationsEnabled(context, podcast.id)) continue

                        // Use publish date to determine the newest episode.
                        val latest = sortedEpisodes.firstOrNull() ?: continue
                        val latestId = latest.id
                        if (latestId.isBlank()) continue

                        // Track last seen episode per podcast
                        val prefs = context.getSharedPreferences("podcast_last_episode", Context.MODE_PRIVATE)
                        val lastSeenId = prefs.getString(podcast.id, null)

                        if (lastSeenId == null) {
                            // First run: seed state without notifying
                            prefs.edit().putString(podcast.id, latestId).apply()
                            continue
                        }

                        if (lastSeenId != latestId) {
                            val episodeTitle = latest.title.ifBlank { "(Untitled Episode)" }
                            PodcastEpisodeNotifier.notifyNewEpisode(context, podcast, episodeTitle)
                            prefs.edit().putString(podcast.id, latestId).apply()
                        }
                    }
                }

                SavedSearchManager.checkForUpdates(context)
            } catch (_: Exception) {
                // swallow - this is a best-effort background job
            } finally {
                pendingResult.finish()
            }
        }
    }
}
