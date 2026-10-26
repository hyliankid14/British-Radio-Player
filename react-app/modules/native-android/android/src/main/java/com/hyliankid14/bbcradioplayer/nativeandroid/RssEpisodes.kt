package com.hyliankid14.bbcradioplayer.nativeandroid

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLDecoder
import java.time.OffsetDateTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Parses a podcast RSS feed into the episode shape the React app uses.
 *
 * This is a port of `fetchEpisodes` in `src/api/podcasts.ts`, kept deliberately close: the
 * background worker stores what it parses here, and JS adopts those records verbatim, so any
 * divergence in episode ids or field values would split the same episode across two caches and
 * duplicate its notification.
 *
 * Only the fields the app actually reads from a feed are extracted.
 */
object RssEpisodes {

  /** Mirrors `Episode` in `src/api/podcasts.ts`. */
  data class Episode(
    val id: String,
    val title: String,
    val description: String,
    val audioUrl: String,
    val imageUrl: String,
    val pubDate: String,
    val durationMins: Int,
    val podcastId: String
  )

  /** Descriptions are truncated to this many characters before persisting; must match
   *  `MAX_SNAPSHOT_DESCRIPTION_CHARS` in `src/storage/preferences.ts`. */
  private const val MAX_DESCRIPTION_CHARS = 400

  /** Same cap as `MAX_EPISODES_PER_SNAPSHOT` in `src/storage/preferences.ts`. */
  const val MAX_EPISODES = 60

  // ── Feed parsing ──────────────────────────────────────────────────────────

  fun parse(feed: String, podcastId: String): List<Episode> {
    val channelImage = channelImageUrl(feed)
    val episodes = mutableListOf<Episode>()
    for (item in itemBlocks(feed)) {
      val title = tag(item, "title").let { decode(it) }
      var description = decode(tag(item, "description"))
      if (description.isEmpty()) description = decode(tag(item, "itunes:summary"))
      val audioUrl = episodeAudioUrl(item)
      if (title.isEmpty() || audioUrl.isEmpty()) continue

      // The fallback id counts accepted episodes, not raw items, so it matches the JS
      // parser's `${podcastId}-${episodes.length}` exactly. A rejected item shifts nothing.
      val guid = tag(item, "guid")
      val id = normalizeEpisodeId(guid).ifEmpty { "$podcastId-${episodes.size}" }
      val image = itemImageUrl(item).ifEmpty { channelImage }

      episodes += Episode(
        id = id,
        title = title,
        description = description.take(MAX_DESCRIPTION_CHARS),
        audioUrl = audioUrl,
        imageUrl = image,
        pubDate = tag(item, "pubDate"),
        durationMins = parseDurationMinutes(tag(item, "itunes:duration")),
        podcastId = podcastId
      )
    }
    return sortByNewestFirst(episodes).take(MAX_EPISODES)
  }

  /** The newest episode of a parsed list, or null when the feed carried none. */
  fun latest(episodes: List<Episode>): Episode? = sortByNewestFirst(episodes).firstOrNull()

  /** Serialises episodes in the field names `src/api/podcasts.ts` parses back. */
  fun toJson(episodes: List<Episode>): JSONArray {
    val array = JSONArray()
    for (episode in episodes) {
      array.put(
        JSONObject()
          .put("id", episode.id)
          .put("title", episode.title)
          .put("description", episode.description)
          .put("audioUrl", episode.audioUrl)
          .put("imageUrl", episode.imageUrl)
          .put("pubDate", episode.pubDate)
          .put("durationMins", episode.durationMins)
          .put("podcastId", episode.podcastId)
      )
    }
    return array
  }

  // ── Item extraction ───────────────────────────────────────────────────────

  /** Every `<item>...</item>` body, in document order. */
  private fun itemBlocks(feed: String): List<String> {
    val blocks = mutableListOf<String>()
    var cursor = 0
    while (true) {
      val start = feed.indexOf("<item", cursor).takeIf { it != -1 } ?: break
      val tagClose = feed.indexOf(">", start).takeIf { it != -1 } ?: break
      val end = feed.indexOf("</item>", tagClose).takeIf { it != -1 } ?: break
      blocks += feed.substring(tagClose + 1, end)
      cursor = end + "</item>".length
    }
    return blocks
  }

  /**
   * The text of the first [tag] element in [block].
   *
   * Attribute-bearing openers (`<guid isPermaLink="false">`) are handled by skipping to the
   * end of the opening tag rather than matching the literal `<tag>`.
   */
  private fun tag(block: String, tag: String): String {
    val open = "<$tag"
    val start = block.indexOf(open).takeIf { it != -1 } ?: return ""
    val contentStart = block.indexOf(">", start).takeIf { it != -1 }?.plus(1) ?: return ""
    val close = block.indexOf("</$tag>", contentStart).takeIf { it != -1 } ?: return ""
    return stripCdata(block.substring(contentStart, close)).trim()
  }

  private fun stripCdata(value: String): String {
    var result = value
    if (result.startsWith("<![CDATA[")) {
      result = result.substring(9)
      val end = result.indexOf("]]>")
      if (end != -1) result = result.substring(0, end)
    }
    return result
  }

  /** The channel artwork, from `<image><url>` with `<itunes:image href>` as fallback. */
  private fun channelImageUrl(feed: String): String {
    val channelStart = feed.indexOf("<channel")
    if (channelStart == -1) return ""
    val imageStart = feed.indexOf("<image>", channelStart)
    if (imageStart != -1) {
      val imageEnd = feed.indexOf("</image>", imageStart)
      val urlStart = feed.indexOf("<url>", imageStart)
      if (imageEnd != -1 && urlStart != -1 && urlStart < imageEnd) {
        val urlEnd = feed.indexOf("</url>", urlStart)
        if (urlEnd != -1) return https(feed.substring(urlStart + 5, urlEnd).trim())
      }
    }
    val itunes = feed.indexOf("<itunes:image", channelStart)
    if (itunes != -1) return href(feed, itunes)
    return ""
  }

  private fun itemImageUrl(item: String): String {
    val itunes = item.indexOf("<itunes:image")
    return if (itunes == -1) "" else href(item, itunes)
  }

  private fun href(block: String, from: Int): String {
    val start = block.indexOf("href=\"", from)
    if (start == -1) return ""
    val end = block.indexOf('"', start + 6)
    return if (end == -1) "" else https(block.substring(start + 6, end).trim())
  }

  /**
   * The episode's audio file, preferring the HTTPS `ppg:enclosureSecure` the BBC adds over the
   * plain `<enclosure>`.
   */
  private fun episodeAudioUrl(item: String): String {
    val secure = enclosureUrl(item, "<ppg:enclosureSecure")
    if (secure.isNotEmpty()) return normalizeBbcAudioUrl(secure)
    val plain = enclosureUrl(item, "<enclosure")
    return if (plain.isEmpty()) "" else normalizeBbcAudioUrl(plain)
  }

  private fun enclosureUrl(block: String, opener: String): String {
    val start = block.indexOf(opener)
    if (start == -1) return ""
    val urlStart = block.indexOf("url=\"", start)
    if (urlStart == -1) return ""
    val urlEnd = block.indexOf('"', urlStart + 5)
    return if (urlEnd == -1) "" else block.substring(urlStart + 5, urlEnd).trim()
  }

  // ── Values ────────────────────────────────────────────────────────────────

  /**
   * Reduces a feed GUID to the canonical BBC PID.
   *
   * Port of `normalizeEpisodeId` in `src/downloads/downloadLimits.ts`, including the character
   * class the candidate must match — a URL-shaped tail is left alone rather than truncated to
   * junk.
   */
  fun normalizeEpisodeId(rawId: String?): String {
    if (rawId.isNullOrBlank()) return ""
    var decoded = rawId.trim()
    if (decoded.contains('%')) {
      decoded = try {
        URLDecoder.decode(decoded, "UTF-8")
      } catch (_: Exception) {
        decoded
      }
    }
    val delimiter = maxOf(decoded.lastIndexOf('/'), decoded.lastIndexOf(':'))
    if (delimiter != -1 && delimiter < decoded.length - 1) {
      val candidate = decoded.substring(delimiter + 1).trim()
      if (candidate.matches(Regex("^[a-z0-9_-]+$", RegexOption.IGNORE_CASE))) return candidate
    }
    return decoded
  }

  /**
   * Port of `parseDurationSeconds` in `src/api/podcasts.ts`.
   *
   * Deliberately literal rather than "correct": a divergent duration would make the same
   * episode read differently depending on which side fetched its feed.
   */
  private fun parseDurationMinutes(duration: String): Int {
    if (duration.isEmpty()) return 0
    if (duration.contains(':')) {
      val parts = duration.split(':').map { parseIntPrefix(it) ?: 0 }
      // Three fields are hh:mm:ss and two are mm:ss, but the JS original folds both to
      // `hours * 60 + minutes`, so the port keeps that quirk rather than fixing one side only.
      if (parts.size == 3) return parts[0] * 60 + parts[1]
      if (parts.size == 2) return parts[0]
    }
    val secs = parseIntPrefix(duration) ?: return 0
    return Math.round(secs / 60.0).toInt()
  }

  /**
   * JavaScript's `parseInt` semantics: read a leading integer and ignore whatever follows.
   *
   * Needed because a feed carrying `1800.5` parses to `1800` in JS but `null` from Kotlin's
   * `toIntOrNull`, and a divergent `durationMins` would make the same episode render a
   * different length depending on which side fetched it.
   */
  private fun parseIntPrefix(value: String): Int? =
    Regex("^\\s*[-+]?\\d+").find(value)?.value?.trim()?.toIntOrNull()

  /** Strip markup, then decode entities — the order `decodeXmlEntities` uses. */
  fun decode(value: String): String {
    if (value.isEmpty()) return ""
    var result = value.replace(Regex("<[^>]*>"), "")
      .replace("&amp;", "&")
      .replace("&lt;", "<")
      .replace("&gt;", ">")
      .replace("&quot;", "\"")
      .replace("&#39;", "'")
      .replace("&apos;", "'")
      .replace("&nbsp;", " ")
    // Double-encoded entities, which the JS decoder unwraps a second time.
    if (result.contains("&amp;")) result = result.replace("&amp;", "&")
    return result.trim()
  }

  /** Epoch ms for an RFC 2822 `pubDate`, or 0 when absent or unparseable. */
  fun pubDateEpoch(pubDate: String?): Long {
    if (pubDate.isNullOrBlank()) return 0
    val trimmed = pubDate.trim()
    try {
      return ZonedDateTime.parse(trimmed, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
    } catch (_: Exception) {
      // Some BBC feeds omit the day or carry a bare YYYY-MM-DD.
    }
    for (pattern in listOf("EEE, dd MMM yyyy HH:mm:ss Z", "EEE, dd MMM yyyy HH:mm Z", "yyyy-MM-dd")) {
      try {
        val parsed = DateTimeFormatter.ofPattern(pattern, Locale.ENGLISH)
        return try {
          OffsetDateTime.parse(trimmed, parsed).toInstant().toEpochMilli()
        } catch (_: Exception) {
          ZonedDateTime.parse(trimmed, parsed).toInstant().toEpochMilli()
        }
      } catch (_: Exception) {
        // Try the next shape.
      }
    }
    return 0
  }

  /**
   * Newest first, with undated episodes last.
   *
   * Matches `byNewestFirst` in `src/podcasts/episodeDates.ts`: a bare descending compare would
   * put a `0` date at the *top*, which is how an episode with no `pubDate` would end up
   * advertised as the newest.
   */
  private fun sortByNewestFirst(episodes: List<Episode>): List<Episode> {
    val dated = episodes.map { it to pubDateEpoch(it.pubDate) }
    val sorted = dated.sortedWith(
      Comparator { left, right ->
        val a = left.second
        val b = right.second
        when {
          a <= 0L && b <= 0L -> 0
          a <= 0L -> 1
          b <= 0L -> -1
          else -> b.compareTo(a)
        }
      }
    )
    return sorted.map { it.first }
  }

  private fun https(url: String): String =
    if (url.startsWith("http://", ignoreCase = true)) "https://" + url.substring(7) else url

  /** Port of `normalizeBbcAudioUrl` in `src/utils/shareLinks.ts`. */
  private fun normalizeBbcAudioUrl(audioUrl: String): String =
    audioUrl.trim()
      .replace(Regex("^http://", RegexOption.IGNORE_CASE), "https://")
      .replace(Regex("/proto/http/", RegexOption.IGNORE_CASE), "/proto/https/")
      .replace(Regex("/mediaselector/b\\d+/", RegexOption.IGNORE_CASE), "/mediaselector/6/")
}
