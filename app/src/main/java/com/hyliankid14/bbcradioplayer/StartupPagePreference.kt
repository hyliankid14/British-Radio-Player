package com.hyliankid14.bbcradioplayer

import android.content.Context

object StartupPagePreference {
    private const val PREFS_NAME = "startup_prefs"
    private const val KEY_STARTUP_PAGE = "startup_page"

    const val STARTUP_PAGE_FAVOURITES = "favourites"
    const val STARTUP_PAGE_ALL_STATIONS = "all_stations"
    const val STARTUP_PAGE_PODCASTS = "podcasts"

    const val STARTUP_PAGE_DEFAULT = STARTUP_PAGE_ALL_STATIONS

    fun getStartupPage(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_STARTUP_PAGE, STARTUP_PAGE_DEFAULT) ?: STARTUP_PAGE_DEFAULT
        return when (raw) {
            STARTUP_PAGE_FAVOURITES,
            STARTUP_PAGE_ALL_STATIONS,
            STARTUP_PAGE_PODCASTS -> raw
            else -> STARTUP_PAGE_DEFAULT
        }
    }

    fun setStartupPage(context: Context, value: String) {
        val resolved = when (value) {
            STARTUP_PAGE_FAVOURITES,
            STARTUP_PAGE_ALL_STATIONS,
            STARTUP_PAGE_PODCASTS -> value
            else -> STARTUP_PAGE_DEFAULT
        }
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_STARTUP_PAGE, resolved).apply()
    }

    fun isValid(value: String?): Boolean {
        return value == STARTUP_PAGE_FAVOURITES ||
            value == STARTUP_PAGE_ALL_STATIONS ||
            value == STARTUP_PAGE_PODCASTS
    }
}
