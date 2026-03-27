package com.hyliankid14.bbcradioplayer.wear.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class PodcastCacheStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    init {
        // If the cache was built with an old schema (e.g. broken regex producing hash IDs),
        // clear it so the next fetch re-populates with correct BBC programme IDs.
        if (prefs.getInt(KEY_SCHEMA_VERSION, 0) != CURRENT_SCHEMA_VERSION) {
            prefs.edit()
                .remove(KEY_PODCASTS)
                .remove(KEY_PODCASTS_UPDATED_AT)
                .remove(KEY_PODCAST_UPDATED_AT)
                .putInt(KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)
                .apply()
        }
    }

    fun getCachedPodcasts(): List<PodcastSummary> {
        val raw = prefs.getString(KEY_PODCASTS, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            buildList(array.length()) {
                for (index in 0 until array.length()) {
                    val item = array.getJSONObject(index)
                    add(
                        PodcastSummary(
                            id = item.getString("id"),
                            title = item.getString("title"),
                            description = item.optString("description"),
                            rssUrl = item.getString("rssUrl"),
                            imageUrl = item.optString("imageUrl")
                        )
                    )
                }
            }
        }.getOrDefault(emptyList())
    }

    fun savePodcasts(podcasts: List<PodcastSummary>) {
        val array = JSONArray()
        podcasts.forEach { podcast ->
            array.put(
                JSONObject().apply {
                    put("id", podcast.id)
                    put("title", podcast.title)
                    put("description", podcast.description)
                    put("rssUrl", podcast.rssUrl)
                    put("imageUrl", podcast.imageUrl)
                }
            )
        }
        prefs.edit()
            .putString(KEY_PODCASTS, array.toString())
            .putLong(KEY_PODCASTS_UPDATED_AT, System.currentTimeMillis())
            .apply()
    }

    fun isPodcastCacheFresh(maxAgeMs: Long): Boolean {
        val updatedAt = prefs.getLong(KEY_PODCASTS_UPDATED_AT, 0L)
        return updatedAt > 0L && System.currentTimeMillis() - updatedAt <= maxAgeMs
    }

    fun getPodcastUpdatedAtMap(): Map<String, Long> {
        val raw = prefs.getString(KEY_PODCAST_UPDATED_AT, null) ?: return emptyMap()
        return runCatching {
            val obj = JSONObject(raw)
            obj.keys().asSequence()
                .map { it.trim() }
                .filter { it.isNotBlank() }
                .associateWith { key -> obj.optLong(key, 0L) }
                .filterValues { it > 0L }
        }.getOrDefault(emptyMap())
    }

    fun mergePodcastUpdatedAtMap(updatedAtById: Map<String, Long>) {
        if (updatedAtById.isEmpty()) return
        val merged = getPodcastUpdatedAtMap().toMutableMap()
        updatedAtById.forEach { (id, updatedAt) ->
            if (id.isNotBlank() && updatedAt > 0L) {
                val previous = merged[id] ?: 0L
                if (updatedAt > previous) {
                    merged[id] = updatedAt
                }
            }
        }
        val json = JSONObject().apply {
            merged.forEach { (id, updatedAt) -> put(id, updatedAt) }
        }
        prefs.edit().putString(KEY_PODCAST_UPDATED_AT, json.toString()).apply()
    }

    fun getCachedEpisodes(podcastId: String): List<EpisodeSummary> {
        val raw = prefs.getString(episodesKey(podcastId), null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            buildList(array.length()) {
                for (index in 0 until array.length()) {
                    val item = array.getJSONObject(index)
                    add(
                        EpisodeSummary(
                            id = item.getString("id"),
                            podcastId = item.getString("podcastId"),
                            podcastTitle = item.getString("podcastTitle"),
                            title = item.getString("title"),
                            description = item.optString("description"),
                            audioUrl = item.getString("audioUrl"),
                            pubDate = item.optString("pubDate")
                        )
                    )
                }
            }
        }.getOrDefault(emptyList())
    }

    fun saveEpisodes(podcastId: String, episodes: List<EpisodeSummary>) {
        val array = JSONArray()
        episodes.forEach { episode ->
            array.put(
                JSONObject().apply {
                    put("id", episode.id)
                    put("podcastId", episode.podcastId)
                    put("podcastTitle", episode.podcastTitle)
                    put("title", episode.title)
                    put("description", episode.description)
                    put("audioUrl", episode.audioUrl)
                    put("pubDate", episode.pubDate)
                }
            )
        }
        prefs.edit()
            .putString(episodesKey(podcastId), array.toString())
            .putLong(episodesUpdatedAtKey(podcastId), System.currentTimeMillis())
            .apply()
    }

    fun isEpisodeCacheFresh(podcastId: String, maxAgeMs: Long): Boolean {
        val updatedAt = prefs.getLong(episodesUpdatedAtKey(podcastId), 0L)
        return updatedAt > 0L && System.currentTimeMillis() - updatedAt <= maxAgeMs
    }

    private fun episodesKey(podcastId: String) = "episodes_$podcastId"
    private fun episodesUpdatedAtKey(podcastId: String) = "episodes_updated_$podcastId"

    companion object {
        private const val PREFS_NAME = "wear_podcast_cache"
        private const val KEY_PODCASTS = "podcasts"
        private const val KEY_PODCASTS_UPDATED_AT = "podcasts_updated_at"
        private const val KEY_PODCAST_UPDATED_AT = "podcast_updated_at_map"
        private const val KEY_SCHEMA_VERSION = "schema_version"
        private const val CURRENT_SCHEMA_VERSION = 4  // bump when cache format changes
    }
}
