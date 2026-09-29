package com.hyliankid14.bbcradioplayer

import android.content.Context

/**
 * Stores preferences for podcast episode auto-download feature.
 */
object DownloadPreferences {
    private const val PREFS_NAME = "download_prefs"
    private const val KEY_AUTO_DOWNLOAD_ENABLED = "auto_download_enabled"
    private const val KEY_AUTO_DOWNLOAD_LIMIT = "auto_download_limit"
    private const val KEY_DOWNLOAD_ON_WIFI_ONLY = "download_on_wifi_only"
    private const val KEY_DELETE_ON_PLAYED = "delete_on_played"
    private const val KEY_AUTO_DOWNLOAD_SAVED = "auto_download_saved"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun isAutoDownloadEnabled(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_AUTO_DOWNLOAD_ENABLED, false)
    }

    fun setAutoDownloadEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_AUTO_DOWNLOAD_ENABLED, enabled).apply()
    }

    /**
     * Get the maximum number of episodes to auto-download per podcast.
     * 0 = no limit, 1 = latest episode only, 2, 3, 5, 10 = that many latest episodes
     */
    fun getAutoDownloadLimit(context: Context): Int {
        return prefs(context).getInt(KEY_AUTO_DOWNLOAD_LIMIT, 1)
    }

    fun setAutoDownloadLimit(context: Context, limit: Int) {
        prefs(context).edit().putInt(KEY_AUTO_DOWNLOAD_LIMIT, limit).apply()
    }

    fun isDownloadOnWifiOnly(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_DOWNLOAD_ON_WIFI_ONLY, true)
    }

    fun setDownloadOnWifiOnly(context: Context, wifiOnly: Boolean) {
        prefs(context).edit().putBoolean(KEY_DOWNLOAD_ON_WIFI_ONLY, wifiOnly).apply()
    }

    fun isDeleteOnPlayed(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_DELETE_ON_PLAYED, false)
    }

    fun setDeleteOnPlayed(context: Context, deleteOnPlayed: Boolean) {
        prefs(context).edit().putBoolean(KEY_DELETE_ON_PLAYED, deleteOnPlayed).apply()
    }

    fun isAutoDownloadSaved(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_AUTO_DOWNLOAD_SAVED, false)
    }

    fun setAutoDownloadSaved(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_AUTO_DOWNLOAD_SAVED, enabled).apply()
    }
}
