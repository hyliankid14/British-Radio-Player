package com.hyliankid14.bbcradioplayer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Persist the last N songs played on live radio stations (most recent first).
 * Stores artist, track, artwork URL, station name, and timestamp.
 */
object RecentSongsPreference {
    const val ACTION_RECENT_SONGS_CHANGED = "com.hyliankid14.bbcradioplayer.action.RECENT_SONGS_CHANGED"
    private const val PREFS_NAME = "recent_songs_prefs"
    private const val KEY_SONGS = "songs_json"
    const val MAX_ENTRIES = 50

    data class SongEntry(
        val artist: String,
        val track: String,
        val imageUrl: String,
        val stationId: String,
        val stationName: String,
        val playedAtMs: Long
    )

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getSongs(context: Context): List<SongEntry> {
        val raw = prefs(context).getString(KEY_SONGS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            val list = mutableListOf<SongEntry>()
            for (i in 0 until arr.length()) {
                try {
                    val j = arr.getJSONObject(i)
                    list.add(
                        SongEntry(
                            artist = j.optString("artist", ""),
                            track = j.optString("track", ""),
                            imageUrl = j.optString("imageUrl", ""),
                            stationId = j.optString("stationId", ""),
                            stationName = j.optString("stationName", ""),
                            playedAtMs = j.optLong("playedAtMs", 0L)
                        )
                    )
                } catch (_: Exception) { }
            }
            list.sortedByDescending { it.playedAtMs }.take(MAX_ENTRIES)
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun addSong(
        context: Context,
        artist: String,
        track: String,
        imageUrl: String,
        stationId: String,
        stationName: String
    ) {
        if (artist.isBlank() && track.isBlank()) return
        try {
            val now = System.currentTimeMillis()
            val current = getSongs(context).toMutableList()
            // Avoid duplicate consecutive entries for the same song
            if (current.isNotEmpty()) {
                val last = current[0]
                if (last.artist == artist && last.track == track && last.stationId == stationId) return
            }
            current.add(
                0, SongEntry(
                    artist = artist,
                    track = track,
                    imageUrl = imageUrl,
                    stationId = stationId,
                    stationName = stationName,
                    playedAtMs = now
                )
            )
            val trimmed = current.take(MAX_ENTRIES)
            val arr = JSONArray()
            for (e in trimmed) {
                val j = JSONObject()
                j.put("artist", e.artist)
                j.put("track", e.track)
                j.put("imageUrl", e.imageUrl)
                j.put("stationId", e.stationId)
                j.put("stationName", e.stationName)
                j.put("playedAtMs", e.playedAtMs)
                arr.put(j)
            }
            prefs(context).edit().putString(KEY_SONGS, arr.toString()).commit()
            try {
                context.sendBroadcast(android.content.Intent(ACTION_RECENT_SONGS_CHANGED))
            } catch (_: Exception) { }
        } catch (_: Exception) { }
    }

    fun clearAll(context: Context) {
        prefs(context).edit().remove(KEY_SONGS).apply()
        try {
            context.sendBroadcast(android.content.Intent(ACTION_RECENT_SONGS_CHANGED))
        } catch (_: Exception) { }
    }
}
