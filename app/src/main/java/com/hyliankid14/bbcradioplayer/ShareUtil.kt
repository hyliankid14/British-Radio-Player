@file:Suppress("DEPRECATION")
package com.hyliankid14.bbcradioplayer

import android.app.ProgressDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
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
    private const val DEFAULT_CLOUD_FUNCTION_URL = "https://podcast-search-tcy4hnuh2q-nw.a.run.app"
    private const val APP_SCHEME = "app"
    private const val SHORT_URL_API = "https://is.gd/create.php"
    
    /**
     * Share a podcast with others.
     * Non-app users will be directed to the web player.
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

                val encodedTitle = Uri.encode(podcast.title)
                val encodedDesc = Uri.encode(summaryDesc)
                val encodedImage = Uri.encode(podcast.imageUrl)
                val encodedRss = Uri.encode(podcast.rssUrl)
                val webUrl = "$WEB_BASE_URL/#/p/${podcast.id}?title=$encodedTitle&desc=$encodedDesc&img=$encodedImage&rss=$encodedRss"

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

                val encodedTitle = Uri.encode(shareEpisode.title)
                val encodedDesc = Uri.encode(summaryDesc)
                val encodedImage = Uri.encode(shareEpisode.imageUrl)
                val encodedPodcast = Uri.encode(sharePodcastTitle)
                val encodedPodcastId = Uri.encode(shareEpisode.podcastId)
                val encodedAudio = Uri.encode(shareEpisode.audioUrl)
                val encodedDate = Uri.encode(shareEpisode.pubDate)
                val encodedDuration = Uri.encode(shareEpisode.durationMins.toString())
                val webUrl = "$WEB_BASE_URL/#/e/${shareEpisode.id}?title=$encodedTitle&desc=$encodedDesc&img=$encodedImage&podcast=$encodedPodcast&podcastId=$encodedPodcastId&audio=$encodedAudio&date=$encodedDate&duration=$encodedDuration"

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
                // GitHub Pages URL format: /British-Radio-Player/p/{id} or /British-Radio-Player/e/{id}
                // Also accept legacy /BBC-Radio-Player paths for backward compatibility.
                val segments = uri.pathSegments
                if (segments.getOrNull(0) == "British-Radio-Player" || segments.getOrNull(0) == "BBC-Radio-Player") {
                    when (segments.getOrNull(1)) {
                        "p" -> {
                            val podcastId = segments.getOrNull(2) ?: return null
                            ShareContentType.PODCAST to podcastId
                        }
                        "e" -> {
                            val episodeId = segments.getOrNull(2) ?: return null
                            ShareContentType.EPISODE to episodeId
                        }
                        else -> null
                    }
                } else null
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
     * Summarize text via the Google Cloud Function backend.
     * Falls back to simple local truncation when the API is unavailable.
     */
    private fun summarizeTextWithAI(text: String): String {
        if (text.isBlank()) return ""
        
        val plain = stripHtmlTags(text)
        if (plain.isBlank()) return ""

        val configuredBaseUrl = BuildConfig.CLOUD_FUNCTION_URL.trim().trimEnd('/')
        val baseUrl = if (configuredBaseUrl.isNotBlank()) configuredBaseUrl else DEFAULT_CLOUD_FUNCTION_URL
        
        return try {
            val payload = JSONObject().apply {
                put("text", plain.take(2000))
            }.toString()
            val url = "$baseUrl/summarize"
            
            android.util.Log.d("ShareUtil", "Calling Cloud Function summary API (length=${plain.length})")
            
            val connection = (URL(url).openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 3000
                readTimeout = 3000
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("User-Agent", "British-Radio-Player/1.0")
                doOutput = true
            }
            
            connection.outputStream.write(payload.toByteArray(Charsets.UTF_8))
            
            val responseCode = connection.responseCode
            android.util.Log.d("ShareUtil", "Cloud Function summary API returned code: $responseCode")
            
            if (responseCode != 200) {
                android.util.Log.w("ShareUtil", "Cloud Function summary API returned $responseCode, using fallback")
                connection.disconnect()
                return summarizeTextLocally(plain)
            }
            
            val responseText = connection.inputStream.bufferedReader().use { it.readText() }.trim()
            connection.disconnect()
            
            val responseJson = JSONObject(responseText)
            val summary = responseJson.optString("summary", "").trim()
            val cached = responseJson.optBoolean("cached", false)
            
            android.util.Log.d("ShareUtil", "Cloud Function summary response received (${summary.length} chars, cached=$cached)")

            if (summary.isNotBlank() && summary.length < 500 && summary.length > 3) {
                android.util.Log.d("ShareUtil", "Using AI summary")
                summary
            } else {
                android.util.Log.w("ShareUtil", "Summary invalid or too long (${summary.length} chars), using fallback")
                summarizeTextLocally(plain)
            }
        } catch (e: java.net.SocketTimeoutException) {
            android.util.Log.w("ShareUtil", "Cloud Function summary API timeout (${e.message}), using fallback")
            summarizeTextLocally(plain)
        } catch (e: java.net.ConnectException) {
            android.util.Log.w("ShareUtil", "Cloud Function summary API connection failed (${e.message}), using fallback")
            summarizeTextLocally(plain)
        } catch (e: Exception) {
            android.util.Log.w("ShareUtil", "AI summary unavailable (${e.javaClass.simpleName}: ${e.message}), using fallback")
            summarizeTextLocally(plain)
        }
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
     * Shorten a URL using is.gd service
     */
    private fun shortenUrl(longUrl: String): String {
        return try {
            android.util.Log.d("ShareUtil", "Shortening URL (length: ${longUrl.length}): ${longUrl.take(200)}...")
            val encodedUrl = URLEncoder.encode(longUrl, "UTF-8")
            val urlStr = "$SHORT_URL_API?format=json&url=$encodedUrl"
            val connection = (URL(urlStr).openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 4000
                readTimeout = 4000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "British Radio Player/1.0")
            }
            
            val responseCode = connection.responseCode
            val response = if (responseCode == 200) {
                connection.inputStream.bufferedReader().use { it.readText() }
            } else {
                // For errors, read from error stream
                connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            }
            
            if (responseCode == 200 && response.contains("shorturl")) {
                // Parse JSON response for shorturl field
                // Example: { "shorturl": "https://is.gd/abc123" }
                val shortUrl = response.substringAfter("\"shorturl\"")
                    .substringAfter("\"")
                    .substringBefore("\"")
                    .replace("\\/", "/")
                    .trim()
                
                // Validate it's actually a URL
                if (shortUrl.startsWith("http://") || shortUrl.startsWith("https://")) {
                    android.util.Log.d("ShareUtil", "Successfully shortened to: $shortUrl")
                    return shortUrl
                }
            }
            
            // Log any errors for debugging
            if (response.contains("errorcode")) {
                val errorMsg = response.substringAfter("\"errormessage\"")
                    .substringAfter("\"")
                    .substringBefore("\"")
                android.util.Log.w("ShareUtil", "is.gd error: $errorMsg")
            } else {
                android.util.Log.w("ShareUtil", "is.gd returned status $responseCode: $response")
            }
            
            longUrl
        } catch (e: Exception) {
            android.util.Log.w("ShareUtil", "Failed to shorten URL: ${e.message}")
            longUrl
        }
    }
    
    enum class ShareContentType {
        PODCAST,
        EPISODE
    }
}
