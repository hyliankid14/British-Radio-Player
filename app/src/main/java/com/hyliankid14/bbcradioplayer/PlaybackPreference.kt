package com.hyliankid14.bbcradioplayer

import android.content.Context

object PlaybackPreference {
    private const val PREFS_NAME = "playback_prefs"
    private const val KEY_LAST_STATION_ID = "last_station_id"
    private const val KEY_LAST_MEDIA_ID = "last_media_id"
    private const val KEY_AUTO_RESUME_ANDROID_AUTO = "auto_resume_android_auto"
    private const val KEY_HIDE_PLAYED_ANDROID_AUTO = "hide_played_android_auto"
    private const val KEY_HIDE_PLAYED_PODCAST_DETAIL_PREFIX = "hide_played_podcast_detail_"
    private const val KEY_SHAKE_RANDOM_PODCAST = "shake_random_podcast"
    private const val KEY_PODCAST_ARTWORK_SOURCE = "podcast_artwork_source"
    private const val KEY_AUTOPLAY_NEXT_EPISODE = "autoplay_next_episode"

    const val ARTWORK_SOURCE_EPISODE = "episode"
    const val ARTWORK_SOURCE_PODCAST = "podcast"

    const val AUTOPLAY_NEXT_ALL = "all_podcasts"
    const val AUTOPLAY_NEXT_SUBSCRIPTIONS = "subscriptions_only"
    const val AUTOPLAY_NEXT_NONE = "none"

    fun setLastStationId(context: Context, stationId: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        // Save both legacy station key and new media id for compatibility
        prefs.edit().putString(KEY_LAST_STATION_ID, stationId).putString(KEY_LAST_MEDIA_ID, "station_$stationId").apply()
    }

    fun getLastStationId(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_LAST_STATION_ID, null)
    }

    fun setLastMediaId(context: Context, mediaId: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_LAST_MEDIA_ID, mediaId).apply()
    }

    fun getLastMediaId(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val media = prefs.getString(KEY_LAST_MEDIA_ID, null)
        if (media != null) return media
        // Fall back to legacy station id if present
        val lastStation = prefs.getString(KEY_LAST_STATION_ID, null)
        return if (lastStation != null) "station_$lastStation" else null
    }

    fun setAutoResumeAndroidAuto(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_AUTO_RESUME_ANDROID_AUTO, enabled).apply()
    }

    fun isAutoResumeAndroidAutoEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_AUTO_RESUME_ANDROID_AUTO, false)
    }

    fun setHidePlayedEpisodesInAndroidAuto(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_HIDE_PLAYED_ANDROID_AUTO, enabled).apply()
    }

    fun isHidePlayedEpisodesInAndroidAutoEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_HIDE_PLAYED_ANDROID_AUTO, false)
    }

    fun setHidePlayedEpisodesInPodcastDetail(context: Context, podcastId: String, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_HIDE_PLAYED_PODCAST_DETAIL_PREFIX + podcastId, enabled).apply()
    }

    fun isHidePlayedEpisodesInPodcastDetailEnabled(context: Context, podcastId: String): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_HIDE_PLAYED_PODCAST_DETAIL_PREFIX + podcastId, false)
    }

    fun setShakeRandomPodcastEnabled(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_SHAKE_RANDOM_PODCAST, enabled).apply()
    }

    fun isShakeRandomPodcastEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_SHAKE_RANDOM_PODCAST, false)
    }

    fun setPodcastArtworkSource(context: Context, source: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val resolved = if (source == ARTWORK_SOURCE_PODCAST) ARTWORK_SOURCE_PODCAST else ARTWORK_SOURCE_EPISODE
        prefs.edit().putString(KEY_PODCAST_ARTWORK_SOURCE, resolved).apply()
    }

    fun getPodcastArtworkSource(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_PODCAST_ARTWORK_SOURCE, ARTWORK_SOURCE_EPISODE) ?: ARTWORK_SOURCE_EPISODE
    }

    fun setAutoplayNextEpisode(context: Context, value: String) {
        val resolved = when (value) {
            AUTOPLAY_NEXT_ALL, AUTOPLAY_NEXT_SUBSCRIPTIONS -> value
            else -> AUTOPLAY_NEXT_NONE
        }
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_AUTOPLAY_NEXT_EPISODE, resolved).apply()
    }

    fun getAutoplayNextEpisode(context: Context): String {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_AUTOPLAY_NEXT_EPISODE, AUTOPLAY_NEXT_NONE) ?: AUTOPLAY_NEXT_NONE
    }
}
