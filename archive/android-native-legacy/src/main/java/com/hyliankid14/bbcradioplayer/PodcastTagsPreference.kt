package com.hyliankid14.bbcradioplayer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Persists per-podcast tag overrides for subscribed podcasts.
 *
 * Each podcast starts with its BBC-supplied genres as default tags.
 * Users can remove existing tags or add custom ones.  Overrides are stored as
 * a JSON object keyed by podcast ID.  A podcast entry is only written when the
 * user has made at least one edit, so [getTags] falls back to the podcast's
 * genres when no persisted entry exists.
 */
object PodcastTagsPreference {

    private const val PREFS_NAME = "podcast_tags_prefs"
    private const val KEY_TAG_MAP = "tag_map"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Removes generic "podcast"/"podcasts" labels that add no value as tags. */
    private fun List<String>.filterGenericPodcastLabels(): List<String> =
        filterNot { it.equals("podcast", ignoreCase = true) || it.equals("podcasts", ignoreCase = true) }

    // ─── Internal serialisation ──────────────────────────────────────────────

    private fun readMap(context: Context): MutableMap<String, MutableSet<String>> {
        val raw = prefs(context).getString(KEY_TAG_MAP, null) ?: return mutableMapOf()
        val result = mutableMapOf<String, MutableSet<String>>()
        try {
            val json = JSONObject(raw)
            val keys = json.keys()
            while (keys.hasNext()) {
                val id = keys.next()
                val arr = json.optJSONArray(id) ?: continue
                val set = mutableSetOf<String>()
                for (i in 0 until arr.length()) {
                    val tag = arr.optString(i, "")
                    if (tag.isNotBlank()) set.add(tag)
                }
                result[id] = set
            }
        } catch (_: Exception) { }
        return result
    }

    private fun writeMap(context: Context, map: Map<String, Set<String>>) {
        val json = JSONObject()
        map.forEach { (id, tags) ->
            val arr = JSONArray()
            tags.forEach { arr.put(it) }
            json.put(id, arr)
        }
        prefs(context).edit().putString(KEY_TAG_MAP, json.toString()).apply()
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /**
     * Returns the effective tag set for [podcast].
     * If the user has not customised the tags, the podcast's own BBC genres are returned.
     * If the user has customised (even to an empty set), the persisted set is returned.
     */
    fun getTags(context: Context, podcast: Podcast): Set<String> {
        val map = readMap(context)
        return map[podcast.id] ?: podcast.genres.filterGenericPodcastLabels().toSet()
    }

    /**
     * Returns the effective tag set for [podcastId] given its [defaultGenres].
     */
    fun getTags(context: Context, podcastId: String, defaultGenres: List<String>): Set<String> {
        val map = readMap(context)
        return map[podcastId] ?: defaultGenres.filterGenericPodcastLabels().toSet()
    }

    /**
     * Explicitly replaces the full tag set for a podcast.
     */
    fun setTags(context: Context, podcastId: String, tags: Set<String>) {
        val map = readMap(context)
        map[podcastId] = tags.toMutableSet()
        writeMap(context, map)
    }

    /**
     * Adds [tag] to a podcast.  If no custom override exists yet the podcast's
     * BBC genres are first copied in so existing tags are not silently lost.
     */
    fun addTag(context: Context, podcast: Podcast, tag: String) {
        val trimmed = tag.trim()
        if (trimmed.isEmpty()) return
        val map = readMap(context)
        val current = map.getOrPut(podcast.id) { podcast.genres.filterGenericPodcastLabels().toMutableSet() }
        current.add(trimmed)
        writeMap(context, map)
    }

    /**
     * Removes [tag] from a podcast.  If no custom override exists yet the podcast's
     * BBC genres are first copied in before the removal.
     */
    fun removeTag(context: Context, podcast: Podcast, tag: String) {
        val map = readMap(context)
        val current = map.getOrPut(podcast.id) { podcast.genres.filterGenericPodcastLabels().toMutableSet() }
        current.remove(tag)
        writeMap(context, map)
    }

    /**
     * Resets a podcast's tags back to its BBC-supplied genres by removing the persisted override.
     */
    fun resetToDefaults(context: Context, podcastId: String) {
        val map = readMap(context)
        map.remove(podcastId)
        writeMap(context, map)
    }

    /**
     * Returns all unique tags across the given subscribed podcasts, sorted alphabetically.
     */
    fun getAllTagsForSubscribed(context: Context, subscribedPodcasts: List<Podcast>): List<String> {
        val map = readMap(context)
        val all = mutableSetOf<String>()
        subscribedPodcasts.forEach { podcast ->
            val tags = map[podcast.id] ?: podcast.genres.filterGenericPodcastLabels().toSet()
            all.addAll(tags)
        }
        return all.filter { it.isNotBlank() }.sorted()
    }

    /**
     * Returns subscribed podcasts that have [tag] in their effective tag set.
     */
    fun getPodcastsForTag(
        context: Context,
        tag: String,
        subscribedPodcasts: List<Podcast>
    ): List<Podcast> {
        val map = readMap(context)
        return subscribedPodcasts.filter { podcast ->
            val tags = map[podcast.id] ?: podcast.genres.filterGenericPodcastLabels().toSet()
            tags.contains(tag)
        }
    }
}
