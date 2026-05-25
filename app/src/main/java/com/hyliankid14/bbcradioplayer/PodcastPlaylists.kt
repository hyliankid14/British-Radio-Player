package com.hyliankid14.bbcradioplayer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object PodcastPlaylists {
    private const val PREFS_NAME = "podcast_playlists_prefs"
    private const val KEY_PLAYLISTS = "playlists"
    private const val KEY_MIGRATED = "migrated_saved_episodes"

    const val DEFAULT_PLAYLIST_ID = "saved"
    const val ACTION_PLAYLISTS_CHANGED = "com.hyliankid14.bbcradioplayer.action.PLAYLISTS_CHANGED"

    private const val LEGACY_SAVED_PREFS = "saved_episodes_prefs"
    private const val LEGACY_SAVED_SET = "saved_set"

    data class PlaylistSummary(
        val id: String,
        val name: String,
        val createdAtMs: Long,
        val updatedAtMs: Long,
        val itemCount: Int,
        val isDefault: Boolean
    )

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
        val savedAtMs: Long
    )

    private data class PlaylistData(
        val id: String,
        val name: String,
        val createdAtMs: Long,
        val updatedAtMs: Long,
        val isDefault: Boolean,
        val entries: List<Entry>
    )

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun readLegacySavedEntries(context: Context): List<Entry> {
        val set = context.getSharedPreferences(LEGACY_SAVED_PREFS, Context.MODE_PRIVATE)
            .getStringSet(LEGACY_SAVED_SET, emptySet()) ?: emptySet()
        val list = mutableListOf<Entry>()
        for (raw in set) {
            try {
                val json = JSONObject(raw)
                list.add(entryFromJson(json))
            } catch (_: Exception) { }
        }
        return list.sortedByDescending { it.savedAtMs }
    }

    private fun ensureMigrated(context: Context) {
        val prefs = prefs(context)
        if (prefs.getBoolean(KEY_MIGRATED, false)) {
            if (prefs.getString(KEY_PLAYLISTS, null).isNullOrBlank()) {
                writePlaylists(context, listOf(defaultPlaylist(emptyList())))
            }
            return
        }

        val legacyEntries = readLegacySavedEntries(context)
        val existing = prefs.getString(KEY_PLAYLISTS, null)
        val playlists = if (existing.isNullOrBlank()) {
            listOf(defaultPlaylist(legacyEntries))
        } else {
            val parsed = parsePlaylists(existing).toMutableList()
            val existingDefaultIndex = parsed.indexOfFirst { it.id == DEFAULT_PLAYLIST_ID }
            if (existingDefaultIndex >= 0) {
                val currentDefault = parsed[existingDefaultIndex]
                if (currentDefault.entries.isEmpty() && legacyEntries.isNotEmpty()) {
                    parsed[existingDefaultIndex] = currentDefault.copy(entries = legacyEntries, updatedAtMs = legacyEntries.maxOfOrNull { it.savedAtMs } ?: currentDefault.updatedAtMs)
                }
            } else {
                parsed.add(0, defaultPlaylist(legacyEntries))
            }
            parsed
        }

        writePlaylists(context, playlists)
        prefs.edit().putBoolean(KEY_MIGRATED, true).apply()
    }

    private fun defaultPlaylist(entries: List<Entry>): PlaylistData {
        val now = System.currentTimeMillis()
        return PlaylistData(
            id = DEFAULT_PLAYLIST_ID,
            name = "Saved Episodes",
            createdAtMs = now,
            updatedAtMs = entries.maxOfOrNull { it.savedAtMs } ?: now,
            isDefault = true,
            entries = entries.sortedByDescending { it.savedAtMs }
        )
    }

    private fun parsePlaylists(raw: String): List<PlaylistData> {
        val array = JSONArray(raw)
        val playlists = mutableListOf<PlaylistData>()
        for (index in 0 until array.length()) {
            val json = array.optJSONObject(index) ?: continue
            val entriesArray = json.optJSONArray("entries") ?: JSONArray()
            val entries = mutableListOf<Entry>()
            for (entryIndex in 0 until entriesArray.length()) {
                val entryJson = entriesArray.optJSONObject(entryIndex) ?: continue
                try {
                    entries.add(entryFromJson(entryJson))
                } catch (_: Exception) { }
            }
            val id = json.optString("id", "")
            if (id.isBlank()) continue
            playlists.add(
                PlaylistData(
                    id = id,
                    name = json.optString("name", if (id == DEFAULT_PLAYLIST_ID) "Saved Episodes" else "Playlist"),
                    createdAtMs = json.optLong("createdAtMs", System.currentTimeMillis()),
                    updatedAtMs = json.optLong("updatedAtMs", System.currentTimeMillis()),
                    isDefault = json.optBoolean("isDefault", id == DEFAULT_PLAYLIST_ID),
                    entries = entries.sortedByDescending { it.savedAtMs }
                )
            )
        }
        if (playlists.none { it.id == DEFAULT_PLAYLIST_ID }) {
            playlists.add(0, defaultPlaylist(emptyList()))
        }
        return playlists.sortedWith(compareByDescending<PlaylistData> { it.isDefault }.thenByDescending { it.updatedAtMs })
    }

    private fun loadPlaylists(context: Context): MutableList<PlaylistData> {
        ensureMigrated(context)
        val raw = prefs(context).getString(KEY_PLAYLISTS, null)
        return if (raw.isNullOrBlank()) {
            mutableListOf(defaultPlaylist(emptyList()))
        } else {
            parsePlaylists(raw).toMutableList()
        }
    }

    private fun writePlaylists(context: Context, playlists: List<PlaylistData>) {
        val array = JSONArray()
        val normalised = playlists
            .distinctBy { it.id }
            .sortedWith(compareByDescending<PlaylistData> { it.isDefault }.thenByDescending { it.updatedAtMs })
        for (playlist in normalised) {
            val json = JSONObject()
            json.put("id", playlist.id)
            json.put("name", playlist.name)
            json.put("createdAtMs", playlist.createdAtMs)
            json.put("updatedAtMs", playlist.updatedAtMs)
            json.put("isDefault", playlist.isDefault)
            val entriesArray = JSONArray()
            playlist.entries.sortedByDescending { it.savedAtMs }.forEach { entriesArray.put(entryToJson(it)) }
            json.put("entries", entriesArray)
            array.put(json)
        }
        prefs(context).edit().putString(KEY_PLAYLISTS, array.toString()).apply()
    }

    private fun entryToJson(entry: Entry): JSONObject {
        return JSONObject().apply {
            put("id", entry.id)
            put("title", entry.title)
            put("description", entry.description)
            put("imageUrl", entry.imageUrl)
            put("audioUrl", entry.audioUrl)
            put("pubDate", entry.pubDate)
            put("durationMins", entry.durationMins)
            put("podcastId", entry.podcastId)
            put("podcastTitle", entry.podcastTitle)
            put("savedAtMs", entry.savedAtMs)
        }
    }

    private fun entryFromJson(json: JSONObject): Entry {
        return Entry(
            id = json.getString("id"),
            title = json.optString("title", ""),
            description = json.optString("description", ""),
            imageUrl = json.optString("imageUrl", ""),
            audioUrl = json.optString("audioUrl", ""),
            pubDate = json.optString("pubDate", ""),
            durationMins = json.optInt("durationMins", 0),
            podcastId = json.optString("podcastId", ""),
            podcastTitle = json.optString("podcastTitle", ""),
            savedAtMs = json.optLong("savedAtMs", 0L)
        )
    }

    private fun notifyChanged(context: Context) {
        try { context.sendBroadcast(android.content.Intent(ACTION_PLAYLISTS_CHANGED)) } catch (_: Exception) { }
    }

    fun getPlaylists(context: Context): List<PlaylistSummary> {
        return loadPlaylists(context).map { playlist ->
            PlaylistSummary(
                id = playlist.id,
                name = playlist.name,
                createdAtMs = playlist.createdAtMs,
                updatedAtMs = playlist.updatedAtMs,
                itemCount = playlist.entries.size,
                isDefault = playlist.isDefault
            )
        }
    }

    fun getPlaylistEntries(context: Context, playlistId: String): List<Entry> {
        return loadPlaylists(context).firstOrNull { it.id == playlistId }?.entries ?: emptyList()
    }

    fun getDefaultPlaylist(context: Context): PlaylistSummary {
        return getPlaylists(context).first { it.id == DEFAULT_PLAYLIST_ID }
    }

    fun getPlaylistName(context: Context, playlistId: String): String {
        return getPlaylists(context).firstOrNull { it.id == playlistId }?.name
            ?: if (playlistId == DEFAULT_PLAYLIST_ID) "Saved Episodes" else "Playlist"
    }

    fun isEpisodeInPlaylist(context: Context, playlistId: String, episodeId: String): Boolean {
        return getPlaylistEntries(context, playlistId).any { it.id == episodeId }
    }

    fun isSavedInDefaultPlaylist(context: Context, episodeId: String): Boolean {
        return isEpisodeInPlaylist(context, DEFAULT_PLAYLIST_ID, episodeId)
    }

    fun createPlaylist(context: Context, name: String): PlaylistSummary {
        val trimmed = name.trim()
        require(trimmed.isNotEmpty()) { "Playlist name cannot be blank" }
        val playlists = loadPlaylists(context)
        val now = System.currentTimeMillis()
        val newPlaylist = PlaylistData(
            id = "playlist_${now}",
            name = trimmed,
            createdAtMs = now,
            updatedAtMs = now,
            isDefault = false,
            entries = emptyList()
        )
        playlists.add(newPlaylist)
        writePlaylists(context, playlists)
        notifyChanged(context)
        return PlaylistSummary(newPlaylist.id, newPlaylist.name, newPlaylist.createdAtMs, newPlaylist.updatedAtMs, 0, false)
    }

    fun renamePlaylist(context: Context, playlistId: String, name: String): Boolean {
        if (playlistId == DEFAULT_PLAYLIST_ID) return false
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return false
        val playlists = loadPlaylists(context)
        val index = playlists.indexOfFirst { it.id == playlistId }
        if (index < 0) return false
        val updated = playlists[index].copy(name = trimmed, updatedAtMs = System.currentTimeMillis())
        playlists[index] = updated
        writePlaylists(context, playlists)
        notifyChanged(context)
        return true
    }

    fun deletePlaylist(context: Context, playlistId: String): Boolean {
        if (playlistId == DEFAULT_PLAYLIST_ID) return false
        val playlists = loadPlaylists(context)
        val removed = playlists.removeAll { it.id == playlistId }
        if (removed) {
            writePlaylists(context, playlists)
            notifyChanged(context)
        }
        return removed
    }

    fun addEntry(context: Context, playlistId: String, entry: Entry): Boolean {
        val playlists = loadPlaylists(context)
        val index = playlists.indexOfFirst { it.id == playlistId }
        if (index < 0) return false
        val playlist = playlists[index]
        if (playlist.entries.any { it.id == entry.id }) return false
        val normalisedEntry = if (entry.savedAtMs > 0L) entry else entry.copy(savedAtMs = System.currentTimeMillis())
        playlists[index] = playlist.copy(
            updatedAtMs = System.currentTimeMillis(),
            entries = (listOf(normalisedEntry) + playlist.entries).sortedByDescending { it.savedAtMs }
        )
        writePlaylists(context, playlists)
        notifyChanged(context)
        return true
    }

    fun removeEpisode(context: Context, playlistId: String, episodeId: String): Boolean {
        val playlists = loadPlaylists(context)
        val index = playlists.indexOfFirst { it.id == playlistId }
        if (index < 0) return false
        val playlist = playlists[index]
        if (playlist.entries.none { it.id == episodeId }) return false
        playlists[index] = playlist.copy(
            updatedAtMs = System.currentTimeMillis(),
            entries = playlist.entries.filterNot { it.id == episodeId }
        )
        writePlaylists(context, playlists)
        notifyChanged(context)
        return true
    }

    fun addEpisodeToPlaylist(context: Context, playlistId: String, episode: Episode, podcastTitle: String? = null): Boolean {
        val resolvedEntry = SavedEpisodes.buildEntry(context, episode, podcastTitle)
        val added = addEntry(context, playlistId, resolvedEntry)
        if (added && playlistId == DEFAULT_PLAYLIST_ID && resolvedEntry.audioUrl.isBlank()) {
            SavedEpisodes.resolveSavedEntryAsynchronously(context, episode.id, episode.podcastId, podcastTitle ?: "")
        }
        return added
    }

    fun saveEntryToDefault(context: Context, entry: Entry) {
        val playlists = loadPlaylists(context)
        val index = playlists.indexOfFirst { it.id == DEFAULT_PLAYLIST_ID }
        if (index < 0) return
        val playlist = playlists[index]
        val updatedEntries = playlist.entries.filterNot { it.id == entry.id } + entry
        playlists[index] = playlist.copy(
            updatedAtMs = System.currentTimeMillis(),
            entries = updatedEntries.sortedByDescending { it.savedAtMs }
        )
        writePlaylists(context, playlists)
        notifyChanged(context)
    }

    fun toggleDefaultPlaylist(context: Context, episode: Episode, podcastTitle: String? = null): Boolean {
        val existing = isSavedInDefaultPlaylist(context, episode.id)
        return if (existing) {
            removeEpisode(context, DEFAULT_PLAYLIST_ID, episode.id)
            false
        } else {
            addEpisodeToPlaylist(context, DEFAULT_PLAYLIST_ID, episode, podcastTitle)
            true
        }
    }

    fun clearAll(context: Context) {
        writePlaylists(context, listOf(defaultPlaylist(emptyList())))
        prefs(context).edit().putBoolean(KEY_MIGRATED, true).apply()
        notifyChanged(context)
    }
}