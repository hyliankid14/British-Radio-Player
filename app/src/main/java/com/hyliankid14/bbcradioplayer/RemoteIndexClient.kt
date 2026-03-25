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
 * Primary source — Google Cloud Storage static index:
 *   A nightly Cloud Scheduler job (or GitHub Actions workflow) runs
 *   `api/build_index.py --bucket BUCKET` and uploads the result to a GCS
 *   bucket.  The Android app downloads it at most once per [INDEX_CACHE_TTL_MS],
 *   caches it on disk, and uses it to populate the local SQLite FTS index.
 *   All searches then run locally — zero per-search traffic.
 *
 *   Configure the bucket URLs at build time via `local.properties`:
 *     GCS_INDEX_URL=https://storage.googleapis.com/YOUR_BUCKET/podcast-index.json.gz
 *     GCS_META_URL=https://storage.googleapis.com/YOUR_BUCKET/podcast-index-meta.json
 *
 * Live search — Cloud Function:
 *   The app also supports querying a Cloud Function that performs server-side
 *   search without requiring a full index download to the device.  Set the
 *   Cloud Function base URL at build time:
 *     CLOUD_FUNCTION_URL=https://REGION-PROJECT.cloudfunctions.net/podcast-search
 *
 *   The Cloud Function exposes the same endpoints as the home server:
 *     /index/status  — lightweight freshness check
 *     /search/podcasts?q=QUERY
 *     /search/episodes?q=QUERY[&limit=N][&offset=N]
 *
 *   See api/GOOGLE_CLOUD_SETUP.md for deployment instructions.
 *
 * Default routing:
 *   If build-time overrides are not provided, the app uses the default
 *   production cloud endpoints bundled in this class.
 *
 * All network calls are synchronous — callers must dispatch to IO threads.
 */
class RemoteIndexClient(private val context: Context) {

    data class PopularPodcastRanking(
        val idRanks: Map<String, Int>,
        val titleRanks: Map<String, Int>,
        /** True when these ranks were read from the on-device disk cache rather than fetched live. */
        val fromCache: Boolean = false,
        /** The `generated_at` timestamp from the GCS snapshot that produced these ranks. */
        val snapshotGeneratedAt: String = ""
    )

    companion object {
        private const val TAG = "RemoteIndexClient"

        // ── Index download URLs ───────────────────────────────────────────────

        // Google Cloud Storage public URLs (set via GCS_INDEX_URL / GCS_META_URL / GCS_STATS_URL
        // in local.properties or environment variables at build time).
        // These are optional overrides; defaults below point to production cloud index.
        private val GCS_INDEX_URL: String get() = BuildConfig.GCS_INDEX_URL
        private val GCS_META_URL: String  get() = BuildConfig.GCS_META_URL
        private val GCS_STATS_URL: String get() = BuildConfig.GCS_STATS_URL

        // Default cloud-hosted index URLs.
        private const val DEFAULT_CLOUD_INDEX_URL =
            "https://storage.googleapis.com/bbc-radio-player-index-20260317-bc149e38/podcast-index.json.gz"
        private const val DEFAULT_CLOUD_META_URL =
            "https://storage.googleapis.com/bbc-radio-player-index-20260317-bc149e38/podcast-index-meta.json"

        // Default cloud-hosted popularity snapshot URL (uploaded by the export-popular-podcasts
        // GitHub Actions workflow from the analytics server every 6 hours).
        private const val DEFAULT_CLOUD_STATS_URL =
            "https://storage.googleapis.com/bbc-radio-player-index-20260317-bc149e38/popular-podcasts.json"

        // Resolved index URL: prefer explicit build-time overrides, otherwise cloud defaults.
        internal val INDEX_URL: String
            get() = GCS_INDEX_URL.takeIf { it.isNotBlank() } ?: DEFAULT_CLOUD_INDEX_URL
        internal val META_URL: String
            get() = GCS_META_URL.takeIf { it.isNotBlank() } ?: DEFAULT_CLOUD_META_URL
        internal val STATS_URL: String
            get() = GCS_STATS_URL.takeIf { it.isNotBlank() } ?: DEFAULT_CLOUD_STATS_URL

        // ── Live search URL ───────────────────────────────────────────────────

        // Cloud Function base URL (set via CLOUD_FUNCTION_URL in local.properties).
        // Uses the default production endpoint when not configured.
        private val CLOUD_FUNCTION_URL: String get() = BuildConfig.CLOUD_FUNCTION_URL

        // Default cloud-hosted live search endpoint.
        internal const val SERVER_BASE_URL = "https://podcast-search-tcy4hnuh2q-nw.a.run.app"

        // Resolved live-search base URL: prefer explicit build-time override, else default.
        internal val LIVE_SEARCH_URL: String
            get() = CLOUD_FUNCTION_URL.takeIf { it.isNotBlank() } ?: SERVER_BASE_URL

        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val READ_TIMEOUT_MS = 30_000
        private const val LIVE_SEARCH_CONNECT_TIMEOUT_MS = 4_000
        private const val LIVE_SEARCH_READ_TIMEOUT_MS = 8_000

        // Re-download the static index at most once every 6 hours.
        private const val INDEX_CACHE_TTL_MS = 6 * 60 * 60 * 1_000L
        private const val INDEX_CACHE_FILENAME = "remote_podcast_index.json"

        // Disk cache for popular podcast ranks (6-hour TTL — matches the GCS snapshot update
        // interval so the cache expires within one update cycle of the GitHub Actions workflow).
        // The cache is written after each successful network fetch so subsequent
        // app launches return immediately without waiting for the home server.
        private const val POPULAR_CACHE_FILENAME = "popular_podcast_ranks.json"
        private const val POPULAR_CACHE_TTL_MS = 6 * 60 * 60 * 1_000L

        // Disk cache for the streamed index summary used by browse sorts.
        private const val INDEX_SUMMARY_CACHE_FILENAME = "remote_podcast_index_summary.json"

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
    * Parsed result of the pre-built cloud-hosted index.
     * [episodes] may be empty on failure — callers should tolerate that.
     */
    data class RemoteIndex(
        val generatedAt: String,
        val podcasts: List<Podcast>,
        val episodes: List<Episode>
    )

    data class PodcastEpisodeBounds(
        val earliestEpisodeEpoch: Long,
        val latestEpisodeEpoch: Long
    )

    data class RemoteIndexSummary(
        val generatedAt: String,
        val podcastIds: Set<String>,
        val podcastBounds: Map<String, PodcastEpisodeBounds>
    )

    /**
     * Lightweight metadata from `podcast-index-meta.json`.
     * Fetched to check whether the remote index is newer than the locally
     * cached version before committing to a full 250 MB+ download.
     */
    data class RemoteIndexMeta(
        val generatedAt: String,
        val podcastCount: Int,
        val episodeCount: Int
    )

    /**
    * Fetch the tiny companion metadata file from cloud storage.
     * Returns null on any network or parse error.
     */
    fun fetchRemoteIndexMeta(): RemoteIndexMeta? {
        return try {
            val conn = openConnection(META_URL, bypassCaches = true)
            conn.requestMethod = "GET"
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                conn.disconnect()
                return null
            }
            val json = JSONObject(readBody(conn))
            RemoteIndexMeta(
                generatedAt  = json.optString("generated_at", ""),
                podcastCount = json.optInt("podcast_count", 0),
                episodeCount = json.optInt("episode_count", 0)
            )
        } catch (e: Exception) {
            Log.d(TAG, "Failed to fetch remote index meta: ${e.message}")
            null
        }
    }

    /**
     * Return true when the remote index has a different (newer) `generated_at`
     * than [currentGeneratedAt].  Falls back to the cache-age check if the
     * metadata endpoint is unreachable.
     *
     * @param currentGeneratedAt The `generated_at` value from the last
     *   successfully applied index, or null/blank for a first-time install.
     */
    fun isRemoteIndexNewer(currentGeneratedAt: String?): Boolean {
        if (currentGeneratedAt.isNullOrBlank()) return true
        return try {
            val meta = fetchRemoteIndexMeta()
                ?: return isCachedIndexStale() // metadata unavailable — use cache TTL
            meta.generatedAt.isNotBlank() && meta.generatedAt != currentGeneratedAt
        } catch (e: Exception) {
            Log.w(TAG, "Remote freshness check failed: ${e.message}")
            isCachedIndexStale()
        }
    }

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
    * Download the pre-built podcast index from cloud storage,
     * cache it on disk, and return the parsed [RemoteIndex].  Returns null on
     * failure.
     *
     * This is the primary path used by [IndexWorker]: one download replaces
     * hundreds of individual RSS feed fetches and eliminates all per-search
     * server traffic.
     *
     * @param forceDownload When true the cached copy is ignored and a fresh
     *   download is always performed (e.g. after [isRemoteIndexNewer] says the
     *   remote has been updated).
     * @param onProgress Optional callback to report download progress (message, percent)
     */
    fun downloadIndex(forceDownload: Boolean = false, onProgress: ((String, Int) -> Unit)? = null): RemoteIndex? {
        val cacheFile = ensureCachedIndexFile(forceDownload = forceDownload, onProgress = onProgress)
            ?: return null

        return try {
            onProgress?.invoke("Parsing index...", 18)
            // Parse with streaming JSON reader to avoid OOM
            parseIndexFromFile(cacheFile, onProgress)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to download podcast index: ${e.message}")
            null
        }
    }

    fun getIndexSummary(forceDownload: Boolean = false, onProgress: ((String, Int) -> Unit)? = null): RemoteIndexSummary? {
        val cacheFile = ensureCachedIndexFile(forceDownload = forceDownload, onProgress = onProgress)
            ?: return null

        readIndexSummaryCache(cacheFile)?.let {
            Log.d(TAG, "Using cached podcast index summary")
            return it
        }

        return try {
            onProgress?.invoke("Summarising index...", 18)
            parseIndexSummaryFromFile(cacheFile, onProgress).also { summary ->
                saveIndexSummaryCache(cacheFile, summary)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to summarise podcast index: ${e.message}")
            null
        }
    }

    private fun ensureCachedIndexFile(
        forceDownload: Boolean,
        onProgress: ((String, Int) -> Unit)? = null
    ): File? {
        val cacheFile = File(context.cacheDir, INDEX_CACHE_FILENAME)

        if (!forceDownload && !isCachedIndexStale() && cacheFile.exists()) {
            Log.d(TAG, "Using cached podcast index (${cacheFile.length() / 1024} KB)")
            return cacheFile
        }

        return try {
            val sourceLabel = "Cloud index"
            onProgress?.invoke("Connecting to $sourceLabel...", 5)
            Log.d(TAG, "Downloading podcast index from $INDEX_URL")
            val conn = openConnection(INDEX_URL)
            conn.requestMethod = "GET"
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                Log.w(TAG, "$sourceLabel returned HTTP ${conn.responseCode}")
                conn.disconnect()
                return null
            }
            onProgress?.invoke("Downloading index...", 7)

            val tempFile = File(context.cacheDir, "${INDEX_CACHE_FILENAME}.tmp")
            BufferedInputStream(conn.inputStream).use { networkStream ->
                networkStream.mark(2)
                val firstByte = networkStream.read()
                val secondByte = networkStream.read()
                networkStream.reset()

                val isGzipPayload = firstByte == 0x1f && secondByte == 0x8b
                if (!isGzipPayload) {
                    Log.w(TAG, "Index response is not gzipped; processing as plain JSON payload")
                }

                val payloadStream = if (isGzipPayload) {
                    GZIPInputStream(networkStream)
                } else {
                    networkStream
                }

                payloadStream.use { decodedStream ->
                    BufferedOutputStream(FileOutputStream(tempFile)).use { fileOut ->
                        val buffer = ByteArray(8192)
                        var bytesRead: Int
                        var totalBytes = 0L
                        var lastProgress = 7

                        while (decodedStream.read(buffer).also { bytesRead = it } != -1) {
                            fileOut.write(buffer, 0, bytesRead)
                            totalBytes += bytesRead

                            if (totalBytes % 200000 < 8192) {
                                val newProgress = (7 + (totalBytes / 200000).toInt().coerceAtMost(10))
                                    .coerceIn(7, 17)
                                if (newProgress > lastProgress) {
                                    onProgress?.invoke("Processing index... (${totalBytes / 1000}KB)", newProgress)
                                    lastProgress = newProgress
                                }
                            }
                        }
                    }
                }
            }
            conn.disconnect()

            onProgress?.invoke("Saving to cache...", 17)
            if (!tempFile.renameTo(cacheFile)) {
                tempFile.copyTo(cacheFile, overwrite = true)
                tempFile.delete()
            }
            Log.d(TAG, "Downloaded and decompressed podcast index (${cacheFile.length() / 1024} KB)")
            cacheFile
        } catch (e: Exception) {
            Log.w(TAG, "Failed to cache podcast index: ${e.message}")
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
    private fun parseIndexFromFile(file: File, onProgress: ((String, Int) -> Unit)? = null): RemoteIndex {
        var generatedAt = ""
        val podcasts = mutableListOf<Podcast>()
        val episodes = mutableListOf<Episode>()

        var lastPodcastReport = 0
        var lastEpisodeReport = 0

        fun reportParsingStatus() {
            val podcastCount = podcasts.size
            val episodeCount = episodes.size
            onProgress?.invoke(
                "Parsing index... podcasts: $podcastCount, episodes: $episodeCount",
                18
            )
        }

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
                                        if (podcasts.size - lastPodcastReport >= 250) {
                                            reportParsingStatus()
                                            lastPodcastReport = podcasts.size
                                        }
                                    }
                                }
                                reader.endArray()
                                reportParsingStatus()
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
                                        if (episodes.size - lastEpisodeReport >= 5_000) {
                                            reportParsingStatus()
                                            lastEpisodeReport = episodes.size
                                        }
                                    }
                                }
                                reader.endArray()
                                reportParsingStatus()
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

    private fun parseIndexSummaryFromFile(file: File, onProgress: ((String, Int) -> Unit)? = null): RemoteIndexSummary {
        var generatedAt = ""
        val podcastIds = linkedSetOf<String>()
        val podcastBounds = linkedMapOf<String, PodcastEpisodeBounds>()
        var lastPodcastReport = 0
        var lastBoundsReport = 0

        fun reportParsingStatus() {
            onProgress?.invoke(
                "Summarising index... podcasts: ${podcastIds.size}, bounded podcasts: ${podcastBounds.size}",
                18
            )
        }

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
                                    while (reader.hasNext()) {
                                        when (reader.nextName()) {
                                            "id" -> id = reader.nextString()
                                            else -> reader.skipValue()
                                        }
                                    }
                                    reader.endObject()
                                    if (id.isNotBlank()) {
                                        podcastIds.add(id)
                                        if (podcastIds.size - lastPodcastReport >= 500) {
                                            reportParsingStatus()
                                            lastPodcastReport = podcastIds.size
                                        }
                                    }
                                }
                                reader.endArray()
                                reportParsingStatus()
                            }
                            "episodes" -> {
                                reader.beginArray()
                                while (reader.hasNext()) {
                                    reader.beginObject()
                                    var podcastId = ""
                                    var pubDate = ""
                                    while (reader.hasNext()) {
                                        when (reader.nextName()) {
                                            "podcastId" -> podcastId = reader.nextString()
                                            "pubDate" -> pubDate = reader.nextString()
                                            else -> reader.skipValue()
                                        }
                                    }
                                    reader.endObject()

                                    if (podcastId.isBlank()) continue
                                    val epoch = com.hyliankid14.bbcradioplayer.db.IndexStore.parsePubEpoch(pubDate)
                                    if (epoch <= 0L) continue

                                    val existing = podcastBounds[podcastId]
                                    podcastBounds[podcastId] = if (existing == null) {
                                        PodcastEpisodeBounds(
                                            earliestEpisodeEpoch = epoch,
                                            latestEpisodeEpoch = epoch
                                        )
                                    } else {
                                        PodcastEpisodeBounds(
                                            earliestEpisodeEpoch = minOf(existing.earliestEpisodeEpoch, epoch),
                                            latestEpisodeEpoch = maxOf(existing.latestEpisodeEpoch, epoch)
                                        )
                                    }

                                    if (podcastBounds.size - lastBoundsReport >= 1000) {
                                        reportParsingStatus()
                                        lastBoundsReport = podcastBounds.size
                                    }
                                }
                                reader.endArray()
                                reportParsingStatus()
                            }
                            else -> reader.skipValue()
                        }
                    }
                    reader.endObject()
                }
            }
        }

        return RemoteIndexSummary(
            generatedAt = generatedAt,
            podcastIds = podcastIds,
            podcastBounds = podcastBounds
        )
    }

    private fun readIndexSummaryCache(sourceFile: File): RemoteIndexSummary? {
        val cacheFile = File(context.cacheDir, INDEX_SUMMARY_CACHE_FILENAME)
        if (!cacheFile.exists()) return null

        return try {
            val json = JSONObject(cacheFile.readText())
            if (json.optLong("source_last_modified", -1L) != sourceFile.lastModified()) {
                return null
            }

            val podcastIds = linkedSetOf<String>()
            val idsArray = json.optJSONArray("podcast_ids") ?: JSONArray()
            for (i in 0 until idsArray.length()) {
                val id = idsArray.optString(i)
                if (id.isNotBlank()) podcastIds.add(id)
            }

            val podcastBounds = linkedMapOf<String, PodcastEpisodeBounds>()
            val boundsObject = json.optJSONObject("podcast_bounds") ?: JSONObject()
            boundsObject.keys().forEach { podcastId ->
                val item = boundsObject.optJSONObject(podcastId) ?: return@forEach
                val earliest = item.optLong("earliestEpoch", 0L)
                val latest = item.optLong("latestEpoch", 0L)
                if (earliest > 0L && latest > 0L) {
                    podcastBounds[podcastId] = PodcastEpisodeBounds(
                        earliestEpisodeEpoch = earliest,
                        latestEpisodeEpoch = latest
                    )
                }
            }

            RemoteIndexSummary(
                generatedAt = json.optString("generated_at", ""),
                podcastIds = podcastIds,
                podcastBounds = podcastBounds
            )
        } catch (e: Exception) {
            Log.d(TAG, "Failed to read index summary cache: ${e.message}")
            null
        }
    }

    private fun saveIndexSummaryCache(sourceFile: File, summary: RemoteIndexSummary) {
        val cacheFile = File(context.cacheDir, INDEX_SUMMARY_CACHE_FILENAME)
        val tempFile = File(context.cacheDir, "$INDEX_SUMMARY_CACHE_FILENAME.tmp")
        try {
            val boundsObject = JSONObject()
            summary.podcastBounds.forEach { (podcastId, bounds) ->
                boundsObject.put(
                    podcastId,
                    JSONObject().apply {
                        put("earliestEpoch", bounds.earliestEpisodeEpoch)
                        put("latestEpoch", bounds.latestEpisodeEpoch)
                    }
                )
            }

            val json = JSONObject().apply {
                put("generated_at", summary.generatedAt)
                put("source_last_modified", sourceFile.lastModified())
                put("podcast_ids", JSONArray(summary.podcastIds.toList()))
                put("podcast_bounds", boundsObject)
            }

            tempFile.writeText(json.toString())
            if (!tempFile.renameTo(cacheFile)) {
                tempFile.copyTo(cacheFile, overwrite = true)
                tempFile.delete()
            }
        } catch (e: Exception) {
            Log.d(TAG, "Failed to save index summary cache: ${e.message}")
            tempFile.delete()
        }
    }

    // ── Fallback: home-server search ──────────────────────────────────────────

    /**
     * Return true if the live search endpoint (Cloud Function or home server)
     * is reachable.  Result is cached for [SERVER_AVAILABILITY_TTL_MS].
     */
    fun isServerAvailable(): Boolean {
        val now = System.currentTimeMillis()
        val cached = cachedServerAvailable
        if (cached != null && (now - serverAvailabilityCheckedAt) < SERVER_AVAILABILITY_TTL_MS) {
            return cached
        }
        return try {
            val response = getJson("$LIVE_SEARCH_URL/index/status") ?: run {
                cacheServerAvailability(false)
                return false
            }
            val ok = response.has("podcast_count")
            cacheServerAvailability(ok)
            ok
        } catch (e: Exception) {
            Log.d(TAG, "Live search endpoint unavailable: ${e.message}")
            cacheServerAvailability(false)
            false
        }
    }

    private fun cacheServerAvailability(value: Boolean) {
        cachedServerAvailable = value
        serverAvailabilityCheckedAt = System.currentTimeMillis()
    }

    /**
     * Search podcasts via the live search endpoint (Cloud Function or home
     * server fallback).  Returns an empty list if the endpoint is unreachable.
     */
    fun searchPodcasts(query: String, limit: Int = 50): List<PodcastFts> {
        if (query.isBlank()) return emptyList()
        return try {
            val url = "$LIVE_SEARCH_URL/search/podcasts?q=${encode(query)}&limit=$limit"
            val array = getJsonArray(
                url,
                connectTimeoutMs = LIVE_SEARCH_CONNECT_TIMEOUT_MS,
                readTimeoutMs = LIVE_SEARCH_READ_TIMEOUT_MS
            ) ?: return emptyList()
            (0 until array.length()).mapNotNull { i ->
                val obj = array.optJSONObject(i) ?: return@mapNotNull null
                PodcastFts(
                    podcastId   = obj.optString("podcastId"),
                    title       = obj.optString("title"),
                    description = obj.optString("description")
                )
            }
        } catch (e: Exception) {
            Log.d(TAG, "searchPodcasts (live endpoint) failed: ${e.message}")
            emptyList()
        }
    }

    /**
     * Search episodes via the live search endpoint (Cloud Function or home
     * server fallback).  Returns an empty list if the endpoint is unreachable.
     */
    fun searchEpisodes(query: String, limit: Int = 100, offset: Int = 0): List<EpisodeFts> {
        if (query.isBlank()) return emptyList()
        return try {
            val url = "$LIVE_SEARCH_URL/search/episodes?q=${encode(query)}&limit=$limit&offset=$offset"
            val array = getJsonArray(
                url,
                connectTimeoutMs = LIVE_SEARCH_CONNECT_TIMEOUT_MS,
                readTimeoutMs = LIVE_SEARCH_READ_TIMEOUT_MS
            ) ?: return emptyList()
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
            Log.d(TAG, "searchEpisodes (live endpoint) failed: ${e.message}")
            emptyList()
        }
    }

    /**
     * Fetch podcast popularity ranks from analytics stats.
     *
     * Returns a map of podcast ID -> 1-based rank, where lower is more popular.
     * If stats are unavailable, returns an empty map so callers can fall back.
     *
     * Loading order (fastest to slowest):
     *   1. Disk cache — returns immediately if the cache is less than 6 hours old
     *      (skipped when [skipCache] is true).
     *   2. GCS snapshot — CDN-hosted JSON uploaded by the export-popular-podcasts
     *      GitHub Actions workflow every 6 hours.  Fast and globally available.
     *   3. Home analytics server — real-time data but subject to home-server latency.
     *   4. Cloud Function — fallback if both of the above are unreachable.
     *
     * A successful network result is always written back to disk so the next
     * launch returns instantly from step 1.
     *
     * @param skipCache When true the disk cache is ignored and a live network request is always
     *   made. Use this for background refresh calls so the UI stays up-to-date after the GCS
     *   snapshot is refreshed by the GitHub Actions workflow.
     */
    fun fetchPopularPodcastRanks(days: Int = 30, limit: Int = 200, skipCache: Boolean = false): PopularPodcastRanking {
        // Step 1: return disk cache immediately if it is still fresh (and not bypassed).
        if (!skipCache) {
            readPopularRanksCache()?.let { cached ->
                Log.d(TAG, "fetchPopularPodcastRanks: returning fresh disk cache")
                return cached.copy(fromCache = true)
            }
        }

        // Steps 2-4: try each URL in priority order (GCS snapshot → home server → Cloud Function).
        val safeDays = days.coerceAtLeast(1)
        val safeLimit = limit.coerceAtLeast(1)
        val statsUrls = listOf(
            // GCS-hosted snapshot: fast, globally available, updated every 6 hours.
            STATS_URL,
            // Home analytics server: real-time but may be slow on home connections.
            "${PrivacyAnalytics.getAnalyticsBaseUrl()}/stats?days=${encode(safeDays.toString())}",
            // Cloud Function fallback.
            "$LIVE_SEARCH_URL/stats?days=${encode(safeDays.toString())}"
        )

        for (url in statsUrls) {
            try {
                val response = getJson(
                    url,
                    connectTimeoutMs = LIVE_SEARCH_CONNECT_TIMEOUT_MS,
                    readTimeoutMs = LIVE_SEARCH_READ_TIMEOUT_MS
                ) ?: continue

                val popular = response.optJSONArray("popular_podcasts") ?: continue
                val generatedAt = response.optString("generated_at", "")

                data class PopularEntry(val id: String, val name: String, val plays: Int)
                val entries = mutableListOf<PopularEntry>()
                val max = minOf(popular.length(), safeLimit)
                for (i in 0 until max) {
                    val item = popular.optJSONObject(i) ?: continue
                    val podcastId = item.optString("id", "").trim()
                    val podcastName = item.optString("name", "").trim()
                    val plays = item.optInt("plays", 0)
                    if (podcastId.isBlank() && podcastName.isBlank()) continue
                    entries.add(PopularEntry(podcastId, podcastName, plays))
                }

                // Defensive sort by play count in case the endpoint output order changes.
                val sorted = entries.sortedWith(
                    compareByDescending<PopularEntry> { it.plays }
                        .thenBy { it.name }
                        .thenBy { it.id }
                )

                val idRanks = linkedMapOf<String, Int>()
                val titleRanks = linkedMapOf<String, Int>()
                sorted.forEachIndexed { index, entry ->
                    val rank = index + 1
                    if (entry.id.isNotBlank() && !idRanks.containsKey(entry.id)) {
                        idRanks[entry.id] = rank
                    }
                    val normalizedTitle = normalizeTitle(entry.name)
                    if (normalizedTitle.isNotBlank() && !titleRanks.containsKey(normalizedTitle)) {
                        titleRanks[normalizedTitle] = rank
                    }
                }

                if (idRanks.isNotEmpty() || titleRanks.isNotEmpty()) {
                    val result = PopularPodcastRanking(
                        idRanks = idRanks,
                        titleRanks = titleRanks,
                        snapshotGeneratedAt = generatedAt
                    )
                    savePopularRanksCache(result)
                    return result
                }
            } catch (e: Exception) {
                Log.d(TAG, "fetchPopularPodcastRanks failed for $url: ${e.message}")
            }
        }
        return PopularPodcastRanking(idRanks = emptyMap(), titleRanks = emptyMap())
    }

    /**
     * Read popular podcast ranks from the on-device disk cache.
     *
     * Returns null if the cache file does not exist or is older than
     * [POPULAR_CACHE_TTL_MS] (6 hours).
     */
    private fun readPopularRanksCache(): PopularPodcastRanking? {
        val cacheFile = File(context.cacheDir, POPULAR_CACHE_FILENAME)
        if (!cacheFile.exists()) return null
        if (System.currentTimeMillis() - cacheFile.lastModified() > POPULAR_CACHE_TTL_MS) return null
        return try {
            val json = JSONObject(cacheFile.readText())
            val idRanksObj = json.optJSONObject("id_ranks") ?: return null
            val titleRanksObj = json.optJSONObject("title_ranks") ?: return null
            val idRanks = linkedMapOf<String, Int>()
            val titleRanks = linkedMapOf<String, Int>()
            idRanksObj.keys().forEach { key -> idRanks[key] = idRanksObj.getInt(key) }
            titleRanksObj.keys().forEach { key -> titleRanks[key] = titleRanksObj.getInt(key) }
            val generatedAt = json.optString("generated_at", "")
            PopularPodcastRanking(idRanks = idRanks, titleRanks = titleRanks, snapshotGeneratedAt = generatedAt)
        } catch (e: Exception) {
            Log.d(TAG, "Failed to read popular ranks cache: ${e.message}")
            null
        }
    }

    /**
     * Persist popular podcast ranks to disk so the next launch can return
     * immediately without a network round-trip.
     *
     * Also persists [PopularPodcastRanking.snapshotGeneratedAt] so the next
     * launch can detect whether the GCS snapshot has been updated since the
     * data was cached.
     *
     * Writes to a temporary file first and renames atomically to prevent a
     * corrupt cache if the app is killed mid-write.
     */
    private fun savePopularRanksCache(ranking: PopularPodcastRanking) {
        val cacheFile = File(context.cacheDir, POPULAR_CACHE_FILENAME)
        val tmpFile = File(context.cacheDir, "$POPULAR_CACHE_FILENAME.tmp")
        try {
            val idRanksObj = JSONObject()
            ranking.idRanks.forEach { (k, v) -> idRanksObj.put(k, v) }
            val titleRanksObj = JSONObject()
            ranking.titleRanks.forEach { (k, v) -> titleRanksObj.put(k, v) }
            val json = JSONObject()
            json.put("id_ranks", idRanksObj)
            json.put("title_ranks", titleRanksObj)
            if (ranking.snapshotGeneratedAt.isNotBlank()) {
                json.put("generated_at", ranking.snapshotGeneratedAt)
            }
            tmpFile.writeText(json.toString())
            tmpFile.renameTo(cacheFile)
            Log.d(TAG, "Saved popular ranks cache: ${ranking.idRanks.size} ids")
        } catch (e: Exception) {
            Log.d(TAG, "Failed to save popular ranks cache: ${e.message}")
            tmpFile.delete()
        }
    }

    private fun normalizeTitle(value: String): String =
        value.trim().lowercase().replace(Regex("\\s+"), " ")

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    private fun getJson(
        urlStr: String,
        connectTimeoutMs: Int = CONNECT_TIMEOUT_MS,
        readTimeoutMs: Int = READ_TIMEOUT_MS
    ): JSONObject? {
        val conn = openConnection(urlStr, connectTimeoutMs = connectTimeoutMs, readTimeoutMs = readTimeoutMs)
        conn.requestMethod = "GET"
        if (conn.responseCode == HttpURLConnection.HTTP_OK) {
            return JSONObject(readBody(conn))
        }
        conn.disconnect()
        return null
    }

    private fun getJsonArray(
        urlStr: String,
        connectTimeoutMs: Int = CONNECT_TIMEOUT_MS,
        readTimeoutMs: Int = READ_TIMEOUT_MS
    ): JSONArray? {
        val conn = openConnection(urlStr, connectTimeoutMs = connectTimeoutMs, readTimeoutMs = readTimeoutMs)
        conn.requestMethod = "GET"
        if (conn.responseCode == HttpURLConnection.HTTP_OK) {
            return JSONArray(readBody(conn))
        }
        conn.disconnect()
        return null
    }

    private fun openConnection(
        urlStr: String,
        bypassCaches: Boolean = false,
        connectTimeoutMs: Int = CONNECT_TIMEOUT_MS,
        readTimeoutMs: Int = READ_TIMEOUT_MS
    ): HttpURLConnection {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.connectTimeout = connectTimeoutMs
        conn.readTimeout = readTimeoutMs
        if (bypassCaches) {
            conn.useCaches = false
            conn.setRequestProperty("Cache-Control", "no-cache")
            conn.setRequestProperty("Pragma", "no-cache")
        }
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

