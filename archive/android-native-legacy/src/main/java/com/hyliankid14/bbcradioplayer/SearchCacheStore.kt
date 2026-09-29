package com.hyliankid14.bbcradioplayer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Small, best-effort on-disk cache for the UI search results. Used to survive
 * navigation and short process restarts so the search UI can restore instantly.
 *
 * Stored in a cache-file (not user-visible). TTL is conservative (24h) to avoid
 * keeping stale data for long.
 */
object SearchCacheStore {
    private const val FILENAME = "search_cache.json"
    private const val TTL_MS = 24 * 60 * 60 * 1000L // 24 hours

    private fun file(ctx: Context): File = File(ctx.cacheDir, FILENAME)

    fun save(ctx: Context, cache: PodcastsViewModel.SearchCache) {
        try {
            val root = JSONObject()
            root.put("ts", System.currentTimeMillis())
            root.put("query", cache.query)

            fun podToJson(p: Podcast): JSONObject {
                val o = JSONObject()
                o.put("id", p.id)
                o.put("title", p.title)
                o.put("description", p.description)
                o.put("rssUrl", p.rssUrl)
                o.put("htmlUrl", p.htmlUrl)
                o.put("imageUrl", p.imageUrl)
                o.put("typicalDurationMins", p.typicalDurationMins)
                o.put("genres", JSONArray(p.genres))
                return o
            }

            fun epToJson(e: Episode): JSONObject {
                val o = JSONObject()
                o.put("id", e.id)
                o.put("title", e.title)
                o.put("description", e.description)
                o.put("audioUrl", e.audioUrl)
                o.put("imageUrl", e.imageUrl)
                o.put("pubDate", e.pubDate)
                o.put("durationMins", e.durationMins)
                o.put("podcastId", e.podcastId)
                return o
            }

            val titles = JSONArray()
            cache.titleMatches.forEach { titles.put(podToJson(it)) }
            root.put("titleMatches", titles)

            val descs = JSONArray()
            cache.descMatches.forEach { descs.put(podToJson(it)) }
            root.put("descMatches", descs)

            val episodes = JSONArray()
            cache.episodeMatches.forEach { (ep, pod) ->
                val e = epToJson(ep)
                e.put("podcast", podToJson(pod))
                episodes.put(e)
            }
            root.put("episodeMatches", episodes)
            root.put("isComplete", cache.isComplete)

            file(ctx).writeText(root.toString())
        } catch (_: Exception) {
            // best-effort
        }
    }

    fun load(ctx: Context): PodcastsViewModel.SearchCache? {
        try {
            val f = file(ctx)
            if (!f.exists()) return null
            val txt = f.readText()
            val root = JSONObject(txt)
            val ts = root.optLong("ts", 0L)
            if (ts == 0L || System.currentTimeMillis() - ts > TTL_MS) {
                try { f.delete() } catch (_: Exception) {}
                return null
            }
            val query = root.optString("query", "").trim()
            if (query.isEmpty()) return null

            fun podFromJson(o: JSONObject): Podcast {
                return Podcast(
                    id = o.optString("id", ""),
                    title = o.optString("title", ""),
                    description = o.optString("description", ""),
                    rssUrl = o.optString("rssUrl", ""),
                    htmlUrl = o.optString("htmlUrl", ""),
                    imageUrl = o.optString("imageUrl", ""),
                    genres = (0 until (o.optJSONArray("genres")?.length() ?: 0)).mapNotNull { idx -> o.optJSONArray("genres")?.optString(idx) },
                    typicalDurationMins = o.optInt("typicalDurationMins", 0)
                )
            }

            fun epFromJson(o: JSONObject): Episode {
                return Episode(
                    id = o.optString("id", ""),
                    title = o.optString("title", ""),
                    description = o.optString("description", ""),
                    audioUrl = o.optString("audioUrl", ""),
                    imageUrl = o.optString("imageUrl", ""),
                    pubDate = o.optString("pubDate", ""),
                    durationMins = o.optInt("durationMins", 0),
                    podcastId = o.optString("podcastId", "")
                )
            }

            val titleMatches = mutableListOf<Podcast>()
            val tArr = root.optJSONArray("titleMatches") ?: JSONArray()
            for (i in 0 until tArr.length()) titleMatches.add(podFromJson(tArr.getJSONObject(i)))

            val descMatches = mutableListOf<Podcast>()
            val dArr = root.optJSONArray("descMatches") ?: JSONArray()
            for (i in 0 until dArr.length()) descMatches.add(podFromJson(dArr.getJSONObject(i)))

            val episodeMatches = mutableListOf<Pair<Episode, Podcast>>()
            val eArr = root.optJSONArray("episodeMatches") ?: JSONArray()
            for (i in 0 until eArr.length()) {
                val o = eArr.getJSONObject(i)
                val pod = podFromJson(o.getJSONObject("podcast"))
                val ep = epFromJson(o)
                episodeMatches.add(ep to pod)
            }

            val isComplete = root.optBoolean("isComplete", true)
            return PodcastsViewModel.SearchCache(query, titleMatches, descMatches, episodeMatches, isComplete)
        } catch (_: Exception) {
            return null
        }
    }

    fun clear(ctx: Context) {
        try { file(ctx).delete() } catch (_: Exception) {}
    }
}
