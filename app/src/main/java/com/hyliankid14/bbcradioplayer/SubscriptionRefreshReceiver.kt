package com.hyliankid14.bbcradioplayer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
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
                            // Determine the target set respecting the podcast's sort-order
                            // preference. For oldest-first podcasts the user listens to the
                            // oldest unplayed episodes next, so we download those instead of
                            // the newest ones (matching the behaviour of triggerAutoDownloadForPodcast).
                            val oldestFirst = PodcastEpisodeSortPreference.isOldestFirst(context, podcast.id)
                            val sortedForAutoDownload = if (oldestFirst) {
                                episodes.sortedBy { EpisodeDateParser.parsePubDateToEpoch(it.pubDate) }
                            } else {
                                episodes.sortedByDescending { EpisodeDateParser.parsePubDateToEpoch(it.pubDate) }
                            }
                            val targetEpisodes = sortedForAutoDownload
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

                // Check for new podcasts added to the catalogue and notify if enabled.
                if (IndexPreference.isNewPodcastNotificationsEnabled(context)) {
                    checkAndNotifyNewPodcasts(context)
                }
            } catch (_: Exception) {
                // swallow - this is a best-effort background job
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        private const val TAG = "SubscriptionRefreshReceiver"

        /**
         * Fetches the lightweight new-podcasts snapshot from the server and fires a
         * notification for any podcasts that are genuinely new since the last check.
         *
         * On the very first call the current snapshot is used only to seed the
         * "already seen" set so the user is not flooded with notifications for
         * all existing podcasts at once.
         */
        fun checkAndNotifyNewPodcasts(context: Context) {
            try {
                val snapshot = RemoteIndexClient(context).fetchNewPodcastSnapshot(skipCache = false)
                if (snapshot == null) {
                    Log.d(TAG, "checkAndNotifyNewPodcasts: snapshot unavailable, skipping")
                    return
                }

                val lastGeneratedAt = IndexPreference.getLastNewPodcastSnapshotGeneratedAt(context)

                if (lastGeneratedAt == null) {
                    // First time: seed all current podcast IDs as already-notified so the
                    // user does not receive a burst of notifications for pre-existing podcasts.
                    snapshot.firstSeenEpochs.keys.forEach { podcastId ->
                        IndexPreference.markNewPodcastNotified(context, podcastId)
                    }
                    IndexPreference.setLastNewPodcastSnapshotGeneratedAt(context, snapshot.snapshotGeneratedAt)
                    Log.d(TAG, "checkAndNotifyNewPodcasts: first run — seeded ${snapshot.firstSeenEpochs.size} podcast IDs")
                    return
                }

                if (lastGeneratedAt == snapshot.snapshotGeneratedAt) {
                    Log.d(TAG, "checkAndNotifyNewPodcasts: snapshot unchanged (generatedAt=$lastGeneratedAt), nothing to notify")
                    return
                }

                // Snapshot has been updated — notify for any podcast not yet seen.
                var notified = 0
                for (podcastId in snapshot.firstSeenEpochs.keys) {
                    if (IndexPreference.hasNotifiedForNewPodcast(context, podcastId)) continue
                    val podcastTitle = snapshot.titles[podcastId] ?: ""
                    if (podcastTitle.isBlank()) {
                        Log.d(TAG, "checkAndNotifyNewPodcasts: title missing for podcast $podcastId")
                    }
                    PodcastEpisodeNotifier.notifyNewPodcastAdded(context, podcastId, podcastTitle)
                    IndexPreference.markNewPodcastNotified(context, podcastId)
                    Log.d(TAG, "Notified new podcast added to catalogue: $podcastId")
                    notified++
                }
                Log.d(TAG, "checkAndNotifyNewPodcasts: notified $notified new podcast(s), snapshotGeneratedAt=${snapshot.snapshotGeneratedAt}")

                IndexPreference.setLastNewPodcastSnapshotGeneratedAt(context, snapshot.snapshotGeneratedAt)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to check for new podcast catalogue entries: ${e.message}")
            }
        }
    }
}
