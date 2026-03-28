package com.hyliankid14.bbcradioplayer.wear.data

import android.content.Context
import android.util.Xml
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.xmlpull.v1.XmlPullParser
import java.io.StringReader
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.zip.GZIPInputStream

private const val OPML_URL = "https://www.bbc.co.uk/radio/opml/bbc_podcast_opml.xml"

class PodcastRepository(context: Context) {
    private val cacheStore = PodcastCacheStore(context.applicationContext)

    fun getCachedPodcasts(): List<PodcastSummary> = cacheStore.getCachedPodcasts()

    fun shouldRefreshPodcasts(): Boolean = !cacheStore.isPodcastCacheFresh(PODCAST_CACHE_MAX_AGE_MS)

    fun getCachedEpisodes(podcastId: String): List<EpisodeSummary> = cacheStore.getCachedEpisodes(podcastId)

    fun getCachedPodcastUpdatedAtMap(): Map<String, Long> = cacheStore.getPodcastUpdatedAtMap()

    fun shouldRefreshEpisodes(podcastId: String): Boolean = !cacheStore.isEpisodeCacheFresh(podcastId, EPISODE_CACHE_MAX_AGE_MS)

    suspend fun fetchPodcastsForSubscriptions(subscribedIds: Set<String>, limit: Int = 2000): List<PodcastSummary> = withContext(Dispatchers.IO) {
        if (subscribedIds.isEmpty()) {
            cacheStore.savePodcasts(emptyList())
            return@withContext emptyList()
        }

        val targetIds = subscribedIds.map { it.trim() }.filter { it.isNotBlank() }.toSet()
        val cachedPodcasts = cacheStore.getCachedPodcasts()
        val cachedById = cachedPodcasts.associateBy { it.id }

        if (cacheStore.isPodcastCacheFresh(PODCAST_CACHE_MAX_AGE_MS)) {
            val allSubscribedKnownInCache = targetIds.all { it in cachedById }
            if (allSubscribedKnownInCache) {
                return@withContext targetIds.mapNotNull { cachedById[it] }
            }
        }

        val parser = fetchXmlPullParser(OPML_URL) ?: return@withContext cacheStore.getCachedPodcasts().filter { it.id in targetIds }
        val podcasts = mutableListOf<PodcastSummary>()
        val seen = mutableSetOf<String>()

        var eventType = parser.eventType
        while (eventType != XmlPullParser.END_DOCUMENT && podcasts.size < limit && seen.size < targetIds.size) {
            if (eventType == XmlPullParser.START_TAG && parser.name.equals("outline", true)) {
                val rssUrl = (parser.getAttributeValue(null, "xmlUrl") ?: "").trim().replace("http://", "https://")
                if (rssUrl.isNotBlank()) {
                    val id = extractPodcastIdFromRssUrl(rssUrl)
                    if (id in targetIds && seen.add(id)) {
                        podcasts += PodcastSummary(
                            id = id,
                            title = (parser.getAttributeValue(null, "text") ?: "Untitled podcast").trim(),
                            description = (parser.getAttributeValue(null, "description") ?: "").trim(),
                            rssUrl = rssUrl,
                            imageUrl = (parser.getAttributeValue(null, "imageHref") ?: "").trim().replace("http://", "https://")
                        )
                    }
                }
            }
            eventType = parser.next()
        }

        val missing = targetIds - seen
        if (missing.isNotEmpty()) {
            missing.forEach { missingId ->
                cachedById[missingId]?.let { podcasts += it }
            }
        }

        if (podcasts.isNotEmpty()) {
            cacheStore.savePodcasts(podcasts)
            podcasts
        } else {
            cacheStore.getCachedPodcasts()
        }
    }

    suspend fun fetchEpisodes(podcast: PodcastSummary, limit: Int = 12): List<EpisodeSummary> = withContext(Dispatchers.IO) {
        val parser = fetchXmlPullParser(podcast.rssUrl) ?: return@withContext cacheStore.getCachedEpisodes(podcast.id)
        val episodes = mutableListOf<EpisodeSummary>()

        var eventType = parser.eventType
        var inItem = false
        var title = ""
        var description = ""
        var pubDate = ""
        var audioUrl = ""
        var guid = ""

        while (eventType != XmlPullParser.END_DOCUMENT && episodes.size < limit) {
            when (eventType) {
                XmlPullParser.START_TAG -> {
                    val tag = parser.name.orEmpty().lowercase(Locale.US)
                    when (tag) {
                        "item" -> {
                            inItem = true
                            title = ""
                            description = ""
                            pubDate = ""
                            audioUrl = ""
                            guid = ""
                        }
                        "title" -> {
                            if (inItem && parser.next() == XmlPullParser.TEXT) {
                                title = parser.text.orEmpty().trim()
                            }
                        }
                        "description", "encoded" -> {
                            if (inItem && parser.next() == XmlPullParser.TEXT) {
                                description = parser.text.orEmpty().trim()
                            }
                        }
                        "pubdate", "updated", "published" -> {
                            if (inItem && pubDate.isBlank() && parser.next() == XmlPullParser.TEXT) {
                                pubDate = parser.text.orEmpty().trim()
                            }
                        }
                        "guid" -> {
                            if (inItem && parser.next() == XmlPullParser.TEXT) {
                                guid = parser.text.orEmpty().trim()
                            }
                        }
                        "enclosure" -> {
                            if (inItem) {
                                val urlAttr = parser.getAttributeValue(null, "url").orEmpty().trim()
                                val type = parser.getAttributeValue(null, "type").orEmpty().lowercase(Locale.US)
                                if (urlAttr.isNotBlank() && (type.isBlank() || type.startsWith("audio/"))) {
                                    audioUrl = urlAttr
                                }
                            }
                        }
                    }
                }

                XmlPullParser.END_TAG -> {
                    if (parser.name.equals("item", true) && audioUrl.isNotBlank()) {
                        val fallbackId = audioUrl.hashCode().toString()
                        episodes += EpisodeSummary(
                            id = extractEpisodeIdFromGuid(guid).ifBlank { fallbackId },
                            podcastId = podcast.id,
                            podcastTitle = podcast.title,
                            title = if (title.isBlank()) "Untitled episode" else title,
                            description = description,
                            audioUrl = audioUrl,
                            pubDate = pubDate
                        )
                        inItem = false
                    }
                }
            }
            eventType = parser.next()
        }

        if (episodes.isNotEmpty()) {
            cacheStore.saveEpisodes(podcast.id, episodes)
            cacheStore.mergePodcastUpdatedAtMap(
                mapOfNotNull(podcast.id to parseDateToEpochMs(episodes.firstOrNull()?.pubDate.orEmpty()))
            )
            episodes
        } else {
            cacheStore.getCachedEpisodes(podcast.id)
        }
    }

    suspend fun refreshPodcastUpdatedAtHints(podcasts: List<PodcastSummary>) = withContext(Dispatchers.IO) {
        val updatedHints = mutableMapOf<String, Long>()
        podcasts.forEach { podcast ->
            val updatedAt = fetchLatestEpisodeUpdatedAt(podcast.rssUrl)
            if (updatedAt > 0L) {
                updatedHints[podcast.id] = updatedAt
            }
        }
        cacheStore.mergePodcastUpdatedAtMap(updatedHints)
        cacheStore.getPodcastUpdatedAtMap()
    }

    private fun fetchXmlPullParser(initialUrl: String): XmlPullParser? {
        var url = initialUrl
        repeat(5) {
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 8000
                readTimeout = 8000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "BBC Radio Player Wear/1.0")
                setRequestProperty("Accept", "application/xml,text/xml,application/rss+xml,*/*")
                setRequestProperty("Accept-Encoding", "gzip")
            }

            val code = connection.responseCode
            if (code in listOf(
                    HttpURLConnection.HTTP_MOVED_PERM,
                    HttpURLConnection.HTTP_MOVED_TEMP,
                    HttpURLConnection.HTTP_SEE_OTHER,
                    307,
                    308
                )
            ) {
                val location = connection.getHeaderField("Location") ?: return null
                url = URL(URL(url), location).toString().replace("http://", "https://")
                return@repeat
            }

            if (code != HttpURLConnection.HTTP_OK) {
                return null
            }

            val input = if ("gzip".equals(connection.getHeaderField("Content-Encoding"), true)) {
                GZIPInputStream(connection.inputStream)
            } else {
                connection.inputStream
            }

            val xmlContent = input.use {
                it.bufferedReader().use { reader -> reader.readText() }
            }

            if (xmlContent.isBlank()) {
                return null
            }

            runCatching {
                val parser = Xml.newPullParser()
                parser.setInput(StringReader(xmlContent))
                return parser
            }.getOrElse {
                return null
            }
        }

        return null
    }

    private fun extractPodcastIdFromRssUrl(rssUrl: String): String {
        // Note: in a triple-quoted raw string, use a single \ for a regex literal dot (\.) 
        val match = Regex("""/([a-z0-9]+)\.rss$""", RegexOption.IGNORE_CASE).find(rssUrl)
        if (match != null) {
            return match.groupValues[1]
        }

        val uri = runCatching { java.net.URI(rssUrl) }.getOrNull()
        val pathSegments = uri?.path
            ?.split('/')
            ?.map { it.trim() }
            ?.filter { it.isNotBlank() }
            ?: emptyList()
        val candidate = pathSegments.lastOrNull()
            ?.removeSuffix(".rss")
            ?.replace(Regex("[^a-zA-Z0-9_-]"), "")
            ?.lowercase(Locale.US)
            .orEmpty()

        if (candidate.isNotBlank()) {
            return candidate
        }

        return "podcast_${kotlin.math.abs(rssUrl.hashCode())}"
    }

    private fun extractEpisodeIdFromGuid(guid: String): String {
        if (guid.isBlank()) return ""
        val match = Regex("""[/:]([a-z0-9]+)$""", RegexOption.IGNORE_CASE).find(guid.trim())
        return match?.groupValues?.getOrNull(1) ?: guid
    }

    private fun fetchLatestEpisodeUpdatedAt(rssUrl: String): Long {
        val parser = fetchXmlPullParser(rssUrl) ?: return 0L
        var eventType = parser.eventType
        var inItem = false
        while (eventType != XmlPullParser.END_DOCUMENT) {
            when (eventType) {
                XmlPullParser.START_TAG -> {
                    val tag = parser.name.orEmpty().lowercase(Locale.US)
                    when (tag) {
                        "item" -> inItem = true
                        "pubdate", "updated", "published" -> {
                            if (inItem && parser.next() == XmlPullParser.TEXT) {
                                val rawDate = parser.text.orEmpty().trim()
                                val parsed = parseDateToEpochMs(rawDate)
                                if (parsed > 0L) {
                                    return parsed
                                }
                            }
                        }
                    }
                }
                XmlPullParser.END_TAG -> {
                    if (parser.name.equals("item", true)) {
                        return 0L
                    }
                }
            }
            eventType = parser.next()
        }
        return 0L
    }

    private fun parseDateToEpochMs(rawDate: String): Long {
        if (rawDate.isBlank()) return 0L
        return runCatching {
            ZonedDateTime.parse(rawDate, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
        }.recoverCatching {
            Instant.parse(rawDate).toEpochMilli()
        }.getOrDefault(0L)
    }

    private fun <K, V> mapOfNotNull(vararg pairs: Pair<K, V?>): Map<K, V> {
        val result = LinkedHashMap<K, V>()
        pairs.forEach { (key, value) ->
            if (value != null) {
                result[key] = value
            }
        }
        return result
    }

    companion object {
        private const val PODCAST_CACHE_MAX_AGE_MS = 6L * 60L * 60L * 1000L
        private const val EPISODE_CACHE_MAX_AGE_MS = 2L * 60L * 60L * 1000L
    }
}
