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
        return@withContext fetchScheduleEntriesFromEss(serviceId, null)
    }

    suspend fun fetchScheduleForDate(stationId: String, date: String): List<ScheduleEntry> = withContext(Dispatchers.IO) {
        val serviceId = serviceIdMap[stationId] ?: return@withContext emptyList()
        return@withContext fetchScheduleEntriesFromEss(serviceId, date)
    }

    private suspend fun fetchScheduleEntriesFromEss(serviceId: String, date: String?): List<ScheduleEntry> {
        return try {
            val url = if (date != null) {
                "https://ess.api.bbci.co.uk/schedules?serviceId=$serviceId&mediatypes=audio&date=$date"
            } else {
                "https://ess.api.bbci.co.uk/schedules?serviceId=$serviceId&mediatypes=audio"
            }
            Log.d(TAG, "Fetching full schedule from ESS API: $url")

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
