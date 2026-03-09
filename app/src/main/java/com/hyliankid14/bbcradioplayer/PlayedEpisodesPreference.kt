package com.hyliankid14.bbcradioplayer

import android.content.Context

object PlayedEpisodesPreference {
    private const val PREFS_NAME = "played_episodes_prefs"
    private const val KEY_PLAYED_IDS = "played_ids"
    const val ACTION_PLAYED_STATUS_CHANGED = "com.hyliankid14.bbcradioplayer.action.PLAYED_STATUS_CHANGED"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getPlayedIds(context: Context): Set<String> {
        return prefs(context).getStringSet(KEY_PLAYED_IDS, emptySet()) ?: emptySet()
    }

    fun isPlayed(context: Context, episodeId: String): Boolean {
        return getPlayedIds(context).contains(episodeId)
    }

    fun markPlayed(context: Context, episodeId: String) {
        val current = getPlayedIds(context).toMutableSet()
        if (!current.contains(episodeId)) {
            current.add(episodeId)
            // Remove saved progress when episode is considered completed
            removeProgress(context, episodeId)
            prefs(context).edit().putStringSet(KEY_PLAYED_IDS, current).apply()
            // Broadcast change so UI can update
            val intent = android.content.Intent(ACTION_PLAYED_STATUS_CHANGED)
            context.sendBroadcast(intent)
        }
    }

    // Record the last-played epoch for a podcast (used to detect newer episodes)
    private const val KEY_LAST_PLAYED_PREFIX = "last_played_epoch_"

    fun setLastPlayedEpoch(context: Context, podcastId: String, epochMs: Long) {
        prefs(context).edit().putLong(KEY_LAST_PLAYED_PREFIX + podcastId, epochMs).apply()
    }

    fun getLastPlayedEpoch(context: Context, podcastId: String): Long {
        return prefs(context).getLong(KEY_LAST_PLAYED_PREFIX + podcastId, 0L)
    }

    /**
     * Mark an episode as played and update the podcast's last-played epoch if provided.
     * This should be used when we know the episode's publish date.
     */
    fun markPlayedWithMeta(context: Context, episodeId: String, podcastId: String?, pubDateEpochMs: Long?) {
        val current = getPlayedIds(context).toMutableSet()
        val wasAlreadyMarkedPlayed = current.contains(episodeId)

        // Always update the podcast's last-played epoch regardless of prior played status.
        // This handles the case where an episode was previously marked via markPlayed (no epoch),
        // ensuring the notification dot clears correctly once all episodes have been played.
        pubDateEpochMs?.let { epoch ->
            podcastId?.let { pid ->
                val existing = getLastPlayedEpoch(context, pid)
                if (epoch > existing) setLastPlayedEpoch(context, pid, epoch)
            }
        }

        if (!wasAlreadyMarkedPlayed) {
            current.add(episodeId)
            // Remove saved progress when episode is considered completed
            removeProgress(context, episodeId)
            prefs(context).edit().putStringSet(KEY_PLAYED_IDS, current).apply()
            // Broadcast change so UI can update
            val intent = android.content.Intent(ACTION_PLAYED_STATUS_CHANGED)
            context.sendBroadcast(intent)
        }
    }

    fun markUnplayed(context: Context, episodeId: String) {
        val current = getPlayedIds(context).toMutableSet()
        if (current.contains(episodeId)) {
            current.remove(episodeId)
            prefs(context).edit().putStringSet(KEY_PLAYED_IDS, current).apply()
            val intent = android.content.Intent(ACTION_PLAYED_STATUS_CHANGED)
            context.sendBroadcast(intent)
        }
    }

    // Playback position storage (milliseconds) --------------------------------------------------
    private fun progressKey(episodeId: String) = "progress_$episodeId"

    fun setProgress(context: Context, episodeId: String, positionMs: Long) {
        prefs(context).edit().putLong(progressKey(episodeId), positionMs).apply()
        // Broadcast change so UI (episode lists) can refresh progress display
        val intent = android.content.Intent(ACTION_PLAYED_STATUS_CHANGED)
        context.sendBroadcast(intent)
    }

    fun getProgress(context: Context, episodeId: String): Long {
        val key = progressKey(episodeId)
        val p = prefs(context)
        return try {
            p.getLong(key, 0L)
        } catch (e: ClassCastException) {
            // Handle legacy cases where the value was stored as an Integer (or other numeric types)
            val v = p.all[key]
            when (v) {
                is Number -> v.toLong()
                is String -> v.toLongOrNull() ?: 0L
                else -> 0L
            }
        }
    }

    fun removeProgress(context: Context, episodeId: String) {
        prefs(context).edit().remove(progressKey(episodeId)).apply()
    }

    fun getAllProgresses(context: Context): Map<String, Long> {
        val all = prefs(context).all
        val map = mutableMapOf<String, Long>()
        for ((k, v) in all) {
            if (k.startsWith("progress_")) {
                val id = k.removePrefix("progress_")
                val valueLong = when (v) {
                    is Number -> v.toLong()
                    is String -> v.toLongOrNull() ?: 0L
                    else -> 0L
                }
                if (valueLong > 0L) map[id] = valueLong
            }
        }
        return map
    }
}
