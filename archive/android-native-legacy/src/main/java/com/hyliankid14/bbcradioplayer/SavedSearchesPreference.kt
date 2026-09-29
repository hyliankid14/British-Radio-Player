package com.hyliankid14.bbcradioplayer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object SavedSearchesPreference {
    private const val PREFS = "saved_searches_prefs"
    private const val KEY = "saved_searches_json"

    data class SavedSearch(
        val id: String,
        val name: String,
        val query: String,
        val genres: List<String>,
        val minDuration: Int,
        val maxDuration: Int,
        val sort: String,
        val notificationsEnabled: Boolean,
        val lastSeenEpisodeIds: List<String>,
        val createdAt: Long,
        val lastMatchEpoch: Long
    )

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun getSavedSearches(context: Context): List<SavedSearch> {
        val raw = prefs(context).getString(KEY, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            val list = mutableListOf<SavedSearch>()
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                list.add(fromJson(obj))
            }
            list.sortedBy { it.createdAt }
        } catch (_: Exception) {
            emptyList()
        }
    }

    @Synchronized
    fun getSearchById(context: Context, id: String): SavedSearch? {
        return getSavedSearches(context).firstOrNull { it.id == id }
    }

    @Synchronized
    fun saveSearch(context: Context, search: SavedSearch) {
        val list = getSavedSearches(context).toMutableList()
        val idx = list.indexOfFirst { it.id == search.id }
        if (idx >= 0) list[idx] = search else list.add(search)
        persist(context, list)
    }

    @Synchronized
    fun updateSearchName(context: Context, id: String, name: String) {
        val list = getSavedSearches(context).toMutableList()
        val idx = list.indexOfFirst { it.id == id }
        if (idx == -1) return
        val existing = list[idx]
        list[idx] = existing.copy(name = name)
        persist(context, list)
    }

    @Synchronized
    fun updateSearchQuery(context: Context, id: String, query: String) {
        val list = getSavedSearches(context).toMutableList()
        val idx = list.indexOfFirst { it.id == id }
        if (idx == -1) return
        val existing = list[idx]
        list[idx] = existing.copy(
            query = query,
            lastSeenEpisodeIds = emptyList(),
            lastMatchEpoch = 0L
        )
        persist(context, list)
    }

    @Synchronized
    fun updateNotifications(context: Context, id: String, enabled: Boolean) {
        val list = getSavedSearches(context).toMutableList()
        val idx = list.indexOfFirst { it.id == id }
        if (idx == -1) return
        val existing = list[idx]
        list[idx] = existing.copy(notificationsEnabled = enabled)
        persist(context, list)
    }

    @Synchronized
    fun updateLastSeenEpisodeIds(context: Context, id: String, ids: List<String>, lastMatchEpoch: Long? = null) {
        val list = getSavedSearches(context).toMutableList()
        val idx = list.indexOfFirst { it.id == id }
        if (idx == -1) return
        val existing = list[idx]
        list[idx] = if (lastMatchEpoch == null) {
            existing.copy(lastSeenEpisodeIds = ids)
        } else {
            existing.copy(lastSeenEpisodeIds = ids, lastMatchEpoch = lastMatchEpoch)
        }
        persist(context, list)
    }

    @Synchronized
    fun updateLastMatchEpoch(context: Context, id: String, lastMatchEpoch: Long) {
        val list = getSavedSearches(context).toMutableList()
        val idx = list.indexOfFirst { it.id == id }
        if (idx == -1) return
        val existing = list[idx]
        list[idx] = existing.copy(lastMatchEpoch = lastMatchEpoch)
        persist(context, list)
    }

    @Synchronized
    fun removeSearch(context: Context, id: String) {
        val list = getSavedSearches(context).filterNot { it.id == id }
        persist(context, list)
    }

    private fun persist(context: Context, list: List<SavedSearch>) {
        val arr = JSONArray()
        list.forEach { arr.put(toJson(it)) }
        prefs(context).edit().putString(KEY, arr.toString()).apply()
    }

    private fun toJson(search: SavedSearch): JSONObject {
        val obj = JSONObject()
        obj.put("id", search.id)
        obj.put("name", search.name)
        obj.put("query", search.query)
        obj.put("minDuration", search.minDuration)
        obj.put("maxDuration", search.maxDuration)
        obj.put("sort", search.sort)
        obj.put("notificationsEnabled", search.notificationsEnabled)
        obj.put("createdAt", search.createdAt)
        obj.put("lastMatchEpoch", search.lastMatchEpoch)

        val genresArr = JSONArray()
        search.genres.forEach { genresArr.put(it) }
        obj.put("genres", genresArr)

        val episodesArr = JSONArray()
        search.lastSeenEpisodeIds.forEach { episodesArr.put(it) }
        obj.put("lastSeenEpisodeIds", episodesArr)

        return obj
    }

    private fun fromJson(obj: JSONObject): SavedSearch {
        val genres = mutableListOf<String>()
        val genresArr = obj.optJSONArray("genres")
        if (genresArr != null) {
            for (i in 0 until genresArr.length()) {
                genres.add(genresArr.optString(i))
            }
        }

        val episodes = mutableListOf<String>()
        val episodesArr = obj.optJSONArray("lastSeenEpisodeIds")
        if (episodesArr != null) {
            for (i in 0 until episodesArr.length()) {
                episodes.add(episodesArr.optString(i))
            }
        }

        return SavedSearch(
            id = obj.optString("id"),
            name = obj.optString("name"),
            query = obj.optString("query"),
            genres = genres,
            minDuration = obj.optInt("minDuration", 0),
            maxDuration = obj.optInt("maxDuration", 300),
            sort = obj.optString("sort", "Most popular"),
            notificationsEnabled = obj.optBoolean("notificationsEnabled", false),
            lastSeenEpisodeIds = episodes,
            createdAt = obj.optLong("createdAt", System.currentTimeMillis()),
            lastMatchEpoch = obj.optLong("lastMatchEpoch", 0L)
        )
    }
}
