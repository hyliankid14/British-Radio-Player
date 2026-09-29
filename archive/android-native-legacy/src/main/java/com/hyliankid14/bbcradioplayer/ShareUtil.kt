@file:Suppress("DEPRECATION")
package com.hyliankid14.bbcradioplayer

import android.app.ProgressDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import javax.net.ssl.HttpsURLConnection

object ShareUtil {

    private const val WEB_BASE_URL = "https://hyliankid14.github.io/British-Radio-Player"
    private const val APP_SCHEME = "app"
    private const val TINYURL_API = "https://tinyurl.com/api-create.php"
    private const val IS_GD_API = "https://is.gd/create.php"
    private const val BITLY_API_URL = "https://api-ssl.bitly.com/v4/shorten"
    private const val BITLY_TOKEN_KEY = "bitly_token"

    fun sharePodcast(context: Context, podcast: Podcast) {
        val shareTitle = podcast.title
        val handler = Handler(Looper.getMainLooper())
        val cleanDesc = stripHtmlTags(podcast.description)

        @Suppress("DEPRECATION")
        val progressDialog = ProgressDialog(context).apply {
            setMessage("Generating sharing link...")
            setCancelable(false)
            show()
        }

        Thread {
            try {
                val summaryDesc = summarizeTextWithAI(cleanDesc)
                val encodedTitle = Uri.encode(podcast.title)
                val encodedDesc = Uri.encode(summaryDesc)
                val encodedImage = Uri.encode(podcast.imageUrl)
                val encodedRss = Uri.encode(podcast.rssUrl)
                val webUrl = "$WEB_BASE_URL/#/p/${Uri.encode(podcast.id)}?title=$encodedTitle&desc=$encodedDesc&img=$encodedImage&rss=$encodedRss"

                val shortUrl = shortenUrl(context, webUrl)
                val shareMessage = buildString {
                    append("Check out \"${podcast.title}\"")
                    if (summaryDesc.isNotEmpty()) {
                        append(" - $summaryDesc")
                    }
                    append("\n\n")
                    append(shortUrl)
                    append("\n\nIf you have the British Radio Player app installed, you can open it directly.")
                }

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

    fun shareEpisode(context: Context, episode: Episode, podcastTitle: String = "") {
        var shareEpisode = episode
        var sharePodcastTitle = podcastTitle
        var cleanDesc = stripHtmlTags(episode.description)
        val shareTitle = episode.title
        val handler = Handler(Looper.getMainLooper())

        @Suppress("DEPRECATION")
        val progressDialog = ProgressDialog(context).apply {
            setMessage("Generating sharing link...")
            setCancelable(false)
            show()
        }

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
                val webUrl = "$WEB_BASE_URL/#/e/${shareEpisode.podcastId}/${shareEpisode.id}?title=$encodedTitle&desc=$encodedDesc&img=$encodedImage&podcast=$encodedPodcast&podcastId=$encodedPodcastId&audio=$encodedAudio&date=$encodedDate&duration=$encodedDuration"

                val shortUrl = shortenUrl(context, webUrl)
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

    fun getPodcastShareUrl(podcastId: String, podcast: Podcast? = null): String {
        val title = podcast?.title?.let { Uri.encode(it) } ?: ""
        return if (title.isNotEmpty()) {
            "$WEB_BASE_URL/#/p/${Uri.encode(podcastId)}?title=$title"
        } else {
            "$WEB_BASE_URL/#/p/${Uri.encode(podcastId)}"
        }
    }

    fun getEpisodeShareUrl(episodeId: String, episode: Episode? = null, podcastTitle: String = ""): String {
        val podcastId = episode?.podcastId ?: ""
        val title = episode?.title?.let { Uri.encode(it) } ?: ""
        val audioUrl = episode?.audioUrl?.let { Uri.encode(it) } ?: ""

        return if (title.isNotEmpty() && audioUrl.isNotEmpty()) {
            val podcastParam = podcastTitle.takeIf { it.isNotEmpty() }?.let { "&podcast=${Uri.encode(it)}" } ?: ""
            "$WEB_BASE_URL/#/e/${Uri.encode(podcastId)}/${Uri.encode(episodeId)}?title=$title$podcastParam&audio=$audioUrl"
        } else {
            "$WEB_BASE_URL/#/e/${Uri.encode(podcastId)}/${Uri.encode(episodeId)}"
        }
    }

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
                        val episodeId = segments.getOrNull(2) ?: return null
                        ShareContentType.EPISODE to episodeId
                    }
                    else -> null
                }
            }
            else -> null
        }
    }

    private fun stripHtmlTags(html: String): String {
        return html.replace(Regex("<[^>]*>"), "")
            .replace(Regex("&lt;"), "<")
            .replace(Regex("&gt;"), ">")
            .replace(Regex("&amp;"), "&")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

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
        if (sentences.size == 1) return limitToWords(sentences[0], 30).trimEnd('.', '!', '?') + "."

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

    private fun shortenUrl(context: Context, longUrl: String): String {
        val prefs = context.getSharedPreferences("share_prefs", Context.MODE_PRIVATE)
        val bitlyToken = prefs.getString(BITLY_TOKEN_KEY, null)

        if (bitlyToken != null && bitlyToken.isNotBlank()) {
            return shortenWithBitly(longUrl, bitlyToken)
                ?: shortenWithTinyUrl(longUrl)
                ?: longUrl
        }

        return shortenWithTinyUrl(longUrl)
            ?: shortenWithIsGd(longUrl)
            ?: longUrl
    }

    private fun shortenWithBitly(longUrl: String, token: String): String? {
        return try {
            val connection = (URL(BITLY_API_URL).openConnection() as HttpsURLConnection).apply {
                connectTimeout = 10000
                readTimeout = 10000
                requestMethod = "POST"
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
            }

            val json = """{"long_url":"${longUrl.replace("\"", "\\\"")}"}"""
            connection.outputStream.use { it.write(json.toByteArray()) }

            val responseCode = connection.responseCode
            if (responseCode == 200) {
                val response = connection.inputStream.bufferedReader().use { it.readText() }
                val shortUrl = Regex("\"bitly_link\"\\s*:\\s*\"([^\"]+)\"").find(response)?.groupValues?.get(1)
                    ?: Regex("\"link\"\\s*:\\s*\"([^\"]+)\"").find(response)?.groupValues?.get(1)
                if (shortUrl != null) {
                    android.util.Log.d("ShareUtil", "Bitly shortened to: $shortUrl")
                    return shortUrl
                }
            }
            null
        } catch (e: Exception) {
            android.util.Log.w("ShareUtil", "Bitly shorten failed: ${e.message}")
            null
        }
    }

    private fun shortenWithTinyUrl(longUrl: String): String? {
        return try {
            val encodedUrl = URLEncoder.encode(longUrl, "UTF-8")
            val connection = (URL("$TINYURL_API?url=$encodedUrl").openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 10000
                readTimeout = 10000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "British Radio Player/1.0")
                instanceFollowRedirects = true
            }

            val responseCode = connection.responseCode
            val response = if (responseCode == 200) {
                connection.inputStream.bufferedReader().use { it.readText() }
            } else {
                connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            }
            connection.disconnect()

            val trimmed = response.trim()
            if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                android.util.Log.d("ShareUtil", "TinyURL shortened to: $trimmed")
                return trimmed
            }
            android.util.Log.w("ShareUtil", "TinyURL error: $trimmed")
            null
        } catch (e: Exception) {
            android.util.Log.w("ShareUtil", "TinyURL shorten failed: ${e.message}")
            null
        }
    }

    private fun shortenWithIsGd(longUrl: String): String? {
        return try {
            val encodedUrl = URLEncoder.encode(longUrl, "UTF-8")

            val simpleResult = callIsGd("$IS_GD_API?format=simple&logstats=0&url=$encodedUrl")
            if (simpleResult.startsWith("http://") || simpleResult.startsWith("https://")) {
                android.util.Log.d("ShareUtil", "is.gd shortened to: $simpleResult")
                return simpleResult
            }
            if (simpleResult.isNotEmpty()) {
                android.util.Log.w("ShareUtil", "is.gd simple error: $simpleResult")
            }

            val jsonResponse = callIsGd("$IS_GD_API?format=json&logstats=0&url=$encodedUrl")
            if (jsonResponse.contains("shorturl")) {
                val shortUrl = jsonResponse.substringAfter("\"shorturl\"")
                    .substringAfter("\"")
                    .substringBefore("\"")
                    .replace("\\/", "/")
                    .trim()
                if (shortUrl.startsWith("http://") || shortUrl.startsWith("https://")) {
                    android.util.Log.d("ShareUtil", "is.gd shortened to: $shortUrl")
                    return shortUrl
                }
            }

            null
        } catch (e: Exception) {
            android.util.Log.w("ShareUtil", "Failed to shorten URL: ${e.message}")
            null
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

    fun setBitlyToken(context: Context, token: String) {
        context.getSharedPreferences("share_prefs", Context.MODE_PRIVATE)
            .edit()
            .putString(BITLY_TOKEN_KEY, token)
            .apply()
    }

    enum class ShareContentType {
        PODCAST,
        EPISODE
    }
}