@file:Suppress("DEPRECATION")
package com.hyliankid14.bbcradioplayer

import android.app.ProgressDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import java.net.URL
import java.net.URLEncoder
import java.util.Locale

/**
 * Utility for sharing podcasts and episodes with proper fallback support.
 * 
 * Sharing strategy:
 * 1. Generate deep links for app users (app://podcast/{id} or app://episode/{id})
 * 2. Generate web fallback URLs with short codes
 * 3. Use Android's share sheet with rich text and metadata
 */
object ShareUtil {

    // GitHub Pages URL for web player
    private const val WEB_BASE_URL = "https://hyliankid14.github.io/British-Radio-Player"
    private const val APP_SCHEME = "app"
    private const val SHORT_URL_API = "https://is.gd/create.php"
    
    /**
     * Share a podcast with others.
     * Non-app users will be directed to the web player.
     *
     * Uses a compact hash-route URL so the link is short and works reliably with
     * URL shorteners. The web player resolves title/artwork/episodes from the
     * podcast RSS feed.
     */
    fun sharePodcast(context: Context, podcast: Podcast) {
        val shareTitle = podcast.title
        val handler = Handler(Looper.getMainLooper())
        val cleanDesc = stripHtmlTags(podcast.description)

        // Show progress dialog
        @Suppress("DEPRECATION")
        val progressDialog = ProgressDialog(context).apply {
            setMessage("Generating sharing link...")
            setCancelable(false)
            show()
        }

        // Shorten URL on background thread
        Thread {
            try {
                val summaryDesc = summarizeTextWithAI(cleanDesc)

                // Compact route with title for immediate rendering; the web player
                // fetches artwork and episodes from the RSS feed on arrival.
                val encodedTitle = Uri.encode(podcast.title)
                val webUrl = "$WEB_BASE_URL/#/p/${Uri.encode(podcast.id)}?title=$encodedTitle"

                val shortUrl = shortenUrl(webUrl)
                val shareMessage = buildString {
                    append("Check out \"${podcast.title}\"")
                    if (summaryDesc.isNotEmpty()) {
                        append(" - $summaryDesc")
                    }
                    append("\n\n")
                    append(shortUrl)
                    append("\n\nIf you have the British Radio Player app installed, you can open it directly.")
                }

                // Post back to main thread to start activity
                handler.post {
                    progressDialog.dismiss()
                    val shareIntent = Intent().apply {
                        action = Intent.ACTION_SEND
                        putExtra(Intent.EXTRA_SUBJECT, shareTitle)
                        putExtra(Intent.EXTRA_TEXT, shareMessage)
                        type = "text/plain"
                    }
                    context.startActivity(Intent.createChooser(shareIntent, "Share podcast"))
                }
            } catch (e: Exception) {
                android.util.Log.w("ShareUtil", "Failed to share podcast: ${e.message}")
                handler.post { progressDialog.dismiss() }
            }
        }.start()
    }

    /**
     * Share an episode with others.
     * Non-app users will be directed to the web player.
     *
     * Uses a compact hash-route URL (podcast ID + episode ID). The web player
     * resolves the episode audio URL from the RSS feed, avoiding broken direct
     * audio links and oversized share URLs.
     */
    fun shareEpisode(context: Context, episode: Episode, podcastTitle: String = "") {
        var shareEpisode = episode
        var sharePodcastTitle = podcastTitle
        var cleanDesc = stripHtmlTags(episode.description)
        val shareTitle = episode.title
        val handler = Handler(Looper.getMainLooper())

        // Show progress dialog
        @Suppress("DEPRECATION")
        val progressDialog = ProgressDialog(context).apply {
            setMessage("Generating sharing link...")
            setCancelable(false)
            show()
        }

        // Shorten URL on background thread
        Thread {
            try {
                val summaryDesc = summarizeTextWithAI(cleanDesc)

                // Compact route: podcastId/episodeId plus title for immediate display.
                // The web player constructs the audio URL from the episode ID and
                // fetches descriptions/artwork from the RSS feed on arrival.
                val encodedPodcastId = Uri.encode(shareEpisode.podcastId)
                val encodedEpisodeId = Uri.encode(shareEpisode.id)
                val encodedTitle = Uri.encode(shareEpisode.title)
                val webUrl = "$WEB_BASE_URL/#/e/$encodedPodcastId/$encodedEpisodeId?title=$encodedTitle"

                val shortUrl = shortenUrl(webUrl)
                val shareMessage = buildString {
                    append("Listen to \"${shareEpisode.title}\"")
                    if (sharePodcastTitle.isNotEmpty()) {
                        append(" from $sharePodcastTitle")
                    }
                    if (summaryDesc.isNotEmpty()) {
                        append(" - $summaryDesc")
                    }
                    append("\n\n")
                    append(shortUrl)
                    append("\n\nIf you have the British Radio Player app installed, you can open it directly.")
                }

                // Post back to main thread to start activity
                handler.post {
                    progressDialog.dismiss()
                    val shareIntent = Intent().apply {
                        action = Intent.ACTION_SEND
                        putExtra(Intent.EXTRA_SUBJECT, shareTitle)
                        putExtra(Intent.EXTRA_TEXT, shareMessage)
                        type = "text/plain"
                    }
                    context.startActivity(Intent.createChooser(shareIntent, "Share episode"))
                }
            } catch (e: Exception) {
                android.util.Log.w("ShareUtil", "Failed to share episode: ${e.message}")
                handler.post { progressDialog.dismiss() }
            }
        }.start()
    }
    
    /**
     * Generate a podcast share URL (for use in custom sharing scenarios)
     */
    fun getPodcastShareUrl(podcastId: String): String {
        return "$WEB_BASE_URL/#/p/$podcastId"
    }
    
    /**
     * Generate an episode share URL (for use in custom sharing scenarios)
     */
    fun getEpisodeShareUrl(episodeId: String): String {
        return "$WEB_BASE_URL/#/e/$episodeId"
    }
    
    /**
     * Handle incoming deep links from share URLs.
     * Call this from MainActivity's onCreate when processing Intent data.
     *
     * Returns the content type and ID, or null if not a share link.
     */
    fun parseShareLink(intent: Intent): Pair<ShareContentType, String>? {
        val uri = intent.data ?: return null

        return when {
            uri.scheme == APP_SCHEME && uri.host == "podcast" -> {
                val podcastId = uri.pathSegments.getOrNull(0) ?: return null
                ShareContentType.PODCAST to podcastId
            }
            uri.scheme == APP_SCHEME && uri.host == "episode" -> {
                val episodeId = uri.pathSegments.getOrNull(0) ?: return null
                ShareContentType.EPISODE to episodeId
            }
            uri.scheme == "https" && uri.host == "hyliankid14.github.io" -> {
                // GitHub Pages URLs use hash-based routing: /British-Radio-Player/#/p/{id}
                // or /British-Radio-Player/#/e/{podcastId}/{episodeId}. The fragment is the
                // authoritative route; pathSegments only contains "British-Radio-Player".
                // Also accept legacy /BBC-Radio-Player paths for backward compatibility.
                val path = uri.path?.trim('/') ?: ""
                if (path != "British-Radio-Player" && path != "BBC-Radio-Player") {
                    return null
                }
                val fragment = uri.fragment ?: return null
                val fragmentPath = fragment.substringBefore('?')
                val segments = fragmentPath.split('/').filter { it.isNotEmpty() }
                return when (segments.getOrNull(0)) {
                    "p" -> {
                        val podcastId = segments.getOrNull(1) ?: return null
                        ShareContentType.PODCAST to podcastId
                    }
                    "e" -> {
                        // Episode route: #/e/{podcastId}/{episodeId}. Return the episode ID
                        // as the share target; callers can use the podcast ID from query params
                        // if they need it.
                        val episodeId = segments.getOrNull(2) ?: return null
                        ShareContentType.EPISODE to episodeId
                    }
                    else -> null
                }
            }
            else -> null
        }
    }
    
    /**
     * Strip HTML tags from a string
     */
    private fun stripHtmlTags(html: String): String {
        return html.replace(Regex("<[^>]*>"), "")
            .replace(Regex("&lt;"), "<")
            .replace(Regex("&gt;"), ">")
            .replace(Regex("&amp;"), "&")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    /**
     * Summarise text on-device only for privacy and offline resilience.
     */
    private fun summarizeTextWithAI(text: String): String {
        if (text.isBlank()) return ""

        val plain = stripHtmlTags(text)
        if (plain.isBlank()) return ""

        return summarizeTextLocally(plain)
    }

    private fun summarizeTextLocally(text: String): String {
        val cleanText = text.take(2000).trim()
        if (cleanText.isBlank()) return ""

        val sentenceRegex = Regex("(?<=[.!?])\\s+(?=[A-Z])|(?<=[.!?])$")
        var sentences = cleanText.split(sentenceRegex)
            .map { it.trim() }
            .filter { it.length > 10 }

        if (sentences.isEmpty() || (sentences.size == 1 && sentences.first() == cleanText)) {
            val clauseParts = cleanText.split(Regex("[,;:]+"))
                .map { it.trim().trim(',', ';', ':', '-', ' ') }
                .filter { it.length > 10 }
            if (clauseParts.size > 1) {
                return clauseParts.take(2).joinToString(", ").let {
                    if (it.endsWith('.')) it else "$it."
                }
            }
            sentences = cleanText.split(Regex("[.!?]+"))
                .map { it.trim() }
                .filter { it.length > 10 }
        }

        if (sentences.isEmpty()) return limitToWords(cleanText, 30)
        if (sentences.size == 1) return limitToWords(sentences[0], 30).trimEnd('.') + "."

        val stopWords = setOf(
            "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from",
            "as", "is", "was", "are", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will",
            "would", "should", "could", "may", "might", "must", "can", "this", "that", "these", "those", "we", "they"
        )

        val wordFreq = mutableMapOf<String, Int>()
        Regex("\\b\\w+\\b").findAll(cleanText.lowercase(Locale.getDefault())).forEach { m ->
            val w = m.value
            if (w.length > 3 && w !in stopWords) wordFreq[w] = (wordFreq[w] ?: 0) + 1
        }

        val scored = sentences.mapIndexed { idx, s ->
            val words = Regex("\\b\\w+\\b").findAll(s.lowercase(Locale.getDefault())).map { it.value }.toList()
            val important = words.filter { it.length > 3 && it !in stopWords }
            val freqScore = important.sumOf { wordFreq[it] ?: 0 }
            val positionBonus = if (idx == 0) 1.3 else 1.0
            Triple(s, (freqScore.toDouble() / (important.size.coerceAtLeast(1))) * positionBonus, idx)
        }.sortedByDescending { it.second }

        val best = scored.take(2).sortedBy { it.third }.joinToString(". ") { it.first.trim().trimEnd('.', '!', '?') }
        return if (best.isBlank()) limitToWords(cleanText, 30) else best + "."
    }

    private fun limitToWords(text: String, maxWords: Int): String {
        val words = text.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.size <= maxWords) return words.joinToString(" ")
        return words.take(maxWords).joinToString(" ") + "..."
    }
    
    /**
     * Shorten a URL using the is.gd service.
     *
     * Tries the simple (plain-text) API first as it is the most reliable, then
     * falls back to the JSON API. Returns the original URL on failure so sharing
     * never breaks.
     */
    private fun shortenUrl(longUrl: String): String {
        return try {
            android.util.Log.d("ShareUtil", "Shortening URL (length: ${longUrl.length}): ${longUrl.take(200)}...")
            val encodedUrl = URLEncoder.encode(longUrl, "UTF-8")

            // Try the simple/plain-text endpoint first.
            val simpleResult = callIsGd("$SHORT_URL_API?format=simple&logstats=0&url=$encodedUrl")
            if (simpleResult.startsWith("http://") || simpleResult.startsWith("https://")) {
                android.util.Log.d("ShareUtil", "Successfully shortened to: $simpleResult")
                return simpleResult
            }
            if (simpleResult.isNotEmpty()) {
                android.util.Log.w("ShareUtil", "is.gd simple error: $simpleResult")
            }

            // Fall back to JSON.
            val jsonResponse = callIsGd("$SHORT_URL_API?format=json&logstats=0&url=$encodedUrl")
            if (jsonResponse.contains("shorturl")) {
                val shortUrl = jsonResponse.substringAfter("\"shorturl\"")
                    .substringAfter("\"")
                    .substringBefore("\"")
                    .replace("\\/", "/")
                    .trim()
                if (shortUrl.startsWith("http://") || shortUrl.startsWith("https://")) {
                    android.util.Log.d("ShareUtil", "Successfully shortened to: $shortUrl")
                    return shortUrl
                }
            }
            if (jsonResponse.contains("errormessage")) {
                val errorMsg = jsonResponse.substringAfter("\"errormessage\"")
                    .substringAfter("\"")
                    .substringBefore("\"")
                android.util.Log.w("ShareUtil", "is.gd error: $errorMsg")
            } else {
                android.util.Log.w("ShareUtil", "is.gd returned unexpected response: $jsonResponse")
            }

            longUrl
        } catch (e: Exception) {
            android.util.Log.w("ShareUtil", "Failed to shorten URL: ${e.message}")
            longUrl
        }
    }

    private fun callIsGd(urlStr: String): String {
        val connection = (URL(urlStr).openConnection() as java.net.HttpURLConnection).apply {
            connectTimeout = 5000
            readTimeout = 5000
            requestMethod = "GET"
            setRequestProperty("User-Agent", "British Radio Player/1.0")
            instanceFollowRedirects = true
        }

        return try {
            val responseCode = connection.responseCode
            val response = if (responseCode == 200) {
                connection.inputStream.bufferedReader().use { it.readText() }
            } else {
                connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            }
            response.trim()
        } finally {
            connection.disconnect()
        }
    }
    
    enum class ShareContentType {
        PODCAST,
        EPISODE
    }
}
