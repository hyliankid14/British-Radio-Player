package com.hyliankid14.bbcradioplayer

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class ScheduleEntry(
    val title: String,
    val episodeTitle: String?,
    val startTimeMs: Long,
    val endTimeMs: Long,
    val imageUrl: String?
)

data class CurrentShow(
    val title: String, // Show Name (Programme)
    val episodeTitle: String? = null, // Episode title (from ESS)
    val secondary: String? = null, // Artist (from Segment)
    val tertiary: String? = null, // Track (from Segment)
    val description: String? = null,
    val imageUrl: String? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val segmentStartMs: Long? = null,
    val segmentDurationMs: Long? = null,
    val nextShowTitle: String? = null, // Next upcoming show name
    val nextShowStartTimeMs: Long? = null // When the next show starts (milliseconds since epoch)
) {
    // Format the full subtitle as "primary - secondary - tertiary"
    fun getFormattedTitle(): String {
        // Prefer artist/track (RMS) when present — this is more useful for music segments than schedule episode titles
        val parts = mutableListOf<String>()
        if (!secondary.isNullOrEmpty()) parts.add(secondary)
        if (!tertiary.isNullOrEmpty()) parts.add(tertiary)
        if (parts.isNotEmpty()) {
            return parts.joinToString(" - ")
        }

        // If no song data available, fall back to episode title (from ESS) if present
        if (!episodeTitle.isNullOrEmpty()) return episodeTitle

        // Otherwise use the show/brand name
        return title
    }
}

object ShowInfoFetcher {
    private const val TAG = "ShowInfoFetcher"
    
    var lastRmsCacheMaxAgeMs = 30_000L // Track server-reported cache TTL
    
    private val serviceIdMap by lazy {
        StationRepository.getStations().associate { it.id to it.serviceId }
    }

    /**
     * Maps a BBC service ID to the URL path segment used by the BBC website's schedule pages.
     * The full schedule URL for a date is:
     *   https://www.bbc.co.uk/{path}/{year}/{month}/{day}
     * where {path} is the value in this map for the given serviceId.
     *
     * Entries are only required where the path cannot be auto-derived. Most local stations
     * follow the auto-derivation rule: "bbc_radio_{name}" → "radio{name}/programmes/schedules".
     */
    private val schedulePathMap = mapOf(
        // National
        "bbc_radio_one"                    to "radio1/programmes/schedules",
        "bbc_1xtra"                        to "1xtra/programmes/schedules",
        "bbc_radio_two"                    to "radio2/programmes/schedules",
        "bbc_radio_three"                  to "radio3/programmes/schedules",
        "bbc_radio_fourfm"                 to "radio4/programmes/schedules/fm",
        "bbc_radio_four_extra"             to "radio4extra/programmes/schedules",
        "bbc_radio_five_live"              to "5live/programmes/schedules",
        "bbc_radio_five_live_sports_extra" to "5livesportsextra/programmes/schedules",
        "bbc_6music"                       to "6music/programmes/schedules",
        "bbc_world_service"                to "worldserviceradio/programmes/schedules/uk",
        "bbc_asian_network"                to "asiannetwork/programmes/schedules",
        // Regions
        "bbc_radio_cymru"                  to "radiocymru/programmes/schedules",
        "bbc_radio_foyle"                  to "radiofoyle/programmes/schedules",
        "bbc_radio_nan_gaidheal"           to "radionangaidheal/programmes/schedules",
        "bbc_radio_orkney"                 to "radioscotland/programmes/schedules/orkney",
        "bbc_radio_scotland_fm"            to "radioscotland/programmes/schedules/fm",
        "bbc_radio_scotland_mw"            to "radioscotland/programmes/schedules/mw",
        "bbc_radio_shetland"               to "radioscotland/programmes/schedules/shetland",
        "bbc_radio_ulster"                 to "radioulster/programmes/schedules",
        "bbc_radio_wales_fm"               to "radiowales/programmes/schedules/fm",
        "bbc_radio_wales_am"               to "radiowales/programmes/schedules/mw",
        // Local stations whose URL path differs from the auto-derived form
        "bbc_radio_cambridge"              to "radiocambridgeshire/programmes/schedules",
        "bbc_radio_coventry_warwickshire"  to "bbccoventryandwarwickshire/programmes/schedules",
        "bbc_radio_essex"                  to "bbcessex/programmes/schedules",
        "bbc_radio_hereford_worcester"     to "bbcherefordandworcester/programmes/schedules",
        "bbc_radio_newcastle"              to "bbcnewcastle/programmes/schedules",
        "bbc_radio_somerset_sound"         to "bbcsomerset/programmes/schedules",
        "bbc_radio_surrey"                 to "bbcsurrey/programmes/schedules",
        "bbc_radio_sussex"                 to "bbcsussex/programmes/schedules",
        "bbc_tees"                         to "bbctees/programmes/schedules",
        "bbc_three_counties_radio"         to "threecountiesradio/programmes/schedules",
        "bbc_wm"                           to "wm/programmes/schedules",
        "bbc_radio_wiltshire"              to "bbcwiltshire/programmes/schedules",
        "bbc_london"                       to "radiolondon/programmes/schedules",
    )

    /**
     * Returns the BBC website schedule URL path for [serviceId], or null if the station
     * has no dedicated BBC schedule page.
     *
     * Stations with a serviceId of the form "bbc_radio_{name}" are auto-derived as
     * "radio{name}/programmes/schedules" unless overridden in [schedulePathMap].
     */
    private fun schedulePathFor(serviceId: String): String? {
        schedulePathMap[serviceId]?.let { return it }
        // Auto-derive for standard "bbc_radio_{name}" service IDs
        if (serviceId.startsWith("bbc_radio_")) {
            val name = serviceId.removePrefix("bbc_radio_").replace("_", "")
            return "radio$name/programmes/schedules"
        }
        return null
    }
    
    suspend fun getCurrentShow(stationId: String): CurrentShow = withContext(Dispatchers.IO) {
        try {
            val serviceId = serviceIdMap[stationId] ?: return@withContext CurrentShow("BBC Radio")
            
            // 1. Fetch Schedule (Show Name) from ESS
            val scheduleShow = fetchShowFromEss(serviceId)
            val showName = if (scheduleShow.title != "BBC Radio") scheduleShow.title else ""
            
            // 2. Fetch Segment (Now Playing) from RMS
            // Add timestamp to prevent caching
            val url = "https://rms.api.bbc.co.uk/v2/services/$serviceId/segments/latest?t=${System.currentTimeMillis()}"
            
            Log.d(TAG, "Fetching now playing info for $stationId ($serviceId) from $url")
            
            val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.setRequestProperty("User-Agent", "AndroidAutoRadioPlayer/1.0")
            
            val responseCode = connection.responseCode
            
            var artist: String? = null
            var track: String? = null
            var imageUrl: String? = null
            var segmentStartMs: Long? = null
            var segmentDurationMs: Long? = null
            
            if (responseCode == 200) {
                val response = connection.inputStream.bufferedReader().readText()
                // Extract Cache-Control max-age from response headers if present
                val cacheControl = connection.getHeaderField("Cache-Control") ?: ""
                lastRmsCacheMaxAgeMs = parseCacheControlMaxAge(cacheControl).also { ttl ->
                    if (ttl > 0) Log.d(TAG, "RMS Cache-Control max-age: ${ttl}ms")
                }
                connection.disconnect()
                
                val segmentShow = parseShowFromRmsResponse(response)
                if (segmentShow != null) {
                    // RMS sometimes returns Artist in 'title' (primary) and Track in 'secondary' or 'tertiary'
                    artist = segmentShow.title
                    // Prefer 'secondary' (common) but fall back to 'tertiary' if needed
                    track = segmentShow.secondary ?: segmentShow.tertiary
                    imageUrl = segmentShow.imageUrl
                    segmentStartMs = segmentShow.segmentStartMs
                    segmentDurationMs = segmentShow.segmentDurationMs
                }
            } else if (responseCode == 404) {
                Log.d(TAG, "RMS returned 404 (No Content), assuming no song playing")
                connection.disconnect()
                // artist/track remain null, effectively clearing song data
            } else {
                connection.disconnect()
                // If RMS fails (e.g. 500), throw exception to prevent overwriting valid data with empty data
                // This ensures that if we have a transient error, we keep the previous metadata
                throw java.io.IOException("RMS API returned $responseCode")
            }
            
            // Combine info
            // If we have a show name, use it as title. If not, fallback to "BBC Radio"
            val finalTitle = if (showName.isNotEmpty()) showName else "BBC Radio"
            
            // Use RMS image if available, otherwise ESS image
            val finalImageUrl = imageUrl ?: scheduleShow.imageUrl
            
            return@withContext CurrentShow(
                title = finalTitle,
                episodeTitle = scheduleShow.episodeTitle,
                secondary = artist,
                tertiary = track,
                imageUrl = finalImageUrl,
                startTime = scheduleShow.startTime,
                endTime = scheduleShow.endTime,
                segmentStartMs = segmentStartMs,
                segmentDurationMs = segmentDurationMs,
                nextShowTitle = scheduleShow.nextShowTitle,
                nextShowStartTimeMs = scheduleShow.nextShowStartTimeMs
            )
            
        } catch (e: Exception) {
            Log.w(TAG, "Error fetching show info: ${e.message}", e)
            // Propagate exception to caller (RadioService) so it can decide whether to keep old data
            // This prevents clearing the "Now Playing" info on transient network errors
            throw e
        }
    }
    
    suspend fun getScheduleCurrentShow(stationId: String): CurrentShow = withContext(Dispatchers.IO) {
        val serviceId = serviceIdMap[stationId] ?: return@withContext CurrentShow("BBC Radio")
        return@withContext fetchShowFromEss(serviceId)
    }

    suspend fun fetchFullSchedule(stationId: String): List<ScheduleEntry> = withContext(Dispatchers.IO) {
        val serviceId = serviceIdMap[stationId] ?: return@withContext emptyList()
        return@withContext fetchScheduleEntriesFromEss(serviceId)
    }

    suspend fun fetchScheduleForDate(stationId: String, date: String): List<ScheduleEntry> = withContext(Dispatchers.IO) {
        val serviceId = serviceIdMap[stationId] ?: return@withContext emptyList()
        // Determine today's date in the device's local timezone (same basis as the tab labels)
        val todayStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).let { sdf ->
            sdf.timeZone = java.util.TimeZone.getDefault()
            sdf.format(java.util.Date())
        }
        return@withContext if (date == todayStr) {
            // Today: the ESS API (no date param) returns the live current-day schedule reliably.
            fetchScheduleEntriesFromEss(serviceId)
        } else {
            // Past / future: the ESS API stopped providing date-based data after March 2025.
            // Fetch the BBC website schedule HTML and extract the JSON-LD structured data instead.
            fetchScheduleViaHtml(serviceId, date)
        }
    }

    private suspend fun fetchScheduleEntriesFromEss(serviceId: String): List<ScheduleEntry> {
        return try {
            val url = "https://ess.api.bbci.co.uk/schedules?serviceId=$serviceId&mediatypes=audio"
            Log.d(TAG, "Fetching today's schedule from ESS API: $url")

            val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            connection.setRequestProperty("User-Agent", "AndroidAutoRadioPlayer/1.0")

            val responseCode = connection.responseCode
            if (responseCode != 200) {
                connection.disconnect()
                return emptyList()
            }

            val response = connection.inputStream.bufferedReader().readText()
            connection.disconnect()

            parseScheduleEntriesFromEssResponse(response)
        } catch (e: Exception) {
            Log.w(TAG, "Error fetching full schedule: ${e.message}")
            emptyList()
        }
    }

    private fun parseScheduleEntriesFromEssResponse(json: String): List<ScheduleEntry> {
        val entries = mutableListOf<ScheduleEntry>()
        try {
            val jsonObject = org.json.JSONObject(json)
            val items = jsonObject.optJSONArray("items") ?: return entries

            val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
            sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")

            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val publishedTime = item.optJSONObject("published_time") ?: continue

                val startStr = publishedTime.optString("start")
                val endStr = publishedTime.optString("end")

                if (startStr.isEmpty() || endStr.isEmpty()) continue

                try {
                    val start = sdf.parse(startStr)?.time ?: continue
                    val end = sdf.parse(endStr)?.time ?: continue

                    val brand = item.optJSONObject("brand")
                    val episode = item.optJSONObject("episode")

                    val brandTitle = brand?.optString("title")
                    val episodeTitle = episode?.optString("title")

                    val title = if (!brandTitle.isNullOrEmpty()) brandTitle else episodeTitle ?: continue
                    val epTitle = if (!brandTitle.isNullOrEmpty() && !episodeTitle.isNullOrEmpty()) episodeTitle else null

                    val imageObj = episode?.optJSONObject("image") ?: brand?.optJSONObject("image")
                    val imageTemplate = imageObj?.optString("template_url")
                    val imageUrl = if (!imageTemplate.isNullOrEmpty()) imageTemplate.replace("{recipe}", "320x320") else null

                    entries.add(ScheduleEntry(title = title, episodeTitle = epTitle, startTimeMs = start, endTimeMs = end, imageUrl = imageUrl))
                } catch (e: java.text.ParseException) {
                    Log.w(TAG, "Date parse error in schedule: ${e.message}")
                    continue
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error parsing ESS schedule response: ${e.message}")
        }
        return entries
    }
    
    private suspend fun fetchScheduleViaHtml(serviceId: String, date: String): List<ScheduleEntry> {
        val path = schedulePathFor(serviceId) ?: run {
            Log.w(TAG, "No BBC schedule path for serviceId=$serviceId")
            return emptyList()
        }
        val parts = date.split("-")
        if (parts.size != 3) return emptyList()
        val (year, month, day) = parts
        val url = "https://www.bbc.co.uk/$path/$year/$month/$day"
        Log.d(TAG, "Fetching schedule HTML: $url")
        return try {
            val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            // Mimic a browser so the BBC website serves the regular HTML
            connection.setRequestProperty("User-Agent",
                "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/120 Safari/537.36")
            connection.setRequestProperty("Accept",
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            val responseCode = connection.responseCode
            if (responseCode != 200) {
                Log.w(TAG, "BBC schedule page returned HTTP $responseCode for $url")
                connection.disconnect()
                return emptyList()
            }
            val html = connection.inputStream.bufferedReader(Charsets.UTF_8).readText()
            connection.disconnect()
            parseScheduleFromHtml(html)
        } catch (e: Exception) {
            Log.w(TAG, "Error fetching BBC schedule HTML for $serviceId/$date: ${e.message}")
            emptyList()
        }
    }

    /**
     * Parses schedule entries from the BBC website schedule HTML page.
     *
     * The BBC embeds programme data as JSON-LD in `<script type="application/ld+json">` blocks.
     * One of those blocks contains an `@graph` array where each entry represents a programme
     * broadcast with a `publication` object holding `startDate` (and possibly `endDate`).
     */
    private fun parseScheduleFromHtml(html: String): List<ScheduleEntry> {
        val entries = mutableListOf<ScheduleEntry>()
        try {
            // Extract all JSON-LD <script> blocks
            val jsonLdRegex = Regex(
                """<script[^>]+type=["']application/ld\+json["'][^>]*>(.*?)</script>""",
                setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE)
            )
            val jsonLdBlocks = jsonLdRegex.findAll(html).map { it.groupValues[1].trim() }

            // Find the block that contains a @graph array (schedule entries)
            var graphArray: org.json.JSONArray? = null
            for (block in jsonLdBlocks) {
                try {
                    val obj = org.json.JSONObject(block)
                    val graph = obj.optJSONArray("@graph")
                    if (graph != null && graph.length() > 0) {
                        graphArray = graph
                        break
                    }
                } catch (e: Exception) { continue }
            }

            val graph = graphArray ?: run {
                Log.w(TAG, "No @graph block found in BBC schedule HTML")
                return entries
            }

            data class Raw(val startMs: Long, val endMs: Long?, val title: String, val epTitle: String?)
            val rawList = mutableListOf<Raw>()

            for (i in 0 until graph.length()) {
                val item = try { graph.getJSONObject(i) } catch (e: Exception) { continue }
                val publication = item.optJSONObject("publication") ?: continue
                val startStr = publication.optString("startDate").takeIf { it.isNotEmpty() } ?: continue
                val endStr   = publication.optString("endDate").takeIf { it.isNotEmpty() }
                val startMs  = parseIso8601Date(startStr) ?: continue
                val endMs    = endStr?.let { parseIso8601Date(it) }

                val showTitle  = item.optJSONObject("partOfSeries")?.optString("name")?.takeIf { it.isNotEmpty() }
                val episodeName = item.optString("name").takeIf { it.isNotEmpty() }
                val title = showTitle ?: episodeName ?: continue
                val epTitle = if (showTitle != null && !episodeName.isNullOrEmpty() && episodeName != showTitle) episodeName else null

                rawList.add(Raw(startMs, endMs, title, epTitle))
            }

            rawList.sortBy { it.startMs }

            for (i in rawList.indices) {
                val raw = rawList[i]
                // Use the endDate from JSON-LD if present; otherwise use the next show's start time;
                // as a last resort extend by 2 hours.
                val endMs = raw.endMs
                    ?: rawList.getOrNull(i + 1)?.startMs
                    ?: (raw.startMs + 2 * 60 * 60 * 1000L)
                entries.add(ScheduleEntry(raw.title, raw.epTitle, raw.startMs, endMs, null))
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error parsing BBC schedule HTML: ${e.message}")
        }
        return entries
    }

    /**
     * Parses an ISO 8601 datetime string into milliseconds since epoch.
     * Handles UTC ("Z") suffix and "+HH:MM" / "-HH:MM" timezone offsets.
     * Works on all Android API levels (no dependency on the Java 7+ "X" pattern).
     *
     * Conversion formula: UTC = local_time − offset
     *   For +01:00 (UTC+1): UTC = local − 1 h  → offsetMs is positive, we subtract it.
     *   For −05:00 (UTC−5): UTC = local + 5 h  → offsetMs is negative, subtracting adds.
     */
    private fun parseIso8601Date(dateStr: String): Long? {
        try {
            var utcStr = dateStr
            var offsetMs = 0L

            when {
                utcStr.endsWith("Z") -> {
                    utcStr = utcStr.dropLast(1)
                }
                utcStr.length >= 6 && (utcStr[utcStr.length - 6] == '+' || utcStr[utcStr.length - 6] == '-') -> {
                    val suffix = utcStr.takeLast(6) // e.g. "+01:00"
                    val sign = if (suffix[0] == '+') 1L else -1L
                    val hh = suffix.substring(1, 3).toLongOrNull() ?: return null
                    val mm = suffix.substring(4, 6).toLongOrNull() ?: return null
                    // UTC = local − offset: positive offset → subtract, negative → add
                    offsetMs = sign * (hh * 60L + mm) * 60_000L
                    utcStr = utcStr.dropLast(6)
                }
            }

            // Drop fractional seconds if present (e.g. ".000")
            val dotIdx = utcStr.indexOf('.')
            if (dotIdx > 0) utcStr = utcStr.substring(0, dotIdx)

            val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US)
            sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
            val baseMs = sdf.parse(utcStr)?.time ?: return null
            return baseMs - offsetMs
        } catch (e: Exception) {
            Log.w(TAG, "Could not parse ISO 8601 date: $dateStr - ${e.message}")
            return null
        }
    }

    private suspend fun fetchShowFromEss(serviceId: String): CurrentShow {
        return try {
            // Add timestamp to prevent caching
            val url = "https://ess.api.bbci.co.uk/schedules?serviceId=$serviceId&t=${System.currentTimeMillis()}"
            Log.d(TAG, "Fetching from ESS API: $url")
            
            val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.setRequestProperty("User-Agent", "AndroidAutoRadioPlayer/1.0")
            
            val responseCode = connection.responseCode
            Log.d(TAG, "ESS Response code: $responseCode")
            
            if (responseCode != 200) {
                connection.disconnect()
                return CurrentShow("BBC Radio")
            }
            
            val response = connection.inputStream.bufferedReader().readText()
            connection.disconnect()
            
            val show = parseShowFromEssResponse(response)
            show ?: CurrentShow("BBC Radio")
        } catch (e: Exception) {
            Log.w(TAG, "Error fetching from ESS API: ${e.message}")
            CurrentShow("BBC Radio")
        }
    }
    
    private fun parseShowFromRmsResponse(json: String): CurrentShow? {
        try {
            val jsonObject = org.json.JSONObject(json)
            val dataArray = jsonObject.optJSONArray("data") ?: return null
            if (dataArray.length() == 0) return null
            
            val item = dataArray.getJSONObject(0)
            
            // Check 'now_playing' flag in 'offset' object
            // If 'now_playing' is false, it means the song has finished or is not currently on air
            val offsetObj = item.optJSONObject("offset")
            val isNowPlaying = offsetObj?.optBoolean("now_playing", true) ?: true
            
            if (!isNowPlaying) {
                Log.d(TAG, "Latest segment is not 'now_playing'. Ignoring.")
                return null
            }

            val titles = item.optJSONObject("titles") ?: return null
            
            val primary = titles.optString("primary")
            val secondary = titles.optString("secondary")
            val tertiary = titles.optString("tertiary")
            val rawImageUrl = item.optString("image_url")
            
            // Parse segment timing (RFC 2822 format)
            var segmentStartMs: Long? = null
            var segmentDurationMs: Long? = null
            val startStr = item.optString("start")
            val durationStr = item.optString("duration")
            if (startStr.isNotEmpty()) {
                try {
                    segmentStartMs = parseRfc2822Date(startStr)
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to parse segment start time: $startStr")
                }
            }
            if (durationStr.isNotEmpty()) {
                try {
                    segmentDurationMs = durationStr.toLong() * 1000L // BBC returns duration in seconds
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to parse segment duration: $durationStr")
                }
            }
            
            // Validate and unescape the URL
            var imageUrl: String? = null
            if (rawImageUrl.isNotEmpty()) {
                var unescapedUrl = rawImageUrl.replace("\\/", "/").replace("\\\\", "\\")
                
                // Replace BBC image recipe placeholder if present
                if (unescapedUrl.contains("{recipe}")) {
                    unescapedUrl = unescapedUrl.replace("{recipe}", "320x320")
                }
                
                // Only use URL if it looks valid and isn't a known placeholder pattern
                if (unescapedUrl.isNotEmpty() && 
                    unescapedUrl.startsWith("http") && 
                    !unescapedUrl.contains("default", ignoreCase = true) &&
                    !unescapedUrl.contains("p01tqv8z", ignoreCase = true)) {
                    imageUrl = unescapedUrl
                }
            }
            
            if (primary.isNotEmpty() || secondary.isNotEmpty()) {
                Log.d(TAG, "Found RMS: primary=$primary, secondary=$secondary, tertiary=$tertiary, start=$segmentStartMs, duration=$segmentDurationMs")
                return CurrentShow(
                    title = primary,
                    secondary = if (secondary.isNotEmpty()) secondary else null,
                    tertiary = if (tertiary.isNotEmpty()) tertiary else null,
                    imageUrl = imageUrl,
                    segmentStartMs = segmentStartMs,
                    segmentDurationMs = segmentDurationMs
                )
            }
            
            Log.w(TAG, "No primary or secondary title found in RMS response")
            return null
        } catch (e: Exception) {
            Log.w(TAG, "Error parsing RMS response: ${e.message}")
            return null
        }
    }
    
    private fun parseShowFromEssResponse(json: String): CurrentShow? {
        try {
            val jsonObject = org.json.JSONObject(json)
            val items = jsonObject.optJSONArray("items") ?: return null
            
            val now = System.currentTimeMillis()
            // Handle ISO 8601 with potential millis and Z
            // Examples: "2026-01-04T18:00:53.092Z", "2026-01-04T18:00:00.000Z"
            val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
            sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
            
            var currentShow: CurrentShow? = null
            var nextShow: CurrentShow? = null
            var nextShowStart: Long = Long.MAX_VALUE
            
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val publishedTime = item.optJSONObject("published_time") ?: continue
                
                val startStr = publishedTime.optString("start")
                val endStr = publishedTime.optString("end")
                
                if (startStr.isNotEmpty() && endStr.isNotEmpty()) {
                    try {
                        val start = sdf.parse(startStr)?.time ?: continue
                        val end = sdf.parse(endStr)?.time ?: continue
                        
                        val brand = item.optJSONObject("brand")
                        val episode = item.optJSONObject("episode")
                        
                        val brandTitle = brand?.optString("title")
                        val episodeTitle = episode?.optString("title")
                        
                        val title = if (!brandTitle.isNullOrEmpty()) brandTitle else episodeTitle ?: "BBC Radio"
                        val episodeTitleString = if (!brandTitle.isNullOrEmpty() && !episodeTitle.isNullOrEmpty()) episodeTitle else null
                        
                        // Extract image from episode or brand
                        val imageObj = episode?.optJSONObject("image") ?: brand?.optJSONObject("image")
                        val imageTemplate = imageObj?.optString("template_url")
                        var imageUrl: String? = null
                        if (!imageTemplate.isNullOrEmpty()) {
                            imageUrl = imageTemplate.replace("{recipe}", "640x640")
                        }
                        
                        if (now in start until end) {
                            Log.d(TAG, "Found current ESS show: $title (episode: $episodeTitleString), imageUrl=$imageUrl")
                            currentShow = CurrentShow(title = title, episodeTitle = episodeTitleString, imageUrl = imageUrl)
                        }
                        
                        // Track the next upcoming show
                        if (start > now && start < nextShowStart) {
                            nextShowStart = start
                            nextShow = CurrentShow(title = title, episodeTitle = episodeTitleString, imageUrl = imageUrl, nextShowStartTimeMs = start)
                        }
                    } catch (e: java.text.ParseException) {
                        Log.w(TAG, "Date parse error: ${e.message}")
                        continue
                    }
                }
            }
            
            // Return current show with next show info if available
            if (currentShow != null) {
                val result = currentShow.copy(nextShowTitle = nextShow?.title, nextShowStartTimeMs = nextShow?.nextShowStartTimeMs)
                Log.d(TAG, "Returning current show: ${result.title} with next show: ${result.nextShowTitle}")
                return result
            }
            
            // If no current show found but there's an upcoming show, use that
            if (nextShow != null) {
                Log.d(TAG, "No current show found, using next upcoming show: ${nextShow.title}")
                return nextShow
            }
            
            Log.w(TAG, "No current or upcoming show found in ESS schedule")
            return null
        } catch (e: Exception) {
            Log.w(TAG, "Error parsing ESS response: ${e.message}")
            return null
        }
    }
    
    private fun parseCacheControlMaxAge(cacheControl: String): Long {
        if (cacheControl.isEmpty()) return 30_000L // Default 30s
        val maxAgeRegex = """max-age\s*=\s*(\d+)""".toRegex()
        val match = maxAgeRegex.find(cacheControl)
        return if (match != null) {
            val seconds = match.groupValues[1].toLongOrNull() ?: 30L
            (seconds * 1000L).coerceAtLeast(5_000L) // Minimum 5s, maximum extracted value
        } else {
            30_000L
        }
    }

    private fun parseRfc2822Date(dateStr: String): Long {
        // BBC typically uses RFC 2822 format: "Fri, 05 Jan 2026 12:34:56 +0000"
        try {
            val sdf = java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss Z", java.util.Locale.US)
            return sdf.parse(dateStr)?.time ?: System.currentTimeMillis()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse RFC 2822 date: $dateStr - ${e.message}")
            return System.currentTimeMillis()
        }
    }
}
