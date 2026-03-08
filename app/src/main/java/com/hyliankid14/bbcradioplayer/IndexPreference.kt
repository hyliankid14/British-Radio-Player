package com.hyliankid14.bbcradioplayer

import android.content.Context

object IndexPreference {
    private const val PREFS = "index_prefs"
    private const val KEY_INTERVAL_DAYS = "index_interval_days"
    private const val KEY_LAST_SCHEDULED_DAYS = "index_last_scheduled_days"
    private const val KEY_LAST_GENERATED_AT = "index_last_generated_at"
    private const val KEY_WIFI_ONLY = "index_wifi_only"

    // 0 = disabled, otherwise number of days.  Default is 0 (off) so new
    // installs do not automatically download the index until the user schedules it.
    fun getIntervalDays(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getInt(KEY_INTERVAL_DAYS, 0)
    }

    fun setIntervalDays(context: Context, days: Int) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putInt(KEY_INTERVAL_DAYS, days).apply()
    }

    fun getLastScheduledDays(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getInt(KEY_LAST_SCHEDULED_DAYS, 0)
    }

    fun setLastScheduledDays(context: Context, days: Int) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putInt(KEY_LAST_SCHEDULED_DAYS, days).apply()
    }

    /** ISO-8601 timestamp of the last successfully downloaded remote index. */
    fun getLastGeneratedAt(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getString(KEY_LAST_GENERATED_AT, null)
    }

    fun setLastGeneratedAt(context: Context, generatedAt: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_LAST_GENERATED_AT, generatedAt).apply()
    }

    fun getWifiOnly(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_WIFI_ONLY, false)
    }

    fun setWifiOnly(context: Context, wifiOnly: Boolean) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_WIFI_ONLY, wifiOnly).apply()
    }
}
