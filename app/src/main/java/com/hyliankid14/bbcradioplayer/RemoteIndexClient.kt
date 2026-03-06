package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.util.Log
import com.hyliankid14.bbcradioplayer.db.EpisodeFts
import com.hyliankid14.bbcradioplayer.db.PodcastFts
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Client for the remote podcast index server (hosted alongside the analytics server).
 *
 * Responsibilities:
 *  - Push podcast and episode data to the server so it can maintain a central FTS index.
 *  - Query the server for podcast/episode search results so the device does not need to
 *    build or maintain a large local SQLite index.
 *
 * All network calls are synchronous (no coroutines) — callers must dispatch to IO threads.
 * The server URL is derived from the same host as [PrivacyAnalytics.ANALYTICS_ENDPOINT].
 */
class RemoteIndexClient(private val context: Context) {

    companion object {
        private const val TAG = "RemoteIndexClient"

        // Base URL of the home server that hosts both analytics and the podcast index.
        // Must match the host used in PrivacyAnalytics.ANALYTICS_ENDPOINT.
        // Replace with your own server hostname/IP when self-hosting.
        internal const val SERVER_BASE_URL = "https://raspberrypi.tailc23afa.ts.net:8443"

        private const val CONNECT_TIMEOUT_MS = 5_000
        private const val READ_TIMEOUT_MS = 15_000

        // Availability is cached for 5 minutes to avoid a round-trip on every search.
        @Volatile private var cachedAvailable: Boolean? = null
        @Volatile private var availabilityCheckedAt: Long = 0L
        private const val AVAILABILITY_TTL_MS = 5 * 60 * 1000L

        fun resetAvailabilityCache() {
            cachedAvailable = null
            availabilityCheckedAt = 0L
        }
    }

    // ── Availability ──────────────────────────────────────────────────────────

    /**
     * Return true if the remote index server is reachable and has the podcast index endpoint.
     * Result is cached for [AVAILABILITY_TTL_MS].
     */
    fun isServerAvailable(): Boolean {
        val now = System.currentTimeMillis()
        val cached = cachedAvailable
        if (cached != null && (now - availabilityCheckedAt) < AVAILABILITY_TTL_MS) {
            return cached
        }
        return try {
            val response = getJson("$SERVER_BASE_URL/index/status") ?: run {
                cacheAvailability(false)
                return false
            }
            val ok = response.has("podcast_count")
            cacheAvailability(ok)
            ok
        } catch (e: Exception) {
            Log.d(TAG, "Server unavailable: ${e.message}")
            cacheAvailability(false)
            false
        }
    }

    private fun cacheAvailability(value: Boolean) {
        cachedAvailable = value
        availabilityCheckedAt = System.currentTimeMillis()
    }

    // ── Push: index data ──────────────────────────────────────────────────────

    /**
     * Push a list of podcasts to the server for indexing.
     * Returns the number of records the server accepted, or -1 on failure.
     */
    fun pushPodcasts(podcasts: List<Podcast>): Int {
        if (podcasts.isEmpty()) return 0
        return try {
            val body = JSONArray().also { arr ->
                for (p in podcasts) {
                    arr.put(JSONObject().apply {
                        put("id", p.id)
                        put("title", p.title)
                        put("description", p.description)
                    })
                }
            }
            val response = postJson("$SERVER_BASE_URL/index/podcasts", body.toString())
            response?.optInt("inserted", 0) ?: -1
        } catch (e: Exception) {
            Log.w(TAG, "pushPodcasts failed: ${e.message}")
            -1
        }
    }

    /**
     * Push a batch of episodes for a single podcast to the server.
     * Returns the number of new records the server inserted, or -1 on failure.
     */
    fun pushEpisodes(podcastId: String, episodes: List<Episode>): Int {
        if (episodes.isEmpty()) return 0
        return try {
            val epArray = JSONArray().also { arr ->
                for (ep in episodes) {
                    arr.put(JSONObject().apply {
                        put("id", ep.id)
                        put("title", ep.title)
                        put("description", ep.description)
                        put("pubDate", ep.pubDate)
                        // Convert pubDate to epoch millis so the server can sort by recency
                        put("pubEpoch", com.hyliankid14.bbcradioplayer.db.IndexStore.parsePubEpoch(ep.pubDate))
                    })
                }
            }
            val body = JSONObject().apply {
                put("podcastId", podcastId)
                put("episodes", epArray)
            }
            val response = postJson("$SERVER_BASE_URL/index/episodes", body.toString())
            response?.optInt("inserted", 0) ?: -1
        } catch (e: Exception) {
            Log.w(TAG, "pushEpisodes failed for $podcastId: ${e.message}")
            -1
        }
    }

    // ── Search ────────────────────────────────────────────────────────────────

    /**
     * Search podcasts on the remote server.
     * Returns an empty list if the server is unreachable or the query is blank.
     */
    fun searchPodcasts(query: String, limit: Int = 50): List<PodcastFts> {
        if (query.isBlank()) return emptyList()
        return try {
            val url = "$SERVER_BASE_URL/search/podcasts?q=${encode(query)}&limit=$limit"
            val array = getJsonArray(url) ?: return emptyList()
            (0 until array.length()).mapNotNull { i ->
                val obj = array.optJSONObject(i) ?: return@mapNotNull null
                PodcastFts(
                    podcastId   = obj.optString("podcastId"),
                    title       = obj.optString("title"),
                    description = obj.optString("description")
                )
            }
        } catch (e: Exception) {
            Log.d(TAG, "searchPodcasts failed: ${e.message}")
            emptyList()
        }
    }

    /**
     * Search episodes on the remote server.
     * Returns an empty list if the server is unreachable or the query is blank.
     */
    fun searchEpisodes(query: String, limit: Int = 100, offset: Int = 0): List<EpisodeFts> {
        if (query.isBlank()) return emptyList()
        return try {
            val url = "$SERVER_BASE_URL/search/episodes?q=${encode(query)}&limit=$limit&offset=$offset"
            val array = getJsonArray(url) ?: return emptyList()
            (0 until array.length()).mapNotNull { i ->
                val obj = array.optJSONObject(i) ?: return@mapNotNull null
                EpisodeFts(
                    episodeId   = obj.optString("episodeId"),
                    podcastId   = obj.optString("podcastId"),
                    title       = obj.optString("title"),
                    description = obj.optString("description"),
                    pubDate     = obj.optString("pubDate")
                )
            }
        } catch (e: Exception) {
            Log.d(TAG, "searchEpisodes failed: ${e.message}")
            emptyList()
        }
    }

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    private fun getJson(urlStr: String): JSONObject? {
        val conn = openConnection(urlStr)
        conn.requestMethod = "GET"
        if (conn.responseCode == HttpURLConnection.HTTP_OK) {
            return JSONObject(readBody(conn))
        }
        conn.disconnect()
        return null
    }

    private fun getJsonArray(urlStr: String): JSONArray? {
        val conn = openConnection(urlStr)
        conn.requestMethod = "GET"
        if (conn.responseCode == HttpURLConnection.HTTP_OK) {
            return JSONArray(readBody(conn))
        }
        conn.disconnect()
        return null
    }

    private fun postJson(urlStr: String, body: String): JSONObject? {
        val conn = openConnection(urlStr)
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        if (code == HttpURLConnection.HTTP_OK || code == HttpURLConnection.HTTP_CREATED) {
            return JSONObject(readBody(conn))
        }
        conn.disconnect()
        return null
    }

    private fun openConnection(urlStr: String): HttpURLConnection {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.connectTimeout = CONNECT_TIMEOUT_MS
        conn.readTimeout = READ_TIMEOUT_MS
        return conn
    }

    private fun readBody(conn: HttpURLConnection): String {
        return try {
            BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun encode(s: String): String =
        java.net.URLEncoder.encode(s, "UTF-8")
}
