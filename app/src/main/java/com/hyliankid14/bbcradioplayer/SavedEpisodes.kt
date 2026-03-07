package com.hyliankid14.bbcradioplayer

import android.content.Context
import org.json.JSONObject

/**
 * Simple persisted store for saved podcast episodes (stored as JSON entries in SharedPreferences).
 * Stores minimal metadata so saved episodes can be shown without fetching full feeds.
 */
object SavedEpisodes {
    private const val PREFS_NAME = "saved_episodes_prefs"
    private const val KEY_SAVED_SET = "saved_set"

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
        val savedAtMs: Long
    )

    fun getSavedEntries(context: Context): List<Entry> {
        val set = prefs(context).getStringSet(KEY_SAVED_SET, emptySet()) ?: emptySet()
        val list = mutableListOf<Entry>()
        for (s in set) {
            try {
                val j = JSONObject(s)
                val e = Entry(
                    id = j.getString("id"),
                    title = j.optString("title", ""),
                    description = j.optString("description", ""),
                    imageUrl = j.optString("imageUrl", ""),
                    audioUrl = j.optString("audioUrl", ""),
                    pubDate = j.optString("pubDate", ""),
                    durationMins = j.optInt("durationMins", 0),
                    podcastId = j.optString("podcastId", ""),
                    podcastTitle = j.optString("podcastTitle", ""),
                    savedAtMs = j.optLong("savedAtMs", 0L)
                )
                list.add(e)
            } catch (_: Exception) {}
        }
        // Return in reverse chronological order
        return list.sortedByDescending { it.savedAtMs }
    }

    fun isSaved(context: Context, episodeId: String): Boolean {
        return getSavedEntries(context).any { it.id == episodeId }
    }

    fun toggleSaved(context: Context, episode: Episode, podcastTitle: String? = null): Boolean {
        val current = prefs(context).getStringSet(KEY_SAVED_SET, emptySet())?.toMutableSet() ?: mutableSetOf()
        val existing = current.firstOrNull { try { JSONObject(it).getString("id") == episode.id } catch (_: Exception) { false } }
        if (existing != null) {
            current.remove(existing)
            prefs(context).edit().putStringSet(KEY_SAVED_SET, current).apply()
            return false
        } else {
            // Resolve the best possible audio URL to store. We avoid network calls here — prefer
            // the episode object, then the active playback URI, then cached feed entries.
            fun looksLikePreview(url: String?, dur: Int): Boolean {
                if (url.isNullOrBlank()) return true
                val low = url.lowercase()
                if (low.contains("preview") || low.contains("snippet") || low.contains("sample")) return true
                if (dur <= 0) return true
                if (url.length < 20) return true
                return false
            }

            var resolvedAudio = episode.audioUrl
            var resolvedDuration = episode.durationMins
            var resolvedPubDate = episode.pubDate
            if (looksLikePreview(resolvedAudio, episode.durationMins)) {
                // 1) Prefer the currently-playing media URI if it's different and looks valid
                val fromPlayer = PlaybackStateHelper.getCurrentMediaUri()
                if (!fromPlayer.isNullOrBlank() && !looksLikePreview(fromPlayer, episode.durationMins)) {
                    resolvedAudio = fromPlayer
                } else {
                    // 2) Try to find a cached full-episode entry from PodcastRepository (non-blocking)
                    try {
                        val repo = PodcastRepository(context)
                        val cached = repo.getEpisodesFromCache(episode.podcastId)
                        val found = cached?.firstOrNull { it.id == episode.id }
                        if (found != null && !looksLikePreview(found.audioUrl, found.durationMins)) {
                            resolvedAudio = found.audioUrl
                            resolvedDuration = found.durationMins
                            if (resolvedPubDate.isBlank()) resolvedPubDate = found.pubDate
                        } else {
                            // 3) Try index lookup to find parent podcast id and then check that cache
                            try {
                                val idx = com.hyliankid14.bbcradioplayer.db.IndexStore.getInstance(context)
                                val ef = idx.findEpisodeById(episode.id)
                                if (ef != null) {
                                    val candidate = repo.getEpisodesFromCache(ef.podcastId)?.firstOrNull { it.id == episode.id }
                                    if (candidate != null && !looksLikePreview(candidate.audioUrl, candidate.durationMins)) {
                                        resolvedAudio = candidate.audioUrl
                                        resolvedDuration = candidate.durationMins
                                        if (resolvedPubDate.isBlank()) resolvedPubDate = candidate.pubDate
                                    }
                                }
                            } catch (_: Exception) { /* best-effort */ }
                        }
                    } catch (_: Exception) { /* best-effort */ }
                }
            }

            val j = JSONObject()
            j.put("id", episode.id)
            j.put("title", episode.title)
            j.put("description", episode.description)
            j.put("imageUrl", episode.imageUrl)
            j.put("audioUrl", resolvedAudio)
            j.put("pubDate", resolvedPubDate)
            j.put("durationMins", resolvedDuration)
            j.put("podcastId", episode.podcastId)
            j.put("podcastTitle", podcastTitle ?: "")
            j.put("savedAtMs", System.currentTimeMillis())
            current.add(j.toString())
            prefs(context).edit().putStringSet(KEY_SAVED_SET, current).apply()
            return true
        }
    }

    fun remove(context: Context, episodeId: String) {
        val current = prefs(context).getStringSet(KEY_SAVED_SET, emptySet())?.toMutableSet() ?: mutableSetOf()
        val existing = current.firstOrNull { try { JSONObject(it).getString("id") == episodeId } catch (_: Exception) { false } }
        if (existing != null) {
            current.remove(existing)
            prefs(context).edit().putStringSet(KEY_SAVED_SET, current).apply()
        }
    }

    /**
     * Persist an existing Entry object back into the saved-set. Removes any existing entry with
     * the same id first to avoid duplicates and preserves the original savedAtMs value so order
     * is retained in the UI.
     */
    fun saveEntry(context: Context, entry: Entry) {
        val current = prefs(context).getStringSet(KEY_SAVED_SET, emptySet())?.toMutableSet() ?: mutableSetOf()
        // Remove any existing entry with same id
        val existing = current.firstOrNull { try { JSONObject(it).getString("id") == entry.id } catch (_: Exception) { false } }
        if (existing != null) current.remove(existing)

        val j = JSONObject()
        j.put("id", entry.id)
        j.put("title", entry.title)
        j.put("description", entry.description)
        j.put("imageUrl", entry.imageUrl)
        j.put("audioUrl", entry.audioUrl)
        j.put("pubDate", entry.pubDate)
        j.put("durationMins", entry.durationMins)
        j.put("podcastId", entry.podcastId)
        j.put("podcastTitle", entry.podcastTitle)
        j.put("savedAtMs", entry.savedAtMs)

        current.add(j.toString())
        prefs(context).edit().putStringSet(KEY_SAVED_SET, current).apply()
    }

    fun clearAll(context: Context) {
        prefs(context).edit().remove(KEY_SAVED_SET).apply()
    }
}
