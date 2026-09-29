package com.hyliankid14.bbcradioplayer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Persist the last N played podcast episodes (most recent first).
 * Stored as a JSON array of objects in SharedPreferences so ordering is preserved.
 */
object PlayedHistoryPreference {
    const val ACTION_HISTORY_CHANGED = "com.hyliankid14.bbcradioplayer.action.HISTORY_CHANGED"
    private const val PREFS_NAME = "played_history_prefs"
    private const val KEY_HISTORY = "history_json"
    private const val MAX_ENTRIES = 20

    // Suppress re-adding entries that were just removed by the user to avoid races
    private const val REMOVAL_SUPPRESSION_MS = 5_000L
    private val recentRemovals = mutableMapOf<String, Long>()

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    data class Entry(
        val id: String,
        val title: String,
        val description: String,
        val imageUrl: String,
        val audioUrl: String,
        val pubDate: String,
        val durationMins: Int,
        val podcastId: String,
        val podcastTitle: String,
        val playedAtMs: Long
    )

    fun getHistory(context: Context): List<Entry> {
        val raw = prefs(context).getString(KEY_HISTORY, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            val list = mutableListOf<Entry>()
            for (i in 0 until arr.length()) {
                try {
                    val j = arr.getJSONObject(i)
                    val e = Entry(
                        id = j.optString("id", ""),
                        title = j.optString("title", ""),
                        description = j.optString("description", ""),
                        imageUrl = j.optString("imageUrl", ""),
                        audioUrl = j.optString("audioUrl", ""),
                        pubDate = j.optString("pubDate", ""),
                        durationMins = j.optInt("durationMins", 0),
                        podcastId = j.optString("podcastId", ""),
                        podcastTitle = j.optString("podcastTitle", ""),
                        playedAtMs = j.optLong("playedAtMs", 0L)
                    )
                    list.add(e)
                } catch (_: Exception) { }
            }
            // Already stored most-recent-first; ensure ordering and trimming
            list.sortedByDescending { it.playedAtMs }.take(MAX_ENTRIES)
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun addEntry(context: Context, episode: Episode, podcastTitle: String? = null) {
        try {
            val now = System.currentTimeMillis()

            // Clean out stale suppression entries
            val cutoff = now - REMOVAL_SUPPRESSION_MS
            recentRemovals.entries.removeIf { it.value < cutoff }

            // If this episode was recently removed by the user, suppress re-adding it for a short window
            val removedAt = recentRemovals[episode.id]
            if (removedAt != null && now - removedAt <= REMOVAL_SUPPRESSION_MS) {
                return
            }

            val current = getHistory(context).toMutableList()
            // Remove any existing with same id
            current.removeAll { it.id == episode.id }
            // Prepend new entry
            val entry = Entry(
                id = episode.id,
                title = episode.title,
                description = episode.description,
                imageUrl = episode.imageUrl,
                audioUrl = episode.audioUrl,
                pubDate = episode.pubDate,
                durationMins = episode.durationMins,
                podcastId = episode.podcastId,
                podcastTitle = podcastTitle ?: "",
                playedAtMs = now
            )
            current.add(0, entry)
            val trimmed = current.take(MAX_ENTRIES)
            val arr = JSONArray()
            for (e in trimmed) {
                val j = JSONObject()
                j.put("id", e.id)
                j.put("title", e.title)
                j.put("description", e.description)
                j.put("imageUrl", e.imageUrl)
                j.put("audioUrl", e.audioUrl)
                j.put("pubDate", e.pubDate)
                j.put("durationMins", e.durationMins)
                j.put("podcastId", e.podcastId)
                j.put("podcastTitle", e.podcastTitle)
                j.put("playedAtMs", e.playedAtMs)
                arr.put(j)
            }
            prefs(context).edit().putString(KEY_HISTORY, arr.toString()).commit()
            // Notify listeners that history has changed so UI can refresh consistently
            try { context.sendBroadcast(android.content.Intent(ACTION_HISTORY_CHANGED)) } catch (_: Exception) {}
        } catch (_: Exception) { }
    }

    fun removeEntry(context: Context, episodeId: String) {
        try {
            val current = getHistory(context).toMutableList()
            if (current.none { it.id == episodeId }) return
            current.removeAll { it.id == episodeId }
            val arr = JSONArray()
            for (e in current) {
                val j = JSONObject()
                j.put("id", e.id)
                j.put("title", e.title)
                j.put("description", e.description)
                j.put("imageUrl", e.imageUrl)
                j.put("audioUrl", e.audioUrl)
                j.put("pubDate", e.pubDate)
                j.put("durationMins", e.durationMins)
                j.put("podcastId", e.podcastId)
                j.put("podcastTitle", e.podcastTitle)
                j.put("playedAtMs", e.playedAtMs)
                arr.put(j)
            }
            prefs(context).edit().putString(KEY_HISTORY, arr.toString()).commit()

            // Record removal time to suppress accidental re-adds from other components
            try { recentRemovals[episodeId] = System.currentTimeMillis() } catch (_: Exception) { }

            // Notify listeners that history has changed so UI can refresh consistently
            try { context.sendBroadcast(android.content.Intent(ACTION_HISTORY_CHANGED)) } catch (_: Exception) {}
        } catch (_: Exception) {}
    }

    fun saveEntry(context: Context, entry: Entry) {
        try {
            val current = getHistory(context).toMutableList()
            // Remove any existing with same id to avoid duplicates
            current.removeAll { it.id == entry.id }
            // Prepend so it's most-recent-first
            current.add(0, entry)
            val trimmed = current.take(MAX_ENTRIES)
            val arr = JSONArray()
            for (e in trimmed) {
                val j = JSONObject()
                j.put("id", e.id)
                j.put("title", e.title)
                j.put("description", e.description)
                j.put("imageUrl", e.imageUrl)
                j.put("audioUrl", e.audioUrl)
                j.put("pubDate", e.pubDate)
                j.put("durationMins", e.durationMins)
                j.put("podcastId", e.podcastId)
                j.put("podcastTitle", e.podcastTitle)
                j.put("playedAtMs", e.playedAtMs)
                arr.put(j)
            }
            prefs(context).edit().putString(KEY_HISTORY, arr.toString()).commit()
            // Notify listeners that history has changed so UI can refresh consistently
            try { context.sendBroadcast(android.content.Intent(ACTION_HISTORY_CHANGED)) } catch (_: Exception) {}
        } catch (_: Exception) {}
    }

    fun clearAll(context: Context) {
        prefs(context).edit().remove(KEY_HISTORY).apply()
    }
}
