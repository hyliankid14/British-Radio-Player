package com.hyliankid14.bbcradioplayer.androidautobridge

import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * Best-effort "now playing" programme titles for station browse rows.
 *
 * Mirrors the Kotlin app's use of the BBC ESS schedule endpoint to show the current
 * show as the subtitle of each station in Android Auto. Results are cached so browse
 * requests never block on the network.
 */
object AutoShowInfo {

  private const val TAG = "AutoShowInfo"
  private const val CACHE_TTL_MS = 5 * 60 * 1000L

  private data class Entry(val title: String, val fetchedAtMs: Long)

  private val cache = ConcurrentHashMap<String, Entry>()

  /** Returns the cached current-show title (possibly empty) for a station service id. */
  fun cachedShowTitle(serviceId: String): String {
    val entry = cache[serviceId] ?: return ""
    if (System.currentTimeMillis() - entry.fetchedAtMs > CACHE_TTL_MS) return entry.title
    return entry.title
  }

  /** Fetches and caches the current-show title. Call from a background thread. */
  fun refreshShowTitle(serviceId: String): String {
    if (serviceId.isBlank()) return ""
    val existing = cache[serviceId]
    if (existing != null && System.currentTimeMillis() - existing.fetchedAtMs <= CACHE_TTL_MS) {
      return existing.title
    }
    val title = try {
      fetchCurrentShowTitle(serviceId)
    } catch (e: Exception) {
      Log.d(TAG, "Show info fetch failed for $serviceId: ${e.message}")
      ""
    }
    cache[serviceId] = Entry(title, System.currentTimeMillis())
    return title
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
