package com.hyliankid14.bbcradioplayer

import android.content.Context

object SubscribedPodcastSortPreference {
    const val SORT_MOST_RECENTLY_UPDATED = "most_recently_updated"
    const val SORT_LEAST_RECENTLY_UPDATED = "least_recently_updated"
    const val SORT_ALPHABETICAL = "alphabetical"
    const val SORT_MANUAL = "manual"

    private const val PREFS_NAME = "subscribed_podcast_sort_prefs"
    private const val KEY_SORT_ORDER = "sort_order"
    private const val KEY_MANUAL_ORDER = "manual_order"

    fun getSortOrder(context: Context): String {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_SORT_ORDER, SORT_MOST_RECENTLY_UPDATED) ?: SORT_MOST_RECENTLY_UPDATED
    }

    fun setSortOrder(context: Context, order: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_SORT_ORDER, order).apply()
    }

    fun getManualOrder(context: Context): List<String> {
        val json = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_MANUAL_ORDER, null) ?: return emptyList()
        return try {
            val arr = org.json.JSONArray(json)
            List(arr.length()) { arr.getString(it) }
        } catch (e: Exception) {
            android.util.Log.w("SubscribedPodcastSortPreference", "Failed to parse manual order: ${e.message}")
            emptyList()
        }
    }

    fun setManualOrder(context: Context, ids: List<String>) {
        val json = org.json.JSONArray(ids).toString()
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_MANUAL_ORDER, json).apply()
    }

    /**
     * Sort [podcasts] according to the saved sort order.
     * [updates] maps podcast ID → epoch ms of latest episode (used for time-based sorts).
     */
    fun applySortOrder(context: Context, podcasts: List<Podcast>, updates: Map<String, Long>): List<Podcast> {
        return when (getSortOrder(context)) {
            SORT_MOST_RECENTLY_UPDATED ->
                podcasts.sortedByDescending { updates[it.id] ?: 0L }
            SORT_LEAST_RECENTLY_UPDATED ->
                podcasts.sortedBy { updates[it.id] ?: Long.MAX_VALUE }
            SORT_ALPHABETICAL ->
                podcasts.sortedBy { it.title.lowercase() }
            SORT_MANUAL -> {
                val manualOrder = getManualOrder(context)
                if (manualOrder.isEmpty()) {
                    podcasts.sortedByDescending { updates[it.id] ?: 0L }
                } else {
                    val orderMap = manualOrder.mapIndexed { idx, id -> id to idx }.toMap()
                    podcasts.sortedWith(compareBy { orderMap[it.id] ?: Int.MAX_VALUE })
                }
            }
            else -> podcasts.sortedByDescending { updates[it.id] ?: 0L }
        }
    }
}
