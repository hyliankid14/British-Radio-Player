package com.hyliankid14.bbcradioplayer

import android.content.Context

object SubscriptionRefreshPreference {
    private const val PREFS = "subscription_refresh_prefs"
    private const val KEY_INTERVAL_MINUTES = "refresh_interval_minutes"
    private const val DEFAULT_INTERVAL_MINUTES = 60 // Default: 60 minutes, 0 = disabled

    // 0 = disabled, otherwise number of minutes
    fun getIntervalMinutes(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getInt(KEY_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES)
    }

    fun setIntervalMinutes(context: Context, minutes: Int) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putInt(KEY_INTERVAL_MINUTES, minutes).apply()
    }
}
