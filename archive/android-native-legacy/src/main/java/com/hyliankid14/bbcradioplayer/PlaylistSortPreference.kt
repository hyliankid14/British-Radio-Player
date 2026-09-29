package com.hyliankid14.bbcradioplayer

import android.content.Context

object PlaylistSortPreference {
    const val SORT_NEWEST_FIRST = "newest_first"
    const val SORT_OLDEST_FIRST = "oldest_first"
    const val SORT_TITLE = "title"
    const val SORT_MANUAL = "manual"

    private const val PREFS_NAME = "playlist_sort_prefs"
    private const val KEY_SORT_PREFIX = "sort_"
    private const val KEY_MANUAL_PREFIX = "manual_"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getSortOrder(context: Context, playlistId: String): String {
        return prefs(context).getString(KEY_SORT_PREFIX + playlistId, SORT_NEWEST_FIRST) ?: SORT_NEWEST_FIRST
    }

    fun setSortOrder(context: Context, playlistId: String, order: String) {
        val resolved = when (order) {
            SORT_OLDEST_FIRST, SORT_TITLE, SORT_MANUAL -> order
            else -> SORT_NEWEST_FIRST
        }
        prefs(context).edit().putString(KEY_SORT_PREFIX + playlistId, resolved).apply()
    }

    fun getManualOrder(context: Context, playlistId: String): List<String> {
        val raw = prefs(context).getString(KEY_MANUAL_PREFIX + playlistId, null) ?: return emptyList()
        return try {
            val array = org.json.JSONArray(raw)
            List(array.length()) { index -> array.getString(index) }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun setManualOrder(context: Context, playlistId: String, ids: List<String>) {
        prefs(context).edit().putString(KEY_MANUAL_PREFIX + playlistId, org.json.JSONArray(ids).toString()).apply()
    }

    fun applySort(context: Context, playlistId: String, entries: List<PodcastPlaylists.Entry>): List<PodcastPlaylists.Entry> {
        fun publishedEpoch(entry: PodcastPlaylists.Entry): Long {
            val parsed = EpisodeDateParser.parsePubDateToEpoch(entry.pubDate)
            return if (parsed > 0L) parsed else entry.savedAtMs
        }

        return when (getSortOrder(context, playlistId)) {
            SORT_OLDEST_FIRST -> entries.sortedBy { publishedEpoch(it) }
            SORT_TITLE -> entries.sortedBy { it.title.lowercase() }
            SORT_MANUAL -> {
                val manual = getManualOrder(context, playlistId)
                if (manual.isEmpty()) {
                    entries
                } else {
                    val indexMap = manual.mapIndexed { index, id -> id to index }.toMap()
                    entries.sortedWith(compareBy({ indexMap[it.id] ?: Int.MAX_VALUE }, { -publishedEpoch(it) }))
                }
            }
            else -> entries.sortedByDescending { publishedEpoch(it) }
        }
    }
}
