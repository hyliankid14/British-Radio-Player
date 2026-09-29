package com.hyliankid14.bbcradioplayer

import android.content.Context

object ScrollingPreference {
    private const val PREFS_NAME = "scrolling_prefs"
    private const val KEY_SCROLL_MODE = "scroll_mode"
    
    const val MODE_ALL_STATIONS = "all_stations"
    const val MODE_FAVORITES = "favorites"

    fun getScrollMode(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_SCROLL_MODE, MODE_ALL_STATIONS) ?: MODE_ALL_STATIONS
    }

    fun setScrollMode(context: Context, mode: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_SCROLL_MODE, mode).apply()
    }
}
