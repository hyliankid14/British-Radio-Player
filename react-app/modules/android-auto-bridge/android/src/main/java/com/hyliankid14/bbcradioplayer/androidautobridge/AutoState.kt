package com.hyliankid14.bbcradioplayer.androidautobridge

import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject

/**
 * Shared state for the Android Auto media experience.
 *
 * The React application is the single source of truth for the catalogue (stations,
 * subscriptions, podcast episodes, playlists, listening history and preferences).
 * It pushes a compact JSON snapshot to native code via [AndroidAutoBridgeModule.syncState];
 * this store persists it so Android Auto can browse and play even when the JS runtime is
 * not currently running (cold start from the head unit).
 *
 * Mutations performed natively from the car (favourite toggles, subscribe, played
 * markers, playback start/stop) are written to a small overlay so the browse tree updates
 * immediately, and are queued as "mutations" for the JS layer to drain and reconcile.
 */
object AutoState {

  private const val PREFS = "android_auto_state"
  private const val KEY_SNAPSHOT = "snapshot_json"
  private const val KEY_OVERLAY = "overlay_json"
  private const val KEY_MUTATIONS = "pending_mutations"
  private const val MAX_MUTATIONS = 200

  const val ACTION_STATE_CHANGED =
    "com.hyliankid14.bbcradioplayer.react.action.AUTO_STATE_CHANGED"

  private val lock = Any()

  @Volatile private var snapshotCache: JSONObject? = null
  @Volatile private var overlayCache: JSONObject? = null

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ── Snapshot ────────────────────────────────────────────────────────────────

  fun saveSnapshot(context: Context, json: String) {
    synchronized(lock) {
      prefs(context).edit()
        .putString(KEY_SNAPSHOT, json)
        // JS is authoritative: any native overlay (favourite/subscribe/played/progress
        // tweaks made from the car) has either already been drained back into JS via the
        // mutation queue or is superseded by the snapshot we are writing now.
        .remove(KEY_OVERLAY)
        .apply()
      snapshotCache = null
      overlayCache = null
    }
    AutoState.notifyChanged(context)
  }

  fun snapshot(context: Context): JSONObject {
    snapshotCache?.let { return it }
    synchronized(lock) {
      snapshotCache?.let { return it }
      val raw = prefs(context).getString(KEY_SNAPSHOT, null)
      val parsed = if (raw.isNullOrBlank()) JSONObject()
      else try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
      snapshotCache = parsed
      return parsed
    }
  }

  // ── Overlay (native mutations applied on top of the snapshot) ───────────────

  private fun overlay(context: Context): JSONObject {
    overlayCache?.let { return it }
    synchronized(lock) {
      overlayCache?.let { return it }
      val raw = prefs(context).getString(KEY_OVERLAY, null)
      val parsed = if (raw.isNullOrBlank()) JSONObject()
      else try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
      overlayCache = parsed
      return parsed
    }
  }

  private fun updateOverlay(context: Context, mutate: (JSONObject) -> Unit) {
    synchronized(lock) {
      val current = overlay(context)
      mutate(current)
      prefs(context).edit().putString(KEY_OVERLAY, current.toString()).apply()
      overlayCache = current
    }
  }

  // ── Mutations (native -> JS) ────────────────────────────────────────────────

  fun addMutation(context: Context, type: String, payload: JSONObject = JSONObject()) {
    val record = JSONObject().apply {
      put("type", type)
      put("atMs", System.currentTimeMillis())
      put("payload", payload)
    }
    synchronized(lock) {
      val existing = prefs(context).getString(KEY_MUTATIONS, null)
      val array = if (existing.isNullOrBlank()) JSONArray()
      else try { JSONArray(existing) } catch (_: Exception) { JSONArray() }
      array.put(record)
      val trimmed = if (array.length() > MAX_MUTATIONS) {
        JSONArray().also { out -> for (i in array.length() - MAX_MUTATIONS until array.length()) out.put(array.get(i)) }
      } else array
      prefs(context).edit().putString(KEY_MUTATIONS, trimmed.toString()).apply()
    }
    notifyChanged(context)
  }

  fun drainMutations(context: Context): JSONArray {
    synchronized(lock) {
      val existing = prefs(context).getString(KEY_MUTATIONS, null)
      val array = if (existing.isNullOrBlank()) JSONArray()
      else try { JSONArray(existing) } catch (_: Exception) { JSONArray() }
      prefs(context).edit().remove(KEY_MUTATIONS).apply()
      return array
    }
  }

  /** Clears everything; used when the user wipes app data or the JS layer resets. */
  fun clear(context: Context) {
    synchronized(lock) {
      prefs(context).edit().clear().apply()
      snapshotCache = null
      overlayCache = null
    }
    notifyChanged(context)
  }

  fun notifyChanged(context: Context) {
    try {
      val intent = Intent(ACTION_STATE_CHANGED).setPackage(context.packageName)
      context.applicationContext.sendBroadcast(intent)
    } catch (_: Exception) {
    }
  }

  // ── Effective (snapshot + overlay) readers ──────────────────────────────────

  private fun stringList(obj: JSONObject?, key: String): List<String> {
    val array = obj?.optJSONArray(key) ?: return emptyList()
    val out = ArrayList<String>(array.length())
    for (i in 0 until array.length()) {
      val value = array.optString(i, "")
      if (value.isNotEmpty()) out.add(value)
    }
    return out
  }

  private fun effectiveList(context: Context, key: String): List<String> {
    val overlaid = overlay(context).optJSONArray(key)
    return if (overlaid != null) stringList(overlay(context), key) else stringList(snapshot(context), key)
  }

  fun favorites(context: Context): List<String> =
    effectiveList(context, "favorites").ifEmpty { emptyList() }

  fun toggleFavorite(context: Context, stationId: String): Boolean {
    val current = favorites(context).toMutableList()
    val isFav: Boolean
    if (current.contains(stationId)) {
      current.remove(stationId)
      isFav = false
    } else {
      current.add(stationId)
      isFav = true
    }
    updateOverlay(context) { it.put("favorites", JSONArray(current)) }
    addMutation(context, "favoriteToggled", JSONObject().apply {
      put("stationId", stationId)
      put("favorite", isFav)
    })
    notifyChanged(context)
    return isFav
  }

  fun subscriptions(context: Context): List<JSONObject> =
    objectList(context, "subscriptions")

  /** Subscribed podcast ids, preferring native overlay mutations over the snapshot. */
  fun effectiveSubscribedIds(context: Context): List<String> {
    val overlaid = overlay(context).optJSONArray("subscribedIds")
    return if (overlaid != null) stringList(overlay(context), "subscribedIds")
    else stringList(snapshot(context), "subscribedIds")
  }

  fun isSubscribed(context: Context, podcastId: String): Boolean {
    val ids = effectiveSubscribedIds(context)
    if (ids.isNotEmpty()) return ids.contains(podcastId)
    return subscriptions(context).any { it.optString("id") == podcastId }
  }

  fun setSubscribed(context: Context, podcastId: String, subscribed: Boolean) {
    val current = effectiveList(context, "subscribedIds").toMutableList()
    if (subscribed) {
      if (!current.contains(podcastId)) current.add(podcastId)
    } else {
      current.remove(podcastId)
    }
    updateOverlay(context) { it.put("subscribedIds", JSONArray(current)) }
    addMutation(context, "subscribeToggled", JSONObject().apply {
      put("podcastId", podcastId)
      put("subscribed", subscribed)
    })
    notifyChanged(context)
  }

  private fun objectList(context: Context, key: String): List<JSONObject> {
    val array = snapshot(context).optJSONArray(key) ?: return emptyList()
    val out = ArrayList<JSONObject>(array.length())
    for (i in 0 until array.length()) {
      array.optJSONObject(i)?.let { out.add(it) }
    }
    return out
  }

  /** Episodes for a podcast. Falls back to playlist/history/download entries when absent. */
  fun episodes(context: Context, podcastId: String): List<JSONObject> {
    val map = snapshot(context).optJSONObject("episodes") ?: return emptyList()
    val array = map.optJSONArray(podcastId) ?: return emptyList()
    val out = ArrayList<JSONObject>(array.length())
    for (i in 0 until array.length()) {
      array.optJSONObject(i)?.let { out.add(it) }
    }
    return out
  }

  fun saveEpisodes(context: Context, podcastId: String, episodes: List<JSONObject>) {
    synchronized(lock) {
      val snap = snapshot(context)
      val episodesObj = snap.optJSONObject("episodes") ?: JSONObject()
      episodesObj.put(podcastId, JSONArray(episodes))
      snap.put("episodes", episodesObj)
      prefs(context).edit().putString(KEY_SNAPSHOT, snap.toString()).apply()
      snapshotCache = snap
    }
  }

  fun updatePodcastTitle(context: Context, podcastId: String, title: String) {
    if (title.isBlank() || title == podcastId) return
    synchronized(lock) {
      val snap = snapshot(context)
      val subs = snap.optJSONArray("subscriptions") ?: return
      var changed = false
      for (i in 0 until subs.length()) {
        val p = subs.optJSONObject(i) ?: continue
        if (p.optString("id") == podcastId && (p.optString("title") == podcastId || p.optString("title").isBlank())) {
          p.put("title", title)
          changed = true
        }
      }
      if (changed) {
        prefs(context).edit().putString(KEY_SNAPSHOT, snap.toString()).apply()
        snapshotCache = snap
      }
    }
  }

  fun playlists(context: Context): List<JSONObject> = objectList(context, "playlists")

  fun playlistEntries(context: Context, playlistId: String): List<JSONObject> {
    val playlist = playlists(context).firstOrNull { it.optString("id") == playlistId }
      ?: return emptyList()
    val array = playlist.optJSONArray("entries") ?: return emptyList()
    val out = ArrayList<JSONObject>(array.length())
    for (i in 0 until array.length()) {
      array.optJSONObject(i)?.let { out.add(it) }
    }
    return out
  }

  fun downloads(context: Context): List<JSONObject> = objectList(context, "downloads")

  /** True when the episode is in the "Saved Episodes" playlist. */
  fun isEpisodeSaved(context: Context, episodeId: String): Boolean {
    if (episodeId.isEmpty()) return false
    return playlistEntries(context, "saved").any { it.optString("id") == episodeId }
  }

  /** Queues a save/unsave mutation for the JS layer to apply to the Saved Episodes playlist. */
  fun toggleEpisodeSaved(context: Context, episodeJson: JSONObject?, saved: Boolean) {
    val entry = episodeJson ?: return
    addMutation(
      context,
      "savedToggled",
      JSONObject().apply {
        put("saved", saved)
        put("entry", entry)
      }
    )
  }

  fun history(context: Context): List<JSONObject> = objectList(context, "history")

  fun playedIds(context: Context): List<String> = effectiveList(context, "playedIds")

  fun isPlayed(context: Context, episodeId: String): Boolean =
    playedIds(context).contains(episodeId)

  fun markPlayed(context: Context, episodeId: String, podcastId: String?, pubDateEpochMs: Long?) {
    val current = playedIds(context).toMutableList()
    val newly = !current.contains(episodeId)
    if (newly) {
      current.add(episodeId)
      updateOverlay(context) { it.put("playedIds", JSONArray(current)) }
      // Completing an episode clears any saved resume position (parity with Kotlin).
      removeProgress(context, episodeId)
    }
    if (pubDateEpochMs != null && pubDateEpochMs > 0L && !podcastId.isNullOrEmpty()) {
      val existing = lastPlayedEpoch(context, podcastId)
      if (pubDateEpochMs > existing) {
        updateOverlay(context) { it.put("lastPlayedEpoch", progressObject(context, "lastPlayedEpoch").put(podcastId, pubDateEpochMs)) }
      }
    }
    if (newly) {
      addMutation(context, "episodePlayed", JSONObject().apply {
        put("episodeId", episodeId)
        put("podcastId", podcastId ?: "")
        put("pubDateEpochMs", pubDateEpochMs ?: 0L)
        put("played", true)
      })
    }
  }

  private fun progressObject(context: Context, key: String): JSONObject {
    val fromOverlay = overlay(context).optJSONObject(key)
    if (fromOverlay != null) return fromOverlay
    val fromSnapshot = snapshot(context).optJSONObject(key)
    return fromSnapshot ?: JSONObject()
  }

  fun progress(context: Context, episodeId: String): Long =
    progressObject(context, "progress").optLong(episodeId, 0L)

  fun setProgress(context: Context, episodeId: String, positionMs: Long) {
    if (positionMs <= 0L) return
    updateOverlay(context) {
      it.put("progress", progressObject(context, "progress").put(episodeId, positionMs))
    }
  }

  fun removeProgress(context: Context, episodeId: String) {
    updateOverlay(context) {
      val obj = progressObject(context, "progress")
      obj.remove(episodeId)
      it.put("progress", obj)
    }
  }

  fun lastPlayedEpoch(context: Context, podcastId: String): Long =
    progressObject(context, "lastPlayedEpoch").optLong(podcastId, 0L)

  // ── Preferences ─────────────────────────────────────────────────────────────

  fun settingString(context: Context, key: String, fallback: String = ""): String {
    val value = snapshot(context).optString(key, "")
    return value.ifEmpty { fallback }
  }

  fun settingBoolean(context: Context, key: String, fallback: Boolean = false): Boolean =
    if (snapshot(context).has(key)) snapshot(context).optBoolean(key, fallback) else fallback

  fun settingInt(context: Context, key: String, fallback: Int = 0): Int =
    if (snapshot(context).has(key)) snapshot(context).optInt(key, fallback) else fallback

  // ── Stream candidates (parity with StationRepository.getStreamCandidates) ───

  fun bitrateFor(quality: String): String = when (quality.uppercase()) {
    "HIGH" -> "320000"
    "MEDIUM" -> "128000"
    "LOW" -> "48000"
    else -> "128000"
  }

  fun streamCandidates(
    station: JSONObject,
    quality: String,
    geoBlocked: Boolean
  ): List<String> {
    val requested = bitrateFor(quality)
    val fallbackBitrates = listOf("128000", "96000", "48000", "320000")
    val direct = stringList(station, "directStreamUrls").filter { it.isNotBlank() }
    val serviceIds = stringList(station, "streamServiceIds").filter { it.isNotBlank() }
    val candidates = LinkedHashSet<String>()

    for (url in direct) {
      if (url.contains("&uk=1") && url.contains("bitrate=$requested")) candidates.add(url)
    }

    if (geoBlocked) {
      for (url in direct) if (!url.contains("&uk=1")) candidates.add(url)
      for (sid in serviceIds) candidates.add("$BBC_HLS_NONUK/$sid.m3u8")
      return candidates.toList()
    }

    for (url in direct) {
      if (url.contains("&uk=1") && !url.contains("bitrate=$requested")) candidates.add(url)
    }
    for (sid in serviceIds) {
      for (bitrate in fallbackBitrates) {
        candidates.add("$STREAM_BASE?station=$sid&bitrate=$bitrate")
      }
    }
    for (sid in serviceIds) candidates.add("$BBC_HLS_UK/$sid.m3u8")
    for (url in direct) if (!url.contains("&uk=1")) candidates.add(url)
    for (sid in serviceIds) candidates.add("$BBC_HLS_NONUK/$sid.m3u8")

    return candidates.toList()
  }

  const val BBC_HLS_UK =
    "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/pc_hd_abr_v2/cf"
  const val BBC_HLS_NONUK =
    "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/nonuk/pc_hd_abr_v2/cf"
  const val STREAM_BASE = "https://lsn.lv/bbcradio.m3u8"
}
