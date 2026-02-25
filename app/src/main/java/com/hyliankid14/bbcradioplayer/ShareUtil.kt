package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.URL
import java.net.URLEncoder

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
    private const val WEB_BASE_URL = "https://hyliankid14.github.io/BBC-Radio-Player"
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
                    append("\n\nIf you have the BBC Radio Player app installed, you can open it directly.")
                }
                
                // Post back to main thread to start activity
                handler.post {
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
            }
        }.start()
    }
    
    /**
     * Share a specific episode with others.
     * Non-app users will be directed to the web player showing this episode.
     */
    fun shareEpisode(context: Context, episode: Episode, podcastTitle: String) {
        val shareTitle = episode.title
        val handler = Handler(Looper.getMainLooper())
        var cleanDesc = stripHtmlTags(episode.description)
        var shareEpisode = episode
        var sharePodcastTitle = podcastTitle
        
        // Shorten URL on background thread
        Thread {
            try {
                // Try to refresh episode metadata from repository so we don't summarize stale/truncated text
                try {
                    val repo = PodcastRepository(context)
                    val podcasts = kotlinx.coroutines.runBlocking { repo.fetchPodcasts(false) }
                    val matchedPodcast = podcasts.firstOrNull { it.id == episode.podcastId }
                    if (matchedPodcast != null) {
                        if (sharePodcastTitle.isBlank()) sharePodcastTitle = matchedPodcast.title
                        val episodes = kotlinx.coroutines.runBlocking { repo.fetchEpisodesIfNeeded(matchedPodcast) }
                        val matchedEpisode = episodes.firstOrNull { ep ->
                            ep.id == episode.id ||
                            (ep.audioUrl.isNotEmpty() && ep.audioUrl == episode.audioUrl) ||
                            ep.title.equals(episode.title, ignoreCase = true)
                        }
                        if (matchedEpisode != null) {
                            shareEpisode = matchedEpisode
                            cleanDesc = stripHtmlTags(matchedEpisode.description)
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.w("ShareUtil", "Could not refresh episode details before sharing: ${e.message}")
                }

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
                    append("\n\nIf you have the BBC Radio Player app installed, you can open it directly.")
                }
                
                // Post back to main thread to start activity
                handler.post {
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
                // GitHub Pages URL format: /BBC-Radio-Player/p/{id} or /BBC-Radio-Player/e/{id}
                val segments = uri.pathSegments
                if (segments.getOrNull(0) == "BBC-Radio-Player") {
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
            .replace(Regex("&nbsp;"), " ")
            .replace(Regex("\n+"), " ")
            .trim()
    }

    private fun summarizeTextWithAI(text: String): String {
        if (text.isBlank()) return ""
        val plain = text.replace(Regex("\\s+"), " ").trim()

        return try {
            val prompt = buildString {
                append("Summarize the following podcast description in about 30 words. ")
                append("Keep key details and return plain text only.\\n\\n")
                append(plain.take(3500))
            }
            val encodedPrompt = URLEncoder.encode(prompt, "UTF-8")
            val responseText = URL("https://text.pollinations.ai/$encodedPrompt").readText()
            val summary = responseText.trim()

            if (summary.isNotBlank()) limitToWords(summary, 30) else limitToWords(plain, 30)
        } catch (e: Exception) {
            android.util.Log.w("ShareUtil", "AI summary unavailable, using fallback: ${e.message}")
            limitToWords(plain, 30)
        }
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
                connectTimeout = 10000
                readTimeout = 10000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "BBC Radio Player/1.0")
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
