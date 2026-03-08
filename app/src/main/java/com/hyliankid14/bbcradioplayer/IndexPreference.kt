package com.hyliankid14.bbcradioplayer

import android.content.Context

object IndexPreference {
    private const val PREFS = "index_prefs"
    private const val KEY_INTERVAL_DAYS = "index_interval_days"
    private const val KEY_LAST_SCHEDULED_DAYS = "index_last_scheduled_days"
    private const val KEY_LAST_GENERATED_AT = "index_last_generated_at"

    // 0 = disabled, otherwise number of days.  Default is 1 (daily) so new
    // installs automatically keep the podcast index up to date hands-free.
    fun getIntervalDays(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getInt(KEY_INTERVAL_DAYS, 1)
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
}
