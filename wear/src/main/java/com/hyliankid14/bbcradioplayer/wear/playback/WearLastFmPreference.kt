package com.hyliankid14.bbcradioplayer.wear.playback

import android.content.Context
import android.content.SharedPreferences
import com.hyliankid14.bbcradioplayer.wear.BuildConfig

object WearLastFmPreference {
    private const val PREFS_NAME = "wear_lastfm_prefs"

    private const val KEY_SESSION_KEY = "session_key"
    private const val KEY_USERNAME = "username"
    private const val KEY_DIRECT_SCROBBLE_ENABLED = "direct_scrobble_enabled"
    private const val KEY_BROADCAST_SCROBBLE_ENABLED = "broadcast_scrobble_enabled"
    private const val KEY_SCROBBLE_PODCASTS = "scrobble_podcasts"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun isLoggedIn(context: Context): Boolean =
        !prefs(context).getString(KEY_SESSION_KEY, null).isNullOrBlank()

    fun getSessionKey(context: Context): String? =
        prefs(context).getString(KEY_SESSION_KEY, null)?.takeIf { it.isNotBlank() }

    fun getUsername(context: Context): String? =
        prefs(context).getString(KEY_USERNAME, null)?.takeIf { it.isNotBlank() }

    fun isDirectScrobbleEnabled(context: Context): Boolean =
        isLoggedIn(context) && prefs(context).getBoolean(KEY_DIRECT_SCROBBLE_ENABLED, true)

    fun isBroadcastScrobbleEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_BROADCAST_SCROBBLE_ENABLED, true)

    fun shouldScrobblePodcasts(context: Context): Boolean =
        prefs(context).getBoolean(KEY_SCROBBLE_PODCASTS, false)

    fun updateFromSync(
        context: Context,
        sessionKey: String,
        username: String,
        directEnabled: Boolean,
        broadcastEnabled: Boolean,
        scrobblePodcasts: Boolean
    ) {
        prefs(context).edit().apply {
            if (sessionKey.isNotBlank()) {
                putString(KEY_SESSION_KEY, sessionKey)
                putString(KEY_USERNAME, username)
            } else {
                remove(KEY_SESSION_KEY)
                remove(KEY_USERNAME)
            }
            putBoolean(KEY_DIRECT_SCROBBLE_ENABLED, directEnabled)
            putBoolean(KEY_BROADCAST_SCROBBLE_ENABLED, broadcastEnabled)
            putBoolean(KEY_SCROBBLE_PODCASTS, scrobblePodcasts)
            apply()
        }
    }

    fun getEffectiveApiKey(): String = BuildConfig.LASTFM_API_KEY

    fun getEffectiveApiSecret(): String = BuildConfig.LASTFM_API_SECRET
}
