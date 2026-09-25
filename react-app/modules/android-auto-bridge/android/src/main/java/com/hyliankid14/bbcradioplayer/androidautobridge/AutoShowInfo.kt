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
  private const val RMS_CACHE_TTL_MS = 5 * 1000L
  private const val RMS_DELAY_MS = 20_000L

  data class ScheduleEntry(
    val title: String,
    val subtitle: String,
    val startMs: Long,
    val endMs: Long
  )

  data class ShowInfo(
    val showTitle: String = "",
    val showSubtitle: String = "",
    val artist: String = "",
    val track: String = "",
    val songArtworkUrl: String = "",
    val fetchedAtMs: Long = 0L,
    val showStartMs: Long = 0L,
    val showEndMs: Long = 0L,
    val essFetchedAtMs: Long = 0L,
    val rawArtist: String = "",
    val rawTrack: String = "",
    val rawArtworkUrl: String = ""
  )

  data class ShowDetails(
    val title: String = "",
    val subtitle: String = "",
    val startMs: Long = 0L,
    val endMs: Long = 0L,
    val fetchedAtMs: Long = 0L
  )

  data class RmsSong(
    val artist: String = "",
    val track: String = "",
    val songArtworkUrl: String = ""
  )

  data class DelayedRms(
    var applied: RmsSong = RmsSong(),
    var pending: RmsSong? = null,
    var pendingApplyAtMs: Long = 0L,
    var lastRaw: RmsSong = RmsSong()
  )

  private val infoCache = ConcurrentHashMap<String, ShowInfo>()
  private val artworkBitmapCache = ConcurrentHashMap<String, Bitmap>()
  private val delayedRmsCache = ConcurrentHashMap<String, DelayedRms>()
  private val scheduleCache = ConcurrentHashMap<String, List<ScheduleEntry>>()

  fun resetDelay(serviceId: String? = null) {
    if (serviceId != null) {
      delayedRmsCache.remove(serviceId)
    } else {
      delayedRmsCache.clear()
    }
  }

  /** Returns the cached ShowInfo, or an empty ShowInfo if missing. */
  fun cachedShowInfo(serviceId: String): ShowInfo {
    val cached = infoCache[serviceId] ?: return ShowInfo()
    val now = System.currentTimeMillis()
    val streamTime = now - RMS_DELAY_MS
    // If the current show has ended on the audio stream and we have a schedule cached,
    // transition seamlessly to the next schedule entry.
    if (cached.showEndMs > 0L && streamTime >= cached.showEndMs) {
      val next = scheduleCache[serviceId]?.firstOrNull { streamTime in it.startMs until it.endMs }
      if (next != null && (next.title != cached.showTitle || next.subtitle != cached.showSubtitle)) {
        val updated = cached.copy(
          showTitle = next.title,
          showSubtitle = next.subtitle,
          showStartMs = next.startMs,
          showEndMs = next.endMs
        )
        infoCache[serviceId] = updated
        return updated
      }
    }
    return cached
  }

  /** Returns the cached current-show title, or "" when missing/stale. */
  fun cachedShowTitle(serviceId: String): String {
    return cachedShowInfo(serviceId).showTitle
  }

  /** Returns the cached current-show subtitle, or "" when missing/stale. */
  fun cachedShowSubtitle(serviceId: String): String {
    return cachedShowInfo(serviceId).showSubtitle
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
    val streamTime = now - RMS_DELAY_MS

    // Check if we should skip RMS network call if within RMS_CACHE_TTL_MS
    val rmsFresh = existing != null && (now - existing.fetchedAtMs <= RMS_CACHE_TTL_MS)

    val (rawArtist, rawTrack, rawArtworkUrl) = if (rmsFresh) {
      Triple(existing?.artist.orEmpty(), existing?.track.orEmpty(), existing?.songArtworkUrl.orEmpty())
    } else {
      try {
        fetchRmsNowPlaying(serviceId)
      } catch (e: Exception) {
        Log.d(TAG, "RMS segment fetch failed for $serviceId: ${e.message}")
        Triple(existing?.artist.orEmpty(), existing?.track.orEmpty(), existing?.songArtworkUrl.orEmpty())
      }
    }

    // Delay RMS song metadata updates by 20s to account for audio stream buffer delay
    val rawSong = RmsSong(rawArtist, rawTrack, rawArtworkUrl)
    val delayState = delayedRmsCache.computeIfAbsent(serviceId) {
      DelayedRms(applied = rawSong, lastRaw = rawSong)
    }

    if (delayState.pendingApplyAtMs > 0L && now >= delayState.pendingApplyAtMs) {
      delayState.applied = delayState.pending ?: RmsSong()
      delayState.pending = null
      delayState.pendingApplyAtMs = 0L
    }

    if (rawSong != delayState.lastRaw) {
      delayState.lastRaw = rawSong
      delayState.pending = rawSong
      delayState.pendingApplyAtMs = now + RMS_DELAY_MS
    }

    val artist = delayState.applied.artist
    val track = delayState.applied.track
    val songArtworkUrl = delayState.applied.songArtworkUrl

    // ── ESS Show Details ──────────────────────────────────────────────────
    val scheduleEntries = scheduleCache[serviceId]
    val currentScheduled = scheduleEntries?.firstOrNull { streamTime in it.startMs until it.endMs }
    val showEnded = existing != null && existing.showEndMs > 0L && streamTime >= existing.showEndMs
    val essExpired = existing == null || existing.showTitle.isEmpty() || (now - existing.essFetchedAtMs > ESS_CACHE_TTL_MS)

    val details: ShowDetails = if (essExpired || (showEnded && currentScheduled == null)) {
      try {
        val fetched = fetchCurrentShowDetails(serviceId, streamTime)
        if (fetched.title.isNotEmpty()) {
          fetched
        } else if (currentScheduled != null) {
          ShowDetails(currentScheduled.title, currentScheduled.subtitle, currentScheduled.startMs, currentScheduled.endMs, existing?.essFetchedAtMs ?: now)
        } else {
          ShowDetails(existing?.showTitle.orEmpty(), existing?.showSubtitle.orEmpty(), existing?.showStartMs ?: 0L, existing?.showEndMs ?: 0L, existing?.essFetchedAtMs ?: 0L)
        }
      } catch (e: Exception) {
        Log.d(TAG, "ESS show info fetch failed for $serviceId: ${e.message}")
        if (currentScheduled != null) {
          ShowDetails(currentScheduled.title, currentScheduled.subtitle, currentScheduled.startMs, currentScheduled.endMs, existing?.essFetchedAtMs ?: now)
        } else {
          ShowDetails(existing?.showTitle.orEmpty(), existing?.showSubtitle.orEmpty(), existing?.showStartMs ?: 0L, existing?.showEndMs ?: 0L, existing?.essFetchedAtMs ?: 0L)
        }
      }
    } else if (currentScheduled != null && (currentScheduled.title != existing?.showTitle || currentScheduled.subtitle != existing?.showSubtitle)) {
      ShowDetails(currentScheduled.title, currentScheduled.subtitle, currentScheduled.startMs, currentScheduled.endMs, existing?.essFetchedAtMs ?: now)
    } else {
      ShowDetails(existing?.showTitle.orEmpty(), existing?.showSubtitle.orEmpty(), existing?.showStartMs ?: 0L, existing?.showEndMs ?: 0L, existing?.essFetchedAtMs ?: 0L)
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
      showTitle = details.title,
      showSubtitle = details.subtitle,
      artist = artist,
      track = track,
      songArtworkUrl = songArtworkUrl,
      fetchedAtMs = now,
      showStartMs = details.startMs,
      showEndMs = details.endMs,
      essFetchedAtMs = details.fetchedAtMs,
      rawArtist = rawArtist,
      rawTrack = rawTrack,
      rawArtworkUrl = rawArtworkUrl
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
      setRequestProperty("Cache-Control", "no-cache")
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
      if (!isMusic) return Triple("", "", "")

      val offset = segment.optJSONObject("offset")
      val isNowPlaying = offset?.optBoolean("now_playing", false) ?: false
      val label = offset?.optString("label", "").orEmpty()
      val isActuallyPlaying = (isNowPlaying || label.equals("Now Playing", ignoreCase = true)) &&
        offset?.optBoolean("now_playing", true) != false &&
        !label.contains("Ago", ignoreCase = true)

      if (!isActuallyPlaying) return Triple("", "", "")

      val titles = segment.optJSONObject("titles")
      val primary = titles?.optString("primary", "").orEmpty().trim()
      val secondary = titles?.optString("secondary", "").orEmpty().trim()
      val tertiary = titles?.optString("tertiary", "").orEmpty().trim()

      if (primary.isNotEmpty() || secondary.isNotEmpty() || tertiary.isNotEmpty()) {
        val artist = primary
        val track = secondary.ifEmpty { tertiary }
        val template = segment.optString("image_url", "")
        val artworkUrl = if (template.isNotEmpty() &&
          !template.contains("default", ignoreCase = true) &&
          !template.contains("p01tqv8z", ignoreCase = true)) {
          template.replace("{recipe}", "640x640")
        } else {
          ""
        }
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

  private fun fetchCurrentShowDetails(serviceId: String, streamTime: Long): ShowDetails {
    val connection = (URL("https://ess.api.bbci.co.uk/schedules?serviceId=$serviceId&mediatypes=audio&t=${System.currentTimeMillis()}")
      .openConnection() as HttpURLConnection).apply {
      connectTimeout = 8000
      readTimeout = 8000
      requestMethod = "GET"
      setRequestProperty("User-Agent", "BritishRadioPlayer/1.0 (Android)")
      setRequestProperty("Accept", "application/json")
      setRequestProperty("Cache-Control", "no-cache")
    }
    try {
      if (connection.responseCode != HttpURLConnection.HTTP_OK) return ShowDetails()
      val body = connection.inputStream.bufferedReader().use { it.readText() }
      val items = JSONObject(body).optJSONArray("items") ?: return ShowDetails()
      val entries = mutableListOf<ScheduleEntry>()

      for (i in 0 until items.length()) {
        val item = items.optJSONObject(i) ?: continue
        val published = item.optJSONObject("published_time") ?: continue
        val startRaw = published.optString("start", "")
        val endRaw = published.optString("end", "")
        if (startRaw.isEmpty() || endRaw.isEmpty()) continue
        val start = parseIso(startRaw) ?: continue
        val end = parseIso(endRaw) ?: continue

        val brand = item.optJSONObject("brand")
        val episode = item.optJSONObject("episode")
        val brandTitle = brand?.optString("title", "").orEmpty().trim()
        val episodeTitle = episode?.optString("title", "").orEmpty().trim()
        val shortSynopsis = episode?.optJSONObject("synopses")?.optString("short", "").orEmpty().trim()
          .ifEmpty { item.optJSONObject("synopses")?.optString("short", "").orEmpty().trim() }

        val showTitle = brandTitle.ifEmpty { episodeTitle }
        val showSubtitle = if (brandTitle.isNotEmpty() && episodeTitle.isNotEmpty() && !episodeTitle.equals(brandTitle, ignoreCase = true)) {
          episodeTitle
        } else if (shortSynopsis.isNotEmpty() && !shortSynopsis.equals(showTitle, ignoreCase = true)) {
          shortSynopsis
        } else {
          ""
        }

        if (showTitle.isNotEmpty()) {
          entries.add(ScheduleEntry(showTitle, showSubtitle, start, end))
        }
      }

      if (entries.isNotEmpty()) {
        entries.sortBy { it.startMs }
        scheduleCache[serviceId] = entries
      }

      val now = System.currentTimeMillis()
      val current = entries.firstOrNull { streamTime in it.startMs until it.endMs }
      return if (current != null) {
        ShowDetails(current.title, current.subtitle, current.startMs, current.endMs, now)
      } else {
        val upcoming = entries.firstOrNull { it.startMs > streamTime } ?: entries.firstOrNull()
        if (upcoming != null) {
          ShowDetails(upcoming.title, upcoming.subtitle, upcoming.startMs, upcoming.endMs, now)
        } else {
          ShowDetails("", "", 0L, 0L, now)
        }
      }
    } finally {
      try { connection.disconnect() } catch (_: Exception) { }
    }
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
