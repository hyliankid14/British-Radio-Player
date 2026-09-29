package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.content.SharedPreferences

object LastFmPreference {
    private const val PREFS_NAME = "lastfm_prefs"

    private const val KEY_SESSION_KEY = "session_key"
    private const val KEY_USERNAME = "username"
    private const val KEY_DIRECT_SCROBBLE_ENABLED = "direct_scrobble_enabled"
    private const val KEY_BROADCAST_SCROBBLE_ENABLED = "broadcast_scrobble_enabled"
    private const val KEY_SCROBBLE_PODCASTS = "scrobble_podcasts"
    private const val KEY_LAST_SCROBBLED_TRACK = "last_scrobbled_track"
    private const val KEY_LAST_SCROBBLED_TIME_MS = "last_scrobbled_time_ms"
    private const val KEY_CUSTOM_API_KEY = "custom_api_key"
    private const val KEY_CUSTOM_API_SECRET = "custom_api_secret"

    const val ACTION_LASTFM_STATE_CHANGED = "com.hyliankid14.bbcradioplayer.action.LASTFM_STATE_CHANGED"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun isLoggedIn(context: Context): Boolean =
        !prefs(context).getString(KEY_SESSION_KEY, null).isNullOrBlank()

    fun getSessionKey(context: Context): String? =
        prefs(context).getString(KEY_SESSION_KEY, null)?.takeIf { it.isNotBlank() }

    fun getUsername(context: Context): String? =
        prefs(context).getString(KEY_USERNAME, null)?.takeIf { it.isNotBlank() }

    fun saveSession(context: Context, username: String, sessionKey: String) {
        prefs(context).edit()
            .putString(KEY_USERNAME, username)
            .putString(KEY_SESSION_KEY, sessionKey)
            .putBoolean(KEY_DIRECT_SCROBBLE_ENABLED, true)
            .apply()
        notifyChanged(context)
    }

    fun clearSession(context: Context) {
        prefs(context).edit()
            .remove(KEY_SESSION_KEY)
            .remove(KEY_USERNAME)
            .remove(KEY_DIRECT_SCROBBLE_ENABLED)
            .apply()
        notifyChanged(context)
    }

    fun isDirectScrobbleEnabled(context: Context): Boolean {
        // Only enabled if the user is actually logged in and hasn't toggled it off
        return isLoggedIn(context) && prefs(context).getBoolean(KEY_DIRECT_SCROBBLE_ENABLED, true)
    }

    fun setDirectScrobbleEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_DIRECT_SCROBBLE_ENABLED, enabled).apply()
        notifyChanged(context)
    }

    fun isBroadcastScrobbleEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_BROADCAST_SCROBBLE_ENABLED, true)

    fun setBroadcastScrobbleEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_BROADCAST_SCROBBLE_ENABLED, enabled).apply()
        notifyChanged(context)
    }

    fun shouldScrobblePodcasts(context: Context): Boolean =
        prefs(context).getBoolean(KEY_SCROBBLE_PODCASTS, false)

    fun setScrobblePodcasts(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_SCROBBLE_PODCASTS, enabled).apply()
        notifyChanged(context)
    }

    fun getLastScrobbled(context: Context): Pair<String, Long>? {
        val track = prefs(context).getString(KEY_LAST_SCROBBLED_TRACK, null) ?: return null
        val timeMs = prefs(context).getLong(KEY_LAST_SCROBBLED_TIME_MS, 0L)
        return Pair(track, timeMs)
    }

    fun setLastScrobbled(context: Context, trackInfo: String, timeMs: Long = System.currentTimeMillis()) {
        prefs(context).edit()
            .putString(KEY_LAST_SCROBBLED_TRACK, trackInfo)
            .putLong(KEY_LAST_SCROBBLED_TIME_MS, timeMs)
            .apply()
        notifyChanged(context)
    }

    fun getEffectiveApiKey(context: Context): String {
        val custom = prefs(context).getString(KEY_CUSTOM_API_KEY, null)?.trim()
        if (!custom.isNullOrEmpty()) return custom
        return BuildConfig.LASTFM_API_KEY
    }

    fun getEffectiveApiSecret(context: Context): String {
        val custom = prefs(context).getString(KEY_CUSTOM_API_SECRET, null)?.trim()
        if (!custom.isNullOrEmpty()) return custom
        return BuildConfig.LASTFM_API_SECRET
    }

    fun getCustomApiKey(context: Context): String =
        prefs(context).getString(KEY_CUSTOM_API_KEY, "") ?: ""

    fun getCustomApiSecret(context: Context): String =
        prefs(context).getString(KEY_CUSTOM_API_SECRET, "") ?: ""

    fun setCustomCredentials(context: Context, apiKey: String?, apiSecret: String?) {
        val editor = prefs(context).edit()
        if (apiKey.isNullOrBlank()) {
            editor.remove(KEY_CUSTOM_API_KEY)
        } else {
            editor.putString(KEY_CUSTOM_API_KEY, apiKey.trim())
        }
        if (apiSecret.isNullOrBlank()) {
            editor.remove(KEY_CUSTOM_API_SECRET)
        } else {
            editor.putString(KEY_CUSTOM_API_SECRET, apiSecret.trim())
        }
        editor.apply()
        notifyChanged(context)
    }

    private fun notifyChanged(context: Context) {
        try {
            context.sendBroadcast(
                android.content.Intent(ACTION_LASTFM_STATE_CHANGED)
                    .setPackage(context.packageName)
            )
        } catch (_: Exception) { }
        try {
            WearAppStateSync.pushCurrentState(context)
        } catch (_: Exception) { }
    }
}
