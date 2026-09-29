package com.hyliankid14.bbcradioplayer

import android.content.Context

object PodcastFilterPreference {
    private const val PREFS = "podcast_filter_prefs"
    private const val KEY_EXCLUDE_NON_ENGLISH = "exclude_non_english"

    fun excludeNonEnglish(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_EXCLUDE_NON_ENGLISH, false)
    }

    fun setExcludeNonEnglish(context: Context, exclude: Boolean) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_EXCLUDE_NON_ENGLISH, exclude).apply()
    }
}
