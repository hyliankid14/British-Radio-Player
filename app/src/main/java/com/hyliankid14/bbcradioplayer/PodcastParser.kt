package com.hyliankid14.bbcradioplayer

import android.util.Log
import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.InputStream
import java.net.URL
import java.util.Locale

object OPMLParser {
    private const val TAG = "OPMLParser"
    private const val OUTLINE = "outline"
    private const val OPML = "opml"

    fun parseOPML(inputStream: InputStream): List<Podcast> {
        val podcasts = mutableListOf<Podcast>()
        val seenIds = mutableSetOf<String>()
        return try {
            val parser = Xml.newPullParser()
            parser.setInput(inputStream, null)
            var eventType = parser.eventType

            var parsedCount = 0
            while (eventType != XmlPullParser.END_DOCUMENT) {
                if (eventType == XmlPullParser.START_TAG && parser.name == OUTLINE) {
                    val podcast = parsePodcastOutline(parser)
                    if (podcast != null && seenIds.add(podcast.id)) {
                        podcasts.add(podcast)
                        parsedCount++
                    }
                }
                eventType = parser.next()
            }
            Log.d(TAG, "Parsed $parsedCount unique podcasts from OPML")
            if (podcasts.isEmpty()) {
                Log.w(TAG, "Parsed OPML but found zero podcasts; check feed structure or filters")
            }
            podcasts
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing OPML", e)
            emptyList()
        }
    }

    fun fetchAndParseOPML(url: String): List<Podcast> {
        return try {
            // BBC OPML works fine with HTTPS scheduling
            var redirectUrl = url.replace("http://", "https://")
            var redirects = 0
            while (redirects < 5) {
                val currentUrl = URL(redirectUrl)
                val connection = (currentUrl.openConnection() as java.net.HttpURLConnection).apply {
                    instanceFollowRedirects = false // handle manually to keep headers
                    connectTimeout = 15000
                    readTimeout = 15000
                    requestMethod = "GET"
                    setRequestProperty("User-Agent", "BBC Radio Player/1.0 (Android)")
                    setRequestProperty("Accept", "application/xml,text/xml,application/rss+xml,*/*")
                    setRequestProperty("Accept-Encoding", "gzip")
                    doInput = true
                }

                val code = connection.responseCode
                if (code == java.net.HttpURLConnection.HTTP_MOVED_PERM ||
                    code == java.net.HttpURLConnection.HTTP_MOVED_TEMP ||
                    code == java.net.HttpURLConnection.HTTP_SEE_OTHER ||
                    code == 307 || code == 308
                ) {
                    val location = connection.getHeaderField("Location") ?: break
                    redirectUrl = URL(currentUrl, location).toString()
                    // Ensure all redirects use HTTPS
                    redirectUrl = redirectUrl.replace("http://", "https://")
                    redirects++
                    continue
                }

                if (code != java.net.HttpURLConnection.HTTP_OK) {
                    Log.e(TAG, "HTTP $code while fetching OPML")
                    return emptyList()
                }

                val stream = if ("gzip".equals(connection.getHeaderField("Content-Encoding"), true)) {
                    java.util.zip.GZIPInputStream(connection.inputStream)
                } else {
                    connection.inputStream
                }

                stream.use { return parseOPML(it) }
            }

            Log.e(TAG, "Too many redirects while fetching OPML")
            emptyList()
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching OPML from $url", e)
            emptyList()
        }
    }

    private fun parsePodcastOutline(parser: XmlPullParser): Podcast? {
        val type = parser.getAttributeValue(null, "type") ?: ""
        val text = parser.getAttributeValue(null, "text") ?: ""
        val description = parser.getAttributeValue(null, "description") ?: ""
        val xmlUrl = parser.getAttributeValue(null, "xmlUrl") ?: ""
        val htmlUrl = parser.getAttributeValue(null, "htmlUrl") ?: ""
        val imageUrl = parser.getAttributeValue(null, "imageHref") ?: ""
        val keyName = parser.getAttributeValue(null, "keyname") ?: text
        val durationStr = parser.getAttributeValue(null, "typicalDurationMins") ?: "0"
        val genresStr = parser.getAttributeValue(null, "bbcgenres") ?: ""

        val duration = durationStr.toIntOrNull() ?: 0
        val genres = genresStr.split(",").map { it.trim() }.filter { it.isNotEmpty() }

        val isRssLike = type.isEmpty() || type.lowercase(Locale.US) == "rss"
        return if (xmlUrl.isNotEmpty() && isRssLike) {
            // Extract podcast ID from RSS URL to match FTS index format.
            // BBC RSS URLs follow pattern: https://podcasts.files.bbci.co.uk/{id}.rss
            // This ensures podcast IDs match between OPMLParser (allPodcasts) and
            // the GitHub Pages index (FTS) for proper enrichment.
            val rssUrl = xmlUrl.trim().replace("http://", "https://")
            val podcastId = extractPodcastIdFromRssUrl(rssUrl)
            
            Podcast(
                id = podcastId,
                title = text.trim(),
                description = description.trim(),
                rssUrl = rssUrl,
                htmlUrl = htmlUrl.trim().replace("http://", "https://"),
                imageUrl = imageUrl.trim().replace("http://", "https://"),
                genres = genres,
                typicalDurationMins = duration
            )
        } else {
            null
        }
    }

    /**
     * Extract BBC podcast ID from RSS URL.
     * Matches the pattern used by build_index.py: /([a-z0-9]+)\.rss$
     * e.g., "https://podcasts.files.bbci.co.uk/p02nq0gn.rss" -> "p02nq0gn"
     */
    private fun extractPodcastIdFromRssUrl(rssUrl: String): String {
        val regex = Regex("""/([a-z0-9]+)\.rss$""", RegexOption.IGNORE_CASE)
        val match = regex.find(rssUrl)
        return match?.groupValues?.getOrNull(1) ?: rssUrl.hashCode().toString()
    }
}

object RSSParser {
    private const val TAG = "RSSParser"
    private const val ITEM = "item"
    private const val TITLE = "title"
    private const val DESCRIPTION = "description"
    private const val ENCLOSURE = "enclosure"
    private const val PUB_DATE = "pubDate"
    private const val DURATION = "duration"
    private const val GUID = "guid"

    /**
     * Extract a BBC episode PID from a guid URL, matching the logic used by build_index.py.
     * BBC guid URLs follow the pattern: https://www.bbc.co.uk/programmes/p0abc123
     * Returns the last path segment (e.g. "p0abc123") if it looks like a BBC PID,
     * or the full guid text as a fallback.
     *
     * Uses the same regex as build_index.py (`/([a-z0-9]+)$`) intentionally: matching
     * that exact pattern is required so that IDs produced here align with IDs stored in
     * the FTS index, which is the only way the episode-lookup in playEpisode() can succeed.
     */
    internal fun extractEpisodeIdFromGuid(guid: String): String {
        if (guid.isBlank()) return ""
        val trimmed = guid.trim()
        val match = Regex("""/([a-z0-9]+)$""", RegexOption.IGNORE_CASE).find(trimmed)
        return match?.groupValues?.getOrNull(1) ?: trimmed
    }

    fun parseRSS(inputStream: InputStream, podcastId: String, startIndex: Int = 0, maxCount: Int = Int.MAX_VALUE): List<Episode> {
        val episodes = mutableListOf<Episode>()
        return try {
            val parser = Xml.newPullParser()
            parser.setInput(inputStream, null)
            var eventType = parser.eventType
            var currentTitle = ""
            var currentDescription = ""
            var currentAudioUrl = ""
            var currentPubDate = ""
            var currentDuration = 0
            var currentGuid = ""
            var itemIndex = -1

            while (eventType != XmlPullParser.END_DOCUMENT) {
                when (eventType) {
                    XmlPullParser.START_TAG -> {
                        when (parser.name) {
                            ITEM -> {
                                currentTitle = ""
                                currentDescription = ""
                                currentAudioUrl = ""
                                currentPubDate = ""
                                currentDuration = 0
                                currentGuid = ""
                                itemIndex++
                            }
                            TITLE -> {
                                if (parser.next() == XmlPullParser.TEXT) {
                                    currentTitle = parser.text
                                }
                            }
                            DESCRIPTION -> {
                                // Capture full description text (may contain HTML/CDATA). Previously truncated to 200 chars.
                                if (parser.next() == XmlPullParser.TEXT) {
                                    currentDescription = parser.text
                                }
                            }
                            // Some feeds use the content:encoded element for full HTML descriptions
                            "encoded" -> {
                                if (parser.next() == XmlPullParser.TEXT) {
                                    // Prefer content:encoded when available as it often contains full HTML
                                    currentDescription = parser.text
                                }
                            }
                            ENCLOSURE -> {
                                currentAudioUrl = parser.getAttributeValue(null, "url") ?: ""
                            }
                            PUB_DATE -> {
                                if (parser.next() == XmlPullParser.TEXT) {
                                    currentPubDate = parser.text
                                }
                            }
                            DURATION -> {
                                if (parser.next() == XmlPullParser.TEXT) {
                                    currentDuration = parseDuration(parser.text)
                                }
                            }
                            GUID -> {
                                if (parser.next() == XmlPullParser.TEXT) {
                                    currentGuid = parser.text
                                }
                            }
                        }
                    }
                    XmlPullParser.END_TAG -> {
                        if (parser.name == ITEM && currentAudioUrl.isNotEmpty()) {
                            // Only add episodes within the requested window [startIndex, startIndex+maxCount)
                            if (itemIndex >= startIndex && episodes.size < maxCount) {
                                // Use the BBC PID extracted from the guid URL so episode IDs match
                                // the FTS index (built by build_index.py using the same guid logic).
                                // Fall back to the audio URL hash only when no guid is available;
                                // this is deterministic (same URL always produces the same hash) so
                                // it won't break episode identity across multiple parses.
                                val episodeId = extractEpisodeIdFromGuid(currentGuid)
                                    .takeIf { it.isNotBlank() }
                                    ?: currentAudioUrl.trim().hashCode().toString()
                                val episode = Episode(
                                    id = episodeId,
                                    title = currentTitle.trim(),
                                    description = currentDescription.trim(),
                                    audioUrl = currentAudioUrl.trim(),
                                    imageUrl = "",
                                    pubDate = currentPubDate.trim(),
                                    durationMins = currentDuration,
                                    podcastId = podcastId
                                )
                                episodes.add(episode)
                            }
                        }
                    }
                }
                eventType = parser.next()
            }
            episodes
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing RSS", e)
            emptyList()
        }
    }

    fun fetchAndParseRSS(url: String, podcastId: String): List<Episode> {
        return fetchAndParseRSS(url, podcastId, 0, Int.MAX_VALUE)
    }

    fun fetchAndParseRSS(url: String, podcastId: String, startIndex: Int, maxCount: Int): List<Episode> {
        return try {
            // BBC RSS feeds work fine with HTTPS
            val secureUrl = url.replace("http://", "https://")
            val connection = (URL(secureUrl).openConnection() as java.net.HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 15000
                readTimeout = 15000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "BBC Radio Player/1.0 (Android)")
            }
            
            val responseCode = connection.responseCode
            if (responseCode != 200) {
                Log.w(TAG, "HTTP $responseCode while fetching RSS from $secureUrl")
                connection.disconnect()
                return emptyList()
            }
            
            connection.inputStream.use { parseRSS(it, podcastId, startIndex, maxCount) }
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching RSS from $url", e)
            emptyList()
        }
    }

    fun fetchLatestPubDateEpoch(url: String): Long? {
        return try {
            val connection = (URL(url).openConnection() as java.net.HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 10000
                readTimeout = 10000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "BBC Radio Player/1.0 (Android)")
            }
            val code = connection.responseCode
            if (code != java.net.HttpURLConnection.HTTP_OK) {
                connection.disconnect()
                return null
            }
            val epoch = connection.inputStream.use { parseLatestPubDate(it) }
            connection.disconnect()
            epoch
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching latest pubDate from $url", e)
            null
        }
    }

    private fun parseLatestPubDate(inputStream: InputStream): Long? {
        return try {
            val parser = Xml.newPullParser()
            parser.setInput(inputStream, null)
            var eventType = parser.eventType
            var inItem = false
            var pubDate: String? = null
            var latestEpoch: Long? = null
            while (eventType != XmlPullParser.END_DOCUMENT) {
                when (eventType) {
                    XmlPullParser.START_TAG -> {
                        when (parser.name) {
                            ITEM -> {
                                inItem = true
                                pubDate = null
                            }
                            PUB_DATE -> if (inItem && parser.next() == XmlPullParser.TEXT) {
                                pubDate = parser.text
                            }
                        }
                    }
                    XmlPullParser.END_TAG -> {
                        if (parser.name == ITEM) {
                            pubDate?.let {
                                val epoch = parseRfc2822Date(it)
                                if (epoch != null) {
                                    latestEpoch = if (latestEpoch == null) epoch else maxOf(latestEpoch!!, epoch)
                                }
                            }
                            inItem = false
                        }
                    }
                }
                eventType = parser.next()
            }
            latestEpoch
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing latest pubDate", e)
            null
        }
    }

    private fun parseRfc2822Date(s: String): Long? {
        val normalized = s.trim().replace(Regex("\\s+"), " ")
        val patterns = listOf(
            "EEE, dd MMM yyyy HH:mm:ss Z",
            "EEE, dd MMM yyyy HH:mm:ss z",
            "EEE, dd MMM yyyy HH:mm Z",
            "EEE, dd MMM yyyy HH:mm z",
            "dd MMM yyyy HH:mm:ss Z",
            "dd MMM yyyy HH:mm:ss z",
            "EEE, dd MMM yyyy",
            "dd MMM yyyy"
        )

        for (pattern in patterns) {
            try {
                val fmt = java.text.SimpleDateFormat(pattern, java.util.Locale.US)
                fmt.isLenient = false
                val parsed = fmt.parse(normalized)?.time
                if (parsed != null) return parsed
            } catch (_: Exception) {
            }
        }
        return null
    }

    fun parseDuration(durationStr: String): Int {
        return try {
            when {
                durationStr.toIntOrNull() != null -> durationStr.toInt() / 60
                durationStr.contains(":") -> {
                    val parts = durationStr.split(":")
                    when (parts.size) {
                        2 -> parts[0].toInt() // MM:SS -> minutes
                        3 -> parts[0].toInt() * 60 + parts[1].toInt() // HH:MM:SS
                        else -> 0
                    }
                }
                else -> 0
            }
        } catch (e: Exception) {
            0
        }
    }
}
