package com.hyliankid14.bbcradioplayer.wear.storage

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

class EpisodeSyncStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    init {
        syncStateFromPrefs()
    }

    fun getPlayedEpisodeIds(): Set<String> = playedIdsState.value

    fun getProgressMap(): Map<String, Long> = progressMapState.value

    fun getHistoryEpisodeIds(): List<String> = historyIdsState.value

    fun getProgress(episodeId: String): Long = getProgressMap()[episodeId] ?: 0L

    fun setProgress(episodeId: String, positionMs: Long) {
        if (episodeId.isBlank() || positionMs <= 0L) return
        val updated = getProgressMap().toMutableMap()
        updated[episodeId] = positionMs
        persist(
            progress = updated,
            playedIds = getPlayedEpisodeIds(),
            historyIds = getHistoryEpisodeIds(),
            remoteSynced = true
        )
    }

    fun markPlayed(episodeId: String) {
        if (episodeId.isBlank()) return
        val updatedPlayed = getPlayedEpisodeIds().toMutableSet()
        updatedPlayed += episodeId
        val updatedProgress = getProgressMap().toMutableMap().apply { remove(episodeId) }
        val updatedHistory = buildList {
            add(episodeId)
            addAll(getHistoryEpisodeIds().filterNot { it == episodeId })
        }.take(MAX_HISTORY_SIZE)
        persist(progress = updatedProgress, playedIds = updatedPlayed, historyIds = updatedHistory, remoteSynced = true)
    }

    fun markPlayedWithMeta(
        episodeId: String,
        title: String,
        description: String,
        imageUrl: String,
        audioUrl: String,
        pubDate: String,
        durationMins: Int,
        podcastId: String,
        podcastTitle: String,
        playedAtMs: Long
    ) {
        markPlayed(episodeId)
        addHistoryWithMeta(
            episodeId = episodeId,
            title = title,
            description = description,
            imageUrl = imageUrl,
            audioUrl = audioUrl,
            pubDate = pubDate,
            durationMins = durationMins,
            podcastId = podcastId,
            podcastTitle = podcastTitle,
            playedAtMs = playedAtMs
        )
    }

    fun addHistoryWithMeta(
        episodeId: String,
        title: String,
        description: String,
        imageUrl: String,
        audioUrl: String,
        pubDate: String,
        durationMins: Int,
        podcastId: String,
        podcastTitle: String,
        playedAtMs: Long
    ) {
        if (episodeId.isBlank()) return

        val updatedHistory = buildList {
            add(episodeId)
            addAll(getHistoryEpisodeIds().filterNot { it == episodeId })
        }.take(MAX_HISTORY_SIZE)

        persist(
            progress = getProgressMap(),
            playedIds = getPlayedEpisodeIds(),
            historyIds = updatedHistory,
            remoteSynced = true
        )

        val metaEntry = JSONObject().apply {
            put("id", episodeId)
            put("title", title)
            put("description", description)
            put("imageUrl", imageUrl)
            put("audioUrl", audioUrl)
            put("pubDate", pubDate)
            put("durationMins", durationMins)
            put("podcastId", podcastId)
            put("podcastTitle", podcastTitle)
            put("playedAtMs", playedAtMs)
        }
        val rawMeta = prefs.getString(KEY_HISTORY_META_JSON, null)
        val existing = if (rawMeta.isNullOrBlank()) JSONArray() else runCatching { JSONArray(rawMeta) }.getOrDefault(JSONArray())
        val updated = JSONArray()
        updated.put(metaEntry)
        for (i in 0 until existing.length()) {
            val obj = existing.optJSONObject(i) ?: continue
            if (obj.optString("id") == episodeId) continue
            updated.put(obj)
        }
        val trimmed = if (updated.length() <= MAX_HISTORY_SIZE) updated else JSONArray(
            (0 until MAX_HISTORY_SIZE).map { updated.get(it) }
        )
        prefs.edit().putString(KEY_HISTORY_META_JSON, trimmed.toString()).apply()
    }

    fun getHistoryMetaJson(): String = prefs.getString(KEY_HISTORY_META_JSON, null) ?: "[]"

    fun replaceAll(playedIds: Set<String>, progressMap: Map<String, Long>, historyIds: List<String> = emptyList()) {
        val cleanedPlayed = playedIds.filter { it.isNotBlank() }.toSet()
        val cleanedProgress = progressMap.filter { (id, pos) -> id.isNotBlank() && pos > 0L && id !in cleanedPlayed }
        val cleanedHistory = historyIds.filter { it.isNotBlank() }.distinct().take(MAX_HISTORY_SIZE)
        persist(progress = cleanedProgress, playedIds = cleanedPlayed, historyIds = cleanedHistory, remoteSynced = true)
    }

    fun hasRemoteSnapshot(): Boolean = prefs.getBoolean(KEY_REMOTE_SYNCED, false)

    private fun persist(progress: Map<String, Long>, playedIds: Set<String>, historyIds: List<String>, remoteSynced: Boolean) {
        val progressJson = JSONObject().apply {
            progress.forEach { (episodeId, positionMs) ->
                put(episodeId, positionMs)
            }
        }

        prefs.edit()
            .putStringSet(KEY_PLAYED_IDS, playedIds)
            .putString(KEY_PROGRESS_JSON, progressJson.toString())
            .putString(KEY_HISTORY_IDS, historyIds.joinToString(","))
            .putBoolean(KEY_REMOTE_SYNCED, remoteSynced)
            .apply()

        playedIdsState.value = playedIds
        progressMapState.value = progress
        historyIdsState.value = historyIds
    }

    private fun syncStateFromPrefs() {
        playedIdsState.value = prefs.getStringSet(KEY_PLAYED_IDS, emptySet()) ?: emptySet()
        val rawProgress = prefs.getString(KEY_PROGRESS_JSON, null).orEmpty()
        val parsed = runCatching {
            val obj = if (rawProgress.isBlank()) JSONObject() else JSONObject(rawProgress)
            obj.keys().asSequence().associateWith { key -> obj.optLong(key, 0L) }
                .filterValues { it > 0L }
        }.getOrDefault(emptyMap())
        progressMapState.value = parsed
        historyIdsState.value = prefs.getString(KEY_HISTORY_IDS, "")
            ?.split(',')
            ?.map { it.trim() }
            ?.filter { it.isNotBlank() }
            ?.distinct()
            ?.take(MAX_HISTORY_SIZE)
            ?: emptyList()
    }

    companion object {
        private const val PREFS_NAME = "wear_episode_sync"
        private const val KEY_PLAYED_IDS = "played_episode_ids"
        private const val KEY_PROGRESS_JSON = "episode_progress_json"
        private const val KEY_HISTORY_IDS = "history_episode_ids"
        private const val KEY_HISTORY_META_JSON = "history_meta_json"
        private const val KEY_REMOTE_SYNCED = "remote_synced"
        private const val MAX_HISTORY_SIZE = 100

        private val playedIdsState = MutableStateFlow<Set<String>>(emptySet())
        private val progressMapState = MutableStateFlow<Map<String, Long>>(emptyMap())
        private val historyIdsState = MutableStateFlow<List<String>>(emptyList())

        fun playedIdsFlow(): StateFlow<Set<String>> = playedIdsState.asStateFlow()
        fun progressMapFlow(): StateFlow<Map<String, Long>> = progressMapState.asStateFlow()
        fun historyIdsFlow(): StateFlow<List<String>> = historyIdsState.asStateFlow()
    }
}
