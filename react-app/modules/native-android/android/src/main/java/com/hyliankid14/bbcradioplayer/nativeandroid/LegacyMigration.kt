package com.hyliankid14.bbcradioplayer.nativeandroid

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Reads the SharedPreferences written by the legacy Kotlin application and converts them
 * into the key/value shape used by the React application's MMKV store.
 *
 * The React app shares the legacy application ID (`com.hyliankid14.bbcradioplayer`) so an
 * in-place OS upgrade preserves this data. The JS layer writes the returned object into
 * MMKV once, then sets `pref_native_migrated` so the conversion never runs again.
 */
object LegacyMigration {

  private const val KEY_LEGACY_MIGRATED = "pref_native_migrated"

  /** Preference file names used by the legacy app. */
  private val LEGACY_FILES = listOf(
    "favorites_prefs",
    "podcast_subscriptions",
    "podcast_playlists_prefs",
    "saved_episodes_prefs",
    "saved_searches_prefs",
    "played_episodes_prefs",
    "played_history_prefs",
    "playback_prefs",
    "scrolling_prefs",
    "index_prefs",
    "subscription_refresh_prefs",
    "podcast_filter_prefs",
    "theme_prefs",
    "download_prefs",
    "podcast_episode_sort_prefs",
    "podcast_tags_prefs",
    "subscribed_podcast_sort_prefs",
    "playlist_sort_prefs",
    "search_history_prefs",
    "recent_songs_prefs",
    "downloaded_episodes_prefs",
    "alarm_prefs",
    "startup_prefs",
    "lastfm_prefs",
    "widget_prefs",
    "privacy_analytics"
  )

  private fun prefs(context: Context, name: String): SharedPreferences =
    context.getSharedPreferences(name, Context.MODE_PRIVATE)

  private fun stringSet(context: Context, name: String, key: String): Set<String> =
    prefs(context, name).getStringSet(key, emptySet()) ?: emptySet()

  private fun toJsonArray(values: Collection<String>): String {
    val array = JSONArray()
    values.forEach { array.put(it) }
    return array.toString()
  }

  /** Returns true when the legacy Kotlin app left any recognisable preference data behind. */
  fun hasLegacyData(context: Context): Boolean {
    for (name in LEGACY_FILES) {
      val stored = try {
        prefs(context, name).all
      } catch (_: Exception) {
        emptyMap<String, Any?>()
      }
      if (stored.isNotEmpty()) return true
    }
    return false
  }

  /**
   * Builds the MMKV key/value map from the legacy preferences. Values are strings,
   * booleans, numbers, or JSON-encoded strings (matching how the JS store persists them).
   */
  fun readLegacyPreferences(context: Context): JSONObject {
    val out = JSONObject()
    val playlistEntries = JSONObject()

    // ── Favourites ──────────────────────────────────────────────────────────
    val favouriteSet = stringSet(context, "favorites_prefs", "favorite_stations")
    val favouriteOrder = prefs(context, "favorites_prefs")
      .getString("favorite_stations_order_string", null)
      ?.split(",")
      ?.filter { it.isNotBlank() }
      ?: emptyList()
    val orderedFavourites = if (favouriteOrder.isNotEmpty()) {
      (favouriteOrder + favouriteSet).distinct()
    } else {
      favouriteSet.toList()
    }
    if (orderedFavourites.isNotEmpty()) {
      out.put("pref_favorite_stations", toJsonArray(orderedFavourites))
    }

    // ── Podcast subscriptions ───────────────────────────────────────────────
    val subscribedIds = stringSet(context, "podcast_subscriptions", "subscribed_ids")
    if (subscribedIds.isNotEmpty()) {
      out.put("pref_subscribed_podcasts", toJsonArray(subscribedIds))
    }
    val notificationsEnabled = stringSet(context, "podcast_subscriptions", "notifications_enabled")
    notificationsEnabled.forEach { id ->
      if (id.isNotBlank()) out.put("pref_podcast_notifications_$id", true)
    }

    // ── Playlists (Saved Episodes + user playlists) ──────────────────────────
    val playlistsRaw = prefs(context, "podcast_playlists_prefs").getString("playlists", null)
    val userPlaylists = JSONArray()
    if (!playlistsRaw.isNullOrBlank()) {
      try {
        val parsed = JSONArray(playlistsRaw)
        for (i in 0 until parsed.length()) {
          val playlist = parsed.optJSONObject(i) ?: continue
          val id = playlist.optString("id", "")
          if (id.isBlank()) continue
          val isDefault = playlist.optBoolean("isDefault", id == "saved")
          val entriesArray = playlist.optJSONArray("entries") ?: JSONArray()
          val converted = JSONArray()
          for (e in 0 until entriesArray.length()) {
            val entry = entriesArray.optJSONObject(e) ?: continue
            converted.put(convertSavedEntry(entry))
          }
          playlistEntries.put(id, converted)
          if (!isDefault && id != "saved" && id != "downloaded") {
            userPlaylists.put(JSONObject().apply {
              put("id", id)
              put("name", playlist.optString("name", "Playlist"))
              put("isDefault", false)
              put("itemCount", converted.length())
            })
          }
        }
      } catch (_: Exception) {
      }
    }
    // Legacy saved episodes predate the playlists store; fold them into the default playlist.
    if (playlistEntries.optJSONArray("saved") == null) {
      val legacySaved = readLegacySavedEpisodes(context)
      if (legacySaved.length() > 0) playlistEntries.put("saved", legacySaved)
    }
    if (playlistEntries.length() > 0) {
      out.put("pref_podcast_playlist_entries", playlistEntries.toString())
    }
    if (userPlaylists.length() > 0) {
      out.put("pref_podcast_playlists", userPlaylists.toString())
    }

    // ── Saved podcast searches ──────────────────────────────────────────────
    val savedSearchesRaw = prefs(context, "saved_searches_prefs").getString("saved_searches_json", null)
    if (!savedSearchesRaw.isNullOrBlank()) {
      try {
        val parsed = JSONArray(savedSearchesRaw)
        val converted = JSONArray()
        for (i in 0 until parsed.length()) {
          val search = parsed.optJSONObject(i) ?: continue
          val query = search.optString("query", "")
          if (query.isBlank()) continue
          val lastMatch = search.optLong("lastMatchEpoch", 0L)
          converted.put(JSONObject().apply {
            put("id", search.optString("id", "search-${System.currentTimeMillis()}-$i"))
            put("name", search.optString("name", query))
            put("query", query)
            put("notificationsEnabled", search.optBoolean("notificationsEnabled", false))
            if (lastMatch > 0) put("latestResultDate", isoFromEpoch(lastMatch))
          })
        }
        out.put("pref_saved_podcast_searches", converted.toString())
      } catch (_: Exception) {
      }
    }

    // ── Played episodes, progress, last-played epochs, sort order ────────────
    val playedIds = stringSet(context, "played_episodes_prefs", "played_ids")
    if (playedIds.isNotEmpty()) {
      out.put("pref_played_episode_ids", toJsonArray(playedIds))
    }

    val progressMap = JSONObject()
    val lastPlayedMap = JSONObject()
    val sortMap = JSONObject()
    val playedPrefs = try { prefs(context, "played_episodes_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }
    playedPrefs.forEach { (key, value) ->
      when {
        key.startsWith("progress_") -> {
          val id = key.removePrefix("progress_")
          val ms = asLong(value)
          if (ms > 0) progressMap.put(id, ms / 1000L)
        }
        key.startsWith("last_played_epoch_") -> {
          val id = key.removePrefix("last_played_epoch_")
          val epoch = asLong(value)
          if (epoch > 0) lastPlayedMap.put(id, epoch)
        }
      }
    }
    if (progressMap.length() > 0) out.put("pref_episode_progress", progressMap.toString())
    if (lastPlayedMap.length() > 0) out.put("pref_last_played_epoch", lastPlayedMap.toString())

    val sortPrefs = try { prefs(context, "podcast_episode_sort_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }
    sortPrefs.forEach { (key, value) ->
      if (key.startsWith("episode_sort_order_")) {
        val id = key.removePrefix("episode_sort_order_")
        sortMap.put(id, if (value == "oldest_first") "oldest_first" else "newest_first")
      }
    }
    if (sortMap.length() > 0) out.put("pref_podcast_episode_sort", sortMap.toString())

    // ── Playback history ────────────────────────────────────────────────────
    val historyRaw = prefs(context, "played_history_prefs").getString("history_json", null)
    if (!historyRaw.isNullOrBlank()) {
      try {
        out.put("pref_podcast_history", JSONArray(historyRaw).toString())
      } catch (_: Exception) {
      }
    }

    // ── Recent songs ────────────────────────────────────────────────────────
    val songsRaw = prefs(context, "recent_songs_prefs").getString("songs_json", null)
    if (!songsRaw.isNullOrBlank()) {
      try {
        out.put("pref_recent_songs", JSONArray(songsRaw).toString())
      } catch (_: Exception) {
      }
    }

    // ── Recent podcast searches ─────────────────────────────────────────────
    val historyList = prefs(context, "search_history_prefs").getString("history_list", null)
    if (!historyList.isNullOrBlank()) {
      val queries = historyList.split("\u001F").filter { it.isNotBlank() }
      if (queries.isNotEmpty()) out.put("pref_recent_podcast_searches", toJsonArray(queries))
    }

    // ── Podcast tags ────────────────────────────────────────────────────────
    val tagMapRaw = prefs(context, "podcast_tags_prefs").getString("tag_map", null)
    if (!tagMapRaw.isNullOrBlank()) {
      try {
        val tagMap = JSONObject(tagMapRaw)
        tagMap.keys().forEach { podcastId ->
          val tags = tagMap.optJSONArray(podcastId) ?: return@forEach
          val list = mutableListOf<String>()
          for (i in 0 until tags.length()) {
            val tag = tags.optString(i, "")
            if (tag.isNotBlank()) list.add(tag)
          }
          out.put("pref_podcast_tags_$podcastId", toJsonArray(list))
        }
      } catch (_: Exception) {
      }
    }

    // ── Subscribed podcast sort ─────────────────────────────────────────────
    val subscribedSort = prefs(context, "subscribed_podcast_sort_prefs").getString("sort_order", null)
    if (!subscribedSort.isNullOrBlank()) out.put("pref_subscribed_podcast_sort", subscribedSort)
    val manualOrderRaw = prefs(context, "subscribed_podcast_sort_prefs").getString("manual_order", null)
    if (!manualOrderRaw.isNullOrBlank()) {
      try {
        out.put("pref_subscribed_podcast_manual_order", JSONArray(manualOrderRaw).toString())
      } catch (_: Exception) {
      }
    }

    // ── Theme / audio quality ───────────────────────────────────────────────
    val theme = prefs(context, "theme_prefs").getString("selected_theme", null)
    if (theme == "light" || theme == "dark" || theme == "system") out.put("pref_theme_mode", theme)
    val quality = prefs(context, "theme_prefs").getString("audio_quality", null)
    val mappedQuality = when (quality) {
      "320kbps" -> "HIGH"
      "128kbps" -> "MEDIUM"
      "96kbps", "48kbps" -> "LOW"
      else -> null
    }
    if (mappedQuality != null) out.put("pref_audio_quality", mappedQuality)
    if (prefs(context, "theme_prefs").contains("auto_detect_quality")) {
      out.put("pref_auto_quality", prefs(context, "theme_prefs").getBoolean("auto_detect_quality", true))
    }

    // ── Playback preferences ────────────────────────────────────────────────
    val playback = try { prefs(context, "playback_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }
    copyString(playback, "last_station_id", out, "pref_last_station_id")
    copyBoolean(playback, "auto_resume_android_auto", out, "pref_carplay_auto_resume")
    copyBoolean(playback, "hide_played_android_auto", out, "pref_carplay_hide_played")
    copyBoolean(playback, "hide_played_playlists", out, "pref_hide_played_episodes_in_playlists")
    copyBoolean(playback, "shake_random_podcast", out, "pref_shake_random")
    copyString(playback, "podcast_artwork_source", out, "pref_podcast_artwork")
    copyString(playback, "autoplay_next_episode", out, "pref_autoplay_next")
    copyBoolean(playback, "stop_on_bluetooth_disconnect", out, "pref_stop_bluetooth")
    copyBoolean(playback, "live_radio_pause_buffering", out, "pref_pause_buffering")
    copyString(playback, "default_android_auto_station_id", out, "pref_default_android_auto_station")

    // ── Simple settings files ───────────────────────────────────────────────
    copyString(try { prefs(context, "scrolling_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }, "scroll_mode", out, "pref_scroll_mode")
    copyBoolean(try { prefs(context, "index_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }, "new_podcast_notifications_enabled", out, "pref_index_notifications")
    copyNumber(try { prefs(context, "index_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }, "index_interval_days", out, "pref_index_interval_days")
    copyNumber(try { prefs(context, "subscription_refresh_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }, "refresh_interval_minutes", out, "pref_subscription_refresh")
    copyBoolean(try { prefs(context, "podcast_filter_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }, "exclude_non_english", out, "pref_exclude_non_english")
    val downloads = try { prefs(context, "download_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }
    copyBoolean(downloads, "auto_download_enabled", out, "pref_auto_download")
    copyNumber(downloads, "auto_download_limit", out, "pref_auto_download_limit")
    copyBoolean(downloads, "download_on_wifi_only", out, "pref_download_wifi")
    copyBoolean(downloads, "delete_on_played", out, "pref_delete_played")
    copyBoolean(downloads, "auto_download_saved", out, "pref_auto_download_saved")

    // ── Alarm ───────────────────────────────────────────────────────────────
    val alarm = try { prefs(context, "alarm_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }
    copyBoolean(alarm, "alarm_enabled", out, "pref_alarm_enabled")
    copyNumber(alarm, "alarm_hour", out, "pref_alarm_hour")
    copyNumber(alarm, "alarm_minute", out, "pref_alarm_minute")
    copyString(alarm, "alarm_station_id", out, "pref_alarm_station")
    copyBoolean(alarm, "alarm_enable_volume_ramp", out, "pref_alarm_ramp")
    copyNumber(alarm, "alarm_manual_volume", out, "pref_alarm_volume")
    copyNumber(alarm, "alarm_days_of_week", out, "pref_alarm_days")

    // ── Startup page ────────────────────────────────────────────────────────
    copyString(try { prefs(context, "startup_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }, "startup_page", out, "pref_startup_page")

    // ── Last.fm ─────────────────────────────────────────────────────────────
    val lastfm = try { prefs(context, "lastfm_prefs").all } catch (_: Exception) { emptyMap<String, Any?>() }
    copyString(lastfm, "session_key", out, "pref_lastfm_session_key")
    copyString(lastfm, "username", out, "pref_lastfm_username")
    copyBoolean(lastfm, "direct_scrobble_enabled", out, "pref_lastfm_direct")
    copyBoolean(lastfm, "broadcast_scrobble_enabled", out, "pref_lastfm_broadcast")
    copyBoolean(lastfm, "scrobble_podcasts", out, "pref_lastfm_podcasts")
    copyString(lastfm, "last_scrobbled_track", out, "pref_lastfm_last_scrobbled")

    // ── Privacy Analytics ───────────────────────────────────────────────────
    val analytics = try { prefs(context, "privacy_analytics").all } catch (_: Exception) { emptyMap<String, Any?>() }
    copyBoolean(analytics, "analytics_enabled", out, "pref_analytics")
    val firstRun = analytics["analytics_first_run"] as? Boolean
    if (firstRun != null) {
      out.put("pref_analytics_prompted", !firstRun)
    }
    copyString(analytics, "anon_install_id", out, "pref_anon_install_id")

    // ── Downloads (episode files) ───────────────────────────────────────────
    val downloadedSet = stringSet(context, "downloaded_episodes_prefs", "downloaded_set")
    if (downloadedSet.isNotEmpty()) {
      val map = JSONObject()
      for (raw in downloadedSet) {
        try {
          val entry = JSONObject(raw)
          val id = entry.optString("id", "")
          if (id.isBlank()) continue
          val localPath = entry.optString("localFilePath", "")
          map.put(id, JSONObject().apply {
            put("localUri", if (localPath.isBlank()) "" else "file://$localPath")
            put("sizeBytes", entry.optLong("fileSizeBytes", 0L))
            put("downloadedAtMs", entry.optLong("downloadedAtMs", 0L))
            put("entry", convertSavedEntry(entry))
          })
        } catch (_: Exception) {
        }
      }
      if (map.length() > 0) out.put("pref_downloaded_episodes", map.toString())
    }

    return out
  }

  private fun readLegacySavedEpisodes(context: Context): JSONArray {
    val set = stringSet(context, "saved_episodes_prefs", "saved_set")
    val array = JSONArray()
    for (raw in set) {
      try {
        array.put(convertSavedEntry(JSONObject(raw)))
      } catch (_: Exception) {
      }
    }
    return array
  }

  /** Converts a legacy playlist/download entry into the React `SavedEpisodeEntry` shape. */
  private fun convertSavedEntry(entry: JSONObject): JSONObject {
    val savedAt = entry.optLong("savedAtMs", entry.optLong("downloadedAtMs", 0L))
    return JSONObject().apply {
      put("id", entry.optString("id", ""))
      put("title", entry.optString("title", ""))
      put("description", entry.optString("description", ""))
      put("imageUrl", entry.optString("imageUrl", ""))
      put("audioUrl", entry.optString("audioUrl", ""))
      put("pubDate", entry.optString("pubDate", ""))
      put("durationMins", entry.optInt("durationMins", 0))
      put("podcastId", entry.optString("podcastId", ""))
      put("podcastTitle", entry.optString("podcastTitle", ""))
      if (savedAt > 0) put("savedAtMs", savedAt)
    }
  }

  private fun asLong(value: Any?): Long = when (value) {
    is Number -> value.toLong()
    is String -> value.toLongOrNull() ?: 0L
    else -> 0L
  }

  private fun copyString(source: Map<String, Any?>, from: String, target: JSONObject, to: String) {
    val value = source[from]
    if (value is String && value.isNotBlank()) target.put(to, value)
  }

  private fun copyBoolean(source: Map<String, Any?>, from: String, target: JSONObject, to: String) {
    val value = source[from]
    if (value is Boolean) target.put(to, value)
  }

  private fun copyNumber(source: Map<String, Any?>, from: String, target: JSONObject, to: String) {
    val value = source[from]
    if (value is Number) target.put(to, value)
  }

  private fun isoFromEpoch(epochMs: Long): String =
    java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
      .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
      .format(java.util.Date(epochMs))

  const val MIGRATION_FLAG_KEY = KEY_LEGACY_MIGRATED
}
