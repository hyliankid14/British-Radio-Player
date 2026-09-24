package com.hyliankid14.bbcradioplayer.androidautobridge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * Best-effort "now playing" programme and song info for station browse rows and now playing.
 *
 * Fetches real-time song/artist/artwork from the BBC RMS segments endpoint, and programme
 * title from the BBC ESS schedules endpoint. Results and downloaded artwork bitmaps are
 * cached so Android Auto now-playing and browse requests never block on the network.
 */
object AutoShowInfo {

  private const val TAG = "AutoShowInfo"
  private const val ESS_CACHE_TTL_MS = 5 * 60 * 1000L
  private const val RMS_CACHE_TTL_MS = 25 * 1000L

  data class ShowInfo(
    val showTitle: String = "",
    val artist: String = "",
    val track: String = "",
    val songArtworkUrl: String = "",
    val fetchedAtMs: Long = 0L
  )

  private val infoCache = ConcurrentHashMap<String, ShowInfo>()
  private val artworkBitmapCache = ConcurrentHashMap<String, Bitmap>()

  /** Returns the cached ShowInfo, or an empty ShowInfo if missing. */
  fun cachedShowInfo(serviceId: String): ShowInfo {
    return infoCache[serviceId] ?: ShowInfo()
  }

  /** Returns the cached current-show title, or "" when missing/stale. */
  fun cachedShowTitle(serviceId: String): String {
    val entry = infoCache[serviceId] ?: return ""
    if (System.currentTimeMillis() - entry.fetchedAtMs > ESS_CACHE_TTL_MS) return ""
    return entry.showTitle
  }

  /** Returns the downloaded song artwork bitmap if available. */
  fun cachedArtworkBitmap(serviceId: String): Bitmap? {
    return artworkBitmapCache[serviceId]
  }

  /**
   * Fetches and caches the latest show & song info. Call from a background thread.
   */
  fun refreshShowInfo(serviceId: String): ShowInfo {
    if (serviceId.isBlank()) return ShowInfo()
    val existing = infoCache[serviceId]
    val now = System.currentTimeMillis()
    if (existing != null && now - existing.fetchedAtMs <= RMS_CACHE_TTL_MS) {
      return existing
    }

    val (artist, track, songArtworkUrl) = try {
      fetchRmsNowPlaying(serviceId)
    } catch (e: Exception) {
      Log.d(TAG, "RMS segment fetch failed for $serviceId: ${e.message}")
      Triple(existing?.artist.orEmpty(), existing?.track.orEmpty(), existing?.songArtworkUrl.orEmpty())
    }

    val showTitle = try {
      if (existing != null && existing.showTitle.isNotEmpty() && now - existing.fetchedAtMs <= ESS_CACHE_TTL_MS) {
        existing.showTitle
      } else {
        fetchCurrentShowTitle(serviceId)
      }
    } catch (e: Exception) {
      Log.d(TAG, "ESS show info fetch failed for $serviceId: ${e.message}")
      existing?.showTitle.orEmpty()
    }

    // Download artwork bitmap if new artwork URL is present
    if (songArtworkUrl.isNotEmpty() && songArtworkUrl != existing?.songArtworkUrl) {
      try {
        val bitmap = downloadBitmap(songArtworkUrl)
        if (bitmap != null) {
          artworkBitmapCache[serviceId] = bitmap
        }
      } catch (e: Exception) {
        Log.d(TAG, "Failed to download song artwork: ${e.message}")
      }
    } else if (songArtworkUrl.isEmpty()) {
      artworkBitmapCache.remove(serviceId)
    }

    val updated = ShowInfo(
      showTitle = showTitle,
      artist = artist,
      track = track,
      songArtworkUrl = songArtworkUrl,
      fetchedAtMs = now
    )
    infoCache[serviceId] = updated
    return updated
  }

  /** Backwards compatibility for browse rows. */
  fun refreshShowTitle(serviceId: String): String {
    return refreshShowInfo(serviceId).showTitle
  }

  private fun fetchRmsNowPlaying(serviceId: String): Triple<String, String, String> {
    val connection = (URL("https://rms.api.bbc.co.uk/v2/services/$serviceId/segments/latest?t=${System.currentTimeMillis()}")
      .openConnection() as HttpURLConnection).apply {
      connectTimeout = 6000
      readTimeout = 6000
      requestMethod = "GET"
      setRequestProperty("User-Agent", "BritishRadioPlayer/1.0 (Android)")
      setRequestProperty("Accept", "application/json")
    }
    try {
      if (connection.responseCode == 404) {
        return Triple("", "", "")
      }
      if (connection.responseCode != HttpURLConnection.HTTP_OK) return Triple("", "", "")
      val body = connection.inputStream.bufferedReader().use { it.readText() }
      val data = JSONObject(body).optJSONArray("data") ?: return Triple("", "", "")
      if (data.length() == 0) return Triple("", "", "")
      val segment = data.optJSONObject(0) ?: return Triple("", "", "")
      val isMusic = segment.optString("segment_type", "").equals("music", ignoreCase = true)
      val titles = segment.optJSONObject("titles")
      val primary = titles?.optString("primary", "").orEmpty()
      val secondary = titles?.optString("secondary", "").orEmpty()
      val tertiary = titles?.optString("tertiary", "").orEmpty()

      if (isMusic || primary.isNotEmpty()) {
        val artist = primary
        val track = secondary.ifEmpty { tertiary }
        val template = segment.optString("image_url", "")
        val artworkUrl = if (template.isNotEmpty()) template.replace("{recipe}", "640x640") else ""
        return Triple(artist, track, artworkUrl)
      }
    } finally {
      try { connection.disconnect() } catch (_: Exception) { }
    }
    return Triple("", "", "")
  }

  private fun downloadBitmap(imageUrl: String): Bitmap? {
    val connection = (URL(imageUrl.replace("http://", "https://")).openConnection() as HttpURLConnection).apply {
      connectTimeout = 6000
      readTimeout = 8000
      requestMethod = "GET"
      setRequestProperty("User-Agent", "BritishRadioPlayer/1.0 (Android)")
    }
    return try {
      if (connection.responseCode == HttpURLConnection.HTTP_OK) {
        connection.inputStream.use { BitmapFactory.decodeStream(it) }
      } else null
    } finally {
      try { connection.disconnect() } catch (_: Exception) { }
    }
  }

  private fun fetchCurrentShowTitle(serviceId: String): String {
    val connection = (URL("https://ess.api.bbci.co.uk/schedules?serviceId=$serviceId&mediatypes=audio")
      .openConnection() as HttpURLConnection).apply {
      connectTimeout = 8000
      readTimeout = 8000
      requestMethod = "GET"
      setRequestProperty("User-Agent", "BritishRadioPlayer/1.0 (Android)")
      setRequestProperty("Accept", "application/json")
    }
    try {
      if (connection.responseCode != HttpURLConnection.HTTP_OK) return ""
      val body = connection.inputStream.bufferedReader().use { it.readText() }
      val items = JSONObject(body).optJSONArray("items") ?: return ""
      val now = System.currentTimeMillis()
      for (i in 0 until items.length()) {
        val item = items.optJSONObject(i) ?: continue
        val published = item.optJSONObject("published_time") ?: continue
        val startRaw = published.optString("start", "")
        val endRaw = published.optString("end", "")
        if (startRaw.isEmpty() || endRaw.isEmpty()) continue
        val start = parseIso(startRaw) ?: continue
        val end = parseIso(endRaw) ?: continue
        if (now in start..end) {
          val brand = item.optJSONObject("brand")
          val episode = item.optJSONObject("episode")
          val title = brand?.optString("title", "")?.takeIf { it.isNotEmpty() }
            ?: episode?.optString("title", "")?.takeIf { it.isNotEmpty() }
            ?: ""
          return title
        }
      }
    } finally {
      try { connection.disconnect() } catch (_: Exception) { }
    }
    return ""
  }

  private fun parseIso(raw: String): Long? {
    val normalised = raw.trim().replace("Z", "+0000")
    val formats = listOf(
      "yyyy-MM-dd'T'HH:mm:ssZ",
      "yyyy-MM-dd'T'HH:mm:ss.SSSZ",
      "yyyy-MM-dd'T'HH:mm:ssXXX",
      "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"
    )
    for (pattern in formats) {
      try {
        val format = java.text.SimpleDateFormat(pattern, java.util.Locale.US)
        format.isLenient = false
        val parsed = format.parse(normalised)
        if (parsed != null) return parsed.time
      } catch (_: Exception) {
        // Try the next pattern.
      }
    }
    return null
  }
}
