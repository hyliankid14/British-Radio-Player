package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.util.JsonReader
import android.util.Log
import com.hyliankid14.bbcradioplayer.db.EpisodeFts
import com.hyliankid14.bbcradioplayer.db.PodcastFts
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.BufferedReader
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.GZIPInputStream

/**
 * Client for the remote podcast index.
 *
 * Primary source — GitHub Pages static index:
 *   A nightly GitHub Actions workflow runs `api/build_index.py` and commits
 *   `docs/podcast-index.json` to the repository.  This file is served from
 *   GitHub Pages at [GITHUB_PAGES_INDEX_URL].  The app downloads it at most
 *   once per [INDEX_CACHE_TTL_MS], caches it on disk, and uses it to populate
 *   the local SQLite FTS index.  All searches then run locally — zero traffic
 *   to the home server per search.
 *
 * Fallback — home server query endpoints:
 *   If the static index is unavailable, [searchPodcasts] / [searchEpisodes]
 *   fall back to querying the Flask server at [SERVER_BASE_URL].  This is the
 *   path originally implemented in the first PR commit.
 *
 * All network calls are synchronous — callers must dispatch to IO threads.
 */
class RemoteIndexClient(private val context: Context) {

    companion object {
        private const val TAG = "RemoteIndexClient"

        // GitHub Pages URL for the pre-built static podcast/episode index.
        // Built nightly by the GitHub Actions workflow in
        // .github/workflows/build-podcast-index.yml.
        internal const val GITHUB_PAGES_INDEX_URL =
            "https://hyliankid14.github.io/BBC-Radio-Player/podcast-index.json.gz"

        // Fallback home server (used only for search queries when the static
        // index has not yet been downloaded).  Must match
        // PrivacyAnalytics.ANALYTICS_ENDPOINT host.
        // Replace with your own server hostname/IP when self-hosting.
        internal const val SERVER_BASE_URL = "https://raspberrypi.tailc23afa.ts.net:8443"

        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val READ_TIMEOUT_MS = 30_000

        // Re-download the static index at most once every 6 hours.
        private const val INDEX_CACHE_TTL_MS = 6 * 60 * 60 * 1_000L
        private const val INDEX_CACHE_FILENAME = "remote_podcast_index.json"

        // Home-server availability cache (5-minute TTL).
        @Volatile private var cachedServerAvailable: Boolean? = null
        @Volatile private var serverAvailabilityCheckedAt: Long = 0L
        private const val SERVER_AVAILABILITY_TTL_MS = 5 * 60 * 1_000L

        fun resetAvailabilityCache() {
            cachedServerAvailable = null
            serverAvailabilityCheckedAt = 0L
        }
    }

    // ── Static index: download & cache ────────────────────────────────────────

    /**
     * Parsed result of the pre-built GitHub Pages index.
     * [episodes] may be empty on failure — callers should tolerate that.
     */
    data class RemoteIndex(
        val generatedAt: String,
        val podcasts: List<Podcast>,
        val episodes: List<Episode>
    )

    /**
     * Return true if the cached `podcast-index.json` is older than
     * [INDEX_CACHE_TTL_MS] (or does not exist yet).
     */
    fun isCachedIndexStale(): Boolean {
        val cacheFile = File(context.cacheDir, INDEX_CACHE_FILENAME)
        if (!cacheFile.exists()) return true
        return (System.currentTimeMillis() - cacheFile.lastModified()) > INDEX_CACHE_TTL_MS
    }

    /**
     * Download the pre-built podcast index from GitHub Pages, cache it on
     * disk, and return the parsed [RemoteIndex].  Returns null on failure.
     *
     * This is the primary path used by [IndexWorker]: one download replaces
     * hundreds of individual RSS feed fetches and eliminates all per-search
     * home-server traffic.
     *
     * @param onProgress Optional callback to report download progress (message, percent)
     */
    fun downloadIndex(onProgress: ((String, Int) -> Unit)? = null): RemoteIndex? {
        val cacheFile = File(context.cacheDir, INDEX_CACHE_FILENAME)

        // Use cached copy if still fresh.
        if (!isCachedIndexStale() && cacheFile.exists()) {
            Log.d(TAG, "Using cached podcast index (${cacheFile.length() / 1024} KB)")
            return try { parseIndexFromFile(cacheFile) } catch (e: Exception) {
                Log.w(TAG, "Failed to parse cached index: ${e.message}")
                null
            }
        }

        // Download fresh copy.
        return try {
            onProgress?.invoke("Connecting to GitHub Pages...", 5)
            Log.d(TAG, "Downloading podcast index from GitHub Pages...")
            val conn = openConnection(GITHUB_PAGES_INDEX_URL)
            conn.requestMethod = "GET"
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                Log.w(TAG, "GitHub Pages returned HTTP ${conn.responseCode}")
                conn.disconnect()
                return null
            }
            onProgress?.invoke("Downloading and decompressing...", 7)
            
            // Stream directly to cache file to avoid OOM with large JSON
            val tempFile = File(context.cacheDir, "${INDEX_CACHE_FILENAME}.tmp")
            GZIPInputStream(conn.inputStream).use { gzipStream ->
                BufferedOutputStream(FileOutputStream(tempFile)).use { fileOut ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    var totalBytes = 0L
                    var lastProgress = 7
                    
                    while (gzipStream.read(buffer).also { bytesRead = it } != -1) {
                        fileOut.write(buffer, 0, bytesRead)
                        totalBytes += bytesRead
                        
                        // Update progress every ~200KB of decompressed data
                        if (totalBytes % 200000 < 8192) {
                            val newProgress = (7 + (totalBytes / 200000).toInt().coerceAtMost(10))
                                .coerceIn(7, 17)
                            if (newProgress > lastProgress) {
                                onProgress?.invoke("Decompressing... (${totalBytes / 1000}KB)", newProgress)
                                lastProgress = newProgress
                            }
                        }
                    }
                }
            }
            conn.disconnect()
            
            onProgress?.invoke("Saving to cache...", 17)
            tempFile.renameTo(cacheFile)
            Log.d(TAG, "Downloaded and decompressed podcast index (${cacheFile.length() / 1024} KB)")
            
            onProgress?.invoke("Parsing index...", 18)
            // Parse with streaming JSON reader to avoid OOM
            parseIndexFromFile(cacheFile)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to download podcast index: ${e.message}")
            null
        }
    }

    /**
     * Parse a raw JSON object (from disk cache or fresh download) into a
     * [RemoteIndex] containing stub [Podcast] and [Episode] objects suitable
     * for populating the local SQLite FTS index.
     */
    private fun parseIndexJson(root: JSONObject): RemoteIndex {
        val generatedAt = root.optString("generated_at", "")

        val podcastsArr = root.optJSONArray("podcasts") ?: JSONArray()
        val podcasts = (0 until podcastsArr.length()).mapNotNull { i ->
            val obj = podcastsArr.optJSONObject(i) ?: return@mapNotNull null
            val id = obj.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            Podcast(
                id = id,
                title = obj.optString("title"),
                description = obj.optString("description"),
                rssUrl = "",
                htmlUrl = "",
                imageUrl = "",
                genres = emptyList(),
                typicalDurationMins = 0
            )
        }

        val episodesArr = root.optJSONArray("episodes") ?: JSONArray()
        val episodes = (0 until episodesArr.length()).mapNotNull { i ->
            val obj = episodesArr.optJSONObject(i) ?: return@mapNotNull null
            val id = obj.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val podcastId = obj.optString("podcastId").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            // audioUrl / imageUrl / durationMins are not in the index file — set safe defaults.
            // IndexStore only reads id, podcastId, title, description, pubDate for FTS.
            Episode(
                id = id,
                podcastId = podcastId,
                title = obj.optString("title"),
                description = obj.optString("description"),
                audioUrl = "",
                imageUrl = "",
                pubDate = obj.optString("pubDate"),
                durationMins = 0
            )
        }

        return RemoteIndex(generatedAt, podcasts, episodes)
    }

    /**
     * Parse index from file using streaming JSON reader to avoid loading
     * entire 250+ MB file into memory.
     */
    private fun parseIndexFromFile(file: File): RemoteIndex {
        var generatedAt = ""
        val podcasts = mutableListOf<Podcast>()
        val episodes = mutableListOf<Episode>()

        FileInputStream(file).use { fis ->
            BufferedInputStream(fis).use { bis ->
                JsonReader(InputStreamReader(bis, "UTF-8")).use { reader ->
                    reader.beginObject()
                    while (reader.hasNext()) {
                        when (reader.nextName()) {
                            "generated_at" -> generatedAt = reader.nextString()
                            "podcasts" -> {
                                reader.beginArray()
                                while (reader.hasNext()) {
                                    reader.beginObject()
                                    var id = ""
                                    var title = ""
                                    var description = ""
                                    while (reader.hasNext()) {
                                        when (reader.nextName()) {
                                            "id" -> id = reader.nextString()
                                            "title" -> title = reader.nextString()
                                            "description" -> description = reader.nextString()
                                            else -> reader.skipValue()
                                        }
                                    }
                                    reader.endObject()
                                    if (id.isNotBlank()) {
                                        podcasts.add(Podcast(
                                            id = id,
                                            title = title,
                                            description = description,
                                            rssUrl = "",
                                            htmlUrl = "",
                                            imageUrl = "",
                                            genres = emptyList(),
                                            typicalDurationMins = 0
                                        ))
                                    }
                                }
                                reader.endArray()
                            }
                            "episodes" -> {
                                reader.beginArray()
                                while (reader.hasNext()) {
                                    reader.beginObject()
                                    var id = ""
                                    var podcastId = ""
                                    var title = ""
                                    var description = ""
                                    var pubDate = ""
                                    while (reader.hasNext()) {
                                        when (reader.nextName()) {
                                            "id" -> id = reader.nextString()
                                            "podcastId" -> podcastId = reader.nextString()
                                            "title" -> title = reader.nextString()
                                            "description" -> description = reader.nextString()
                                            "pubDate" -> pubDate = reader.nextString()
                                            else -> reader.skipValue()
                                        }
                                    }
                                    reader.endObject()
                                    if (id.isNotBlank() && podcastId.isNotBlank()) {
                                        episodes.add(Episode(
                                            id = id,
                                            podcastId = podcastId,
                                            title = title,
                                            description = description,
                                            audioUrl = "",
                                            imageUrl = "",
                                            pubDate = pubDate,
                                            durationMins = 0
                                        ))
                                    }
                                }
                                reader.endArray()
                            }
                            else -> reader.skipValue()
                        }
                    }
                    reader.endObject()
                }
            }
        }

        return RemoteIndex(generatedAt, podcasts, episodes)
    }

    // ── Fallback: home-server search ──────────────────────────────────────────

    /**
     * Return true if the home server's podcast index endpoint is reachable.
     * Result is cached for [SERVER_AVAILABILITY_TTL_MS].
     */
    fun isServerAvailable(): Boolean {
        val now = System.currentTimeMillis()
        val cached = cachedServerAvailable
        if (cached != null && (now - serverAvailabilityCheckedAt) < SERVER_AVAILABILITY_TTL_MS) {
            return cached
        }
        return try {
            val response = getJson("$SERVER_BASE_URL/index/status") ?: run {
                cacheServerAvailability(false)
                return false
            }
            val ok = response.has("podcast_count")
            cacheServerAvailability(ok)
            ok
        } catch (e: Exception) {
            Log.d(TAG, "Home server unavailable: ${e.message}")
            cacheServerAvailability(false)
            false
        }
    }

    private fun cacheServerAvailability(value: Boolean) {
        cachedServerAvailable = value
        serverAvailabilityCheckedAt = System.currentTimeMillis()
    }

    /**
     * Search podcasts on the home server (fallback when static index is
     * unavailable).  Returns an empty list if the server is unreachable.
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
            Log.d(TAG, "searchPodcasts (home server) failed: ${e.message}")
            emptyList()
        }
    }

    /**
     * Search episodes on the home server (fallback when static index is
     * unavailable).  Returns an empty list if the server is unreachable.
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
            Log.d(TAG, "searchEpisodes (home server) failed: ${e.message}")
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

