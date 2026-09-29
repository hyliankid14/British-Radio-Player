package com.hyliankid14.bbcradioplayer

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

object PodcastSubscriptions {
    private const val PREFS_NAME = "podcast_subscriptions"
    private const val KEY_SUBSCRIBED_IDS = "subscribed_ids"
    private const val KEY_NOTIFICATIONS_ENABLED = "notifications_enabled"
    private const val KEY_LAST_AUTO_SYNC_MS = "last_auto_sync_ms"
    private const val AUTO_SYNC_MIN_INTERVAL_MS = 15L * 60L * 1000L

    const val ACTION_SUBSCRIPTION_CHANGED = "com.hyliankid14.bbcradioplayer.ACTION_SUBSCRIPTION_CHANGED"
    const val EXTRA_PODCAST_ID = "extra_podcast_id"
    const val EXTRA_IS_SUBSCRIBED = "extra_is_subscribed"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getSubscribedIds(context: Context): Set<String> {
        return prefs(context).getStringSet(KEY_SUBSCRIBED_IDS, emptySet()) ?: emptySet()
    }
    
    fun getNotificationsEnabledIds(context: Context): Set<String> {
        return prefs(context).getStringSet(KEY_NOTIFICATIONS_ENABLED, emptySet()) ?: emptySet()
    }

    fun isSubscribed(context: Context, podcastId: String): Boolean {
        return getSubscribedIds(context).contains(podcastId)
    }

    fun toggleSubscription(context: Context, podcastId: String, syncToWear: Boolean = true) {
        val current = getSubscribedIds(context).toMutableSet()
        val wasSubscribed = current.contains(podcastId)
        if (wasSubscribed) {
            current.remove(podcastId)
            // Also remove notification preference when unsubscribing
            setNotificationsEnabled(context, podcastId, false)
            // Unsubscribing should also clear downloaded episodes from this podcast.
            deleteAllDownloadsForPodcast(context, podcastId)
        } else {
            current.add(podcastId)
            // Notifications remain disabled until the user opts in
            setNotificationsEnabled(context, podcastId, false)
            
            // If auto-download is enabled, immediately download latest episodes
            if (DownloadPreferences.isAutoDownloadEnabled(context)) {
                triggerAutoDownloadForPodcast(context, podcastId)
            }
        }
        prefs(context).edit().putStringSet(KEY_SUBSCRIBED_IDS, current).apply()

        // Notify any visible lists so star/bell state updates immediately.
        context.sendBroadcast(
            android.content.Intent(ACTION_SUBSCRIPTION_CHANGED).apply {
                setPackage(context.packageName)
                putExtra(EXTRA_PODCAST_ID, podcastId)
                putExtra(EXTRA_IS_SUBSCRIBED, !wasSubscribed)
            }
        )

        if (syncToWear) {
            WearAppStateSync.pushCurrentState(context)
        }
    }

    fun setSubscribedIds(context: Context, ids: Set<String>, syncToWear: Boolean = true) {
        val normalisedIds = ids.filter { it.isNotBlank() }.toSet()
        val previousIds = getSubscribedIds(context)
        val keptNotificationIds = getNotificationsEnabledIds(context).intersect(normalisedIds)
        prefs(context).edit()
            .putStringSet(KEY_SUBSCRIBED_IDS, normalisedIds)
            .putStringSet(KEY_NOTIFICATIONS_ENABLED, keptNotificationIds)
            .apply()

        val changedIds = (previousIds + normalisedIds).filter { previousIds.contains(it) != normalisedIds.contains(it) }
        changedIds.forEach { podcastId ->
            context.sendBroadcast(
                android.content.Intent(ACTION_SUBSCRIPTION_CHANGED).apply {
                    setPackage(context.packageName)
                    putExtra(EXTRA_PODCAST_ID, podcastId)
                    putExtra(EXTRA_IS_SUBSCRIBED, normalisedIds.contains(podcastId))
                }
            )
        }

        if (syncToWear) {
            WearAppStateSync.pushCurrentState(context)
        }
    }

    /**
     * Immediately downloads the appropriate episodes for a subscribed podcast respecting the
     * current sort-order preference. When oldest-first is set, the oldest unplayed episodes are
     * downloaded; otherwise the newest ones are. Existing auto-downloads that fall outside the
     * new target set are deleted first.
     * This runs in the background and handles errors silently.
     */
    fun triggerAutoDownloadForPodcast(context: Context, podcastId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val autoDownloadLimit = DownloadPreferences.getAutoDownloadLimit(context).coerceAtLeast(1)
                val repo = PodcastRepository(context)
                
                // Fetch the podcast and its episodes
                val allPodcasts = try { repo.fetchPodcasts(forceRefresh = false) } catch (_: Exception) { emptyList() }
                val podcast = allPodcasts.find { it.id == podcastId } ?: return@launch
                val episodes = try { repo.fetchEpisodesIfNeeded(podcast) } catch (_: Exception) { emptyList() }
                if (episodes.isEmpty()) return@launch
                
                // Determine the target set: the N next unplayed episodes that should
                // be auto-downloaded according to the limit. When the podcast is set to
                // oldest-first, the user will listen to the oldest unplayed episodes next,
                // so we download those instead of the newest ones.
                val oldestFirst = PodcastEpisodeSortPreference.isOldestFirst(context, podcastId)
                val sortedEpisodes = if (oldestFirst) {
                    episodes.sortedBy { EpisodeDateParser.parsePubDateToEpoch(it.pubDate) }
                } else {
                    episodes.sortedByDescending { EpisodeDateParser.parsePubDateToEpoch(it.pubDate) }
                }
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
            } catch (_: Exception) {
                // Silently handle errors - this is a best-effort operation
            }
        }
    }

    fun downloadAllEpisodesForPodcast(context: Context, podcastId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val repo = PodcastRepository(context)
                val allPodcasts = try { repo.fetchPodcasts(forceRefresh = false) } catch (_: Exception) { emptyList() }
                val podcast = allPodcasts.find { it.id == podcastId } ?: return@launch
                val episodes = try { repo.fetchEpisodesIfNeeded(podcast) } catch (_: Exception) { emptyList() }
                var started = 0
                episodes.forEach { episode ->
                    if (!DownloadedEpisodes.isDownloaded(context, episode)) {
                        try {
                            val queued = EpisodeDownloadManager.downloadEpisode(
                                context,
                                episode,
                                podcast.title,
                                isAutoDownload = false,
                                suppressSuccessNotification = true
                            )
                            if (queued) started += 1
                        } catch (_: Exception) {
                        }
                    }
                }
                EpisodeDownloadManager.showBulkDownloadQueuedNotification(context, started, podcast.title)
            } catch (_: Exception) {
                // Best effort action from an explicit user request.
            }
        }
    }

    private fun deleteAllDownloadsForPodcast(context: Context, podcastId: String) {
        if (podcastId.isBlank()) return
        val entries = DownloadedEpisodes.getDownloadedEpisodesForPodcast(context, podcastId)
        entries.forEach { entry ->
            EpisodeDownloadManager.deleteDownload(context, entry.id, showToast = false)
        }
    }

    /**
     * Trigger auto-download for all existing subscribed podcasts.
     * This is useful when the user enables auto-download for the first time
     * or when they want to catch up on all their subscriptions.
     */
    fun triggerAutoDownloadForAllSubscriptions(context: Context, force: Boolean = false) {
        if (!DownloadPreferences.isAutoDownloadEnabled(context)) return
        val now = System.currentTimeMillis()
        if (!force) {
            val lastSync = prefs(context).getLong(KEY_LAST_AUTO_SYNC_MS, 0L)
            if (now - lastSync < AUTO_SYNC_MIN_INTERVAL_MS) return
        }
        prefs(context).edit().putLong(KEY_LAST_AUTO_SYNC_MS, now).apply()
        
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val subscribedIds = getSubscribedIds(context)
                if (subscribedIds.isEmpty()) return@launch
                
                for (podcastId in subscribedIds) {
                    triggerAutoDownloadForPodcast(context, podcastId)
                }
            } catch (_: Exception) {
                // Silently handle errors - this is a best-effort operation
            }
        }
    }

    fun isNotificationsEnabled(context: Context, podcastId: String): Boolean {
        // Only return true if the podcast is subscribed AND notifications are enabled
        if (!isSubscribed(context, podcastId)) return false
        val enabledIds = prefs(context).getStringSet(KEY_NOTIFICATIONS_ENABLED, emptySet()) ?: emptySet()
        return enabledIds.contains(podcastId)
    }

    fun setNotificationsEnabled(context: Context, podcastId: String, enabled: Boolean) {
        val current = prefs(context).getStringSet(KEY_NOTIFICATIONS_ENABLED, emptySet())?.toMutableSet() ?: mutableSetOf()
        if (enabled) {
            current.add(podcastId)
        } else {
            current.remove(podcastId)
        }
        prefs(context).edit().putStringSet(KEY_NOTIFICATIONS_ENABLED, current).apply()
    }

    fun toggleNotifications(context: Context, podcastId: String) {
        val current = isNotificationsEnabled(context, podcastId)
        setNotificationsEnabled(context, podcastId, !current)
    }
}
