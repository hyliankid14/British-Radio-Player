package com.hyliankid14.bbcradioplayer.nativeandroid

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Persists the subscription snapshot used by the background worker, the episode lists it
 * resolves, and the schedule for the periodic new-episode check.
 *
 * Everything here lives in the worker's own [android.content.SharedPreferences], not the
 * React app's MMKV store, because the MMKV instance belongs to the Nitro layer on the JS
 * side. The worker therefore hands its parsed feeds back as JSON and JS adopts them into MMKV
 * via `NativeAndroidModule.getBackgroundEpisodeSnapshots`; see `applyBackgroundEpisodeSnapshots`
 * in `src/background/backgroundSync.ts`.
 */
object BackgroundSync {

  private const val PREFS = "bg_sync_prefs"
  private const val KEY_ENABLED = "enabled"
  private const val KEY_WIFI_ONLY = "wifi_only"
  private const val KEY_SUBSCRIPTIONS = "subscriptions_json"
  private const val KEY_NOTIFIED = "notified_episode_ids"
  private const val WORK_NAME = "bbc_radio_index_refresh"

  /** Prefix for the per-podcast episode list the worker resolved on its last run. */
  private const val EPISODE_PREFIX = "eps_"

  /** Bumped every time a snapshot is stored, so JS can tell whether there is anything new. */
  private const val KEY_REVISION = "episodes_revision"

  /** Must match `MAX_EPISODES_PER_SNAPSHOT` in `src/podcasts/episodeSnapshot.ts`. */
  private const val MAX_EPISODES_PER_SNAPSHOT = RssEpisodes.MAX_EPISODES

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /**
   * @property notify True when the user has armed the bell for this show, i.e. the worker may
   * post a notification for it. The worker refreshes and stores episodes for **every**
   * subscription regardless, so an unarmed subscription still keeps the in-car list fresh.
   */
  data class Subscription(val id: String, val title: String, val rssUrl: String, val notify: Boolean)

  /**
   * Stores the subscription list supplied by the JS layer. [subscriptionsJson] is a JSON array
   * of `{id, title, rssUrl, notify?}`; `notify` defaults to true so a snapshot written before
   * the field existed keeps alerting as it always did.
   *
   * Episode lists for shows that are no longer subscribed are dropped in the same pass, which
   * is what stops the worker's store growing without bound.
   */
  fun syncSubscriptions(context: Context, subscriptionsJson: String) {
    // Parse the incoming snapshot rather than re-reading prefs: the write has not been applied
    // yet, so a read here would still return the previous list and prune the wrong shows —
    // deleting a newly subscribed podcast's feed while leaking the one just removed.
    val keep = parseSubscriptions(subscriptionsJson).map { it.id }.toSet()
    val editor = prefs(context).edit().putString(KEY_SUBSCRIPTIONS, subscriptionsJson)
    for (key in prefs(context).all.keys) {
      if (!key.startsWith(EPISODE_PREFIX)) continue
      if (!keep.contains(key.removePrefix(EPISODE_PREFIX))) editor.remove(key)
    }
    editor.apply()
  }

  fun getSubscriptions(context: Context): List<Subscription> =
    parseSubscriptions(prefs(context).getString(KEY_SUBSCRIPTIONS, null))

  private fun parseSubscriptions(raw: String?): List<Subscription> {
    if (raw == null) return emptyList()
    return try {
      val array = JSONArray(raw)
      val list = mutableListOf<Subscription>()
      for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val id = item.optString("id", "")
        val rssUrl = item.optString("rssUrl", "")
        if (id.isNotBlank() && rssUrl.isNotBlank()) {
          list.add(
            Subscription(
              id = id,
              title = item.optString("title", ""),
              rssUrl = rssUrl,
              // Absent means an older snapshot, which only ever held armed shows.
              notify = if (item.isNull("notify") || !item.has("notify")) true else item.optBoolean("notify", false)
            )
          )
        }
      }
      list
    } catch (_: Exception) {
      emptyList()
    }
  }

  fun isNotified(context: Context, episodeId: String): Boolean =
    prefs(context).getStringSet(KEY_NOTIFIED, emptySet())?.contains(episodeId) == true

  fun getNotifiedEpisodeIds(context: Context): List<String> =
    prefs(context).getStringSet(KEY_NOTIFIED, emptySet())?.toList() ?: emptyList()

  fun markNotified(context: Context, episodeId: String) {
    val current = prefs(context).getStringSet(KEY_NOTIFIED, emptySet())?.toMutableSet() ?: mutableSetOf()
    if (!current.add(episodeId)) return
    val trimmed = if (current.size > 1000) current.toList().takeLast(1000).toSet() else current
    prefs(context).edit().putStringSet(KEY_NOTIFIED, trimmed).apply()
  }

  /**
   * Records the episodes the worker parsed for one podcast, newest first.
   *
   * [episodes] entries use the same field names as `Episode` in `src/api/podcasts.ts` so the JS
   * side can adopt them without a translation step.
   */
  fun saveEpisodeSnapshot(context: Context, podcastId: String, fetchedAtMs: Long, episodes: JSONArray) {
    if (podcastId.isBlank()) return
    val payload = JSONObject()
      .put("fetchedAtMs", fetchedAtMs)
      .put("episodes", if (episodes.length() > MAX_EPISODES_PER_SNAPSHOT) truncate(episodes) else episodes)
    prefs(context).edit()
      .putString(EPISODE_PREFIX + podcastId, payload.toString())
      .putLong(KEY_REVISION, prefs(context).getLong(KEY_REVISION, 0L) + 1L)
      .apply()
  }

  /**
   * How many snapshots have been stored since install.
   *
   * Adoption parses every stored feed, which is megabytes for a large subscription list, and it
   * is offered before every in-car sync. Comparing this against the last adopted value makes the
   * steady-state case one cheap read instead.
   */
  fun episodeSnapshotRevision(context: Context): Long =
    prefs(context).getLong(KEY_REVISION, 0L)

  /** Drops the oldest entries so the stored list stays within the cap. */
  private fun truncate(episodes: JSONArray): JSONArray {
    val out = JSONArray()
    for (i in 0 until MAX_EPISODES_PER_SNAPSHOT) out.put(episodes.opt(i))
    return out
  }

  /**
   * Every stored snapshot as `{podcastId: {fetchedAtMs, episodes}}`, for JS to adopt.
   *
   * The JSON is returned wholesale rather than drained because adoption is idempotent: the
   * worker overwrites each show's entry on its next run, so there is no pending state to
   * clear and a missed adoption is picked up by the next one.
   */
  fun episodeSnapshotsJson(context: Context): String {
    val out = JSONObject()
    for ((key, value) in prefs(context).all) {
      if (!key.startsWith(EPISODE_PREFIX)) continue
      val podcastId = key.removePrefix(EPISODE_PREFIX)
      if (podcastId.isBlank() || value !is String) continue
      try {
        out.put(podcastId, JSONObject(value))
      } catch (_: Exception) {
        // Unparseable snapshot: skip it rather than failing the whole handover.
      }
    }
    return out.toString()
  }

  /**
   * Schedules (or cancels) the periodic background refresh.
   * [intervalMinutes] of 0 disables the worker.
   *
   * [wifiOnly] restricts the run to unmetered networks. It is deliberately *not* derived from
   * the "Download on Wi-Fi only" preference: a feed check is a few hundred kilobytes against a
   * download of the same episode in MP3, and coupling the two silently stopped every
   * new-episode alert for anyone listening on mobile data.
   */
  fun schedule(context: Context, intervalMinutes: Int, wifiOnly: Boolean) {
    val manager = WorkManager.getInstance(context)
    if (intervalMinutes <= 0) {
      manager.cancelUniqueWork(WORK_NAME)
      prefs(context).edit().putBoolean(KEY_ENABLED, false).apply()
      return
    }
    prefs(context).edit()
      .putBoolean(KEY_ENABLED, true)
      .putBoolean(KEY_WIFI_ONLY, wifiOnly)
      .apply()

    val constraints = Constraints.Builder()
      .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
      .build()

    val request = PeriodicWorkRequestBuilder<IndexRefreshWorker>(
      intervalMinutes.toLong().coerceAtLeast(15L),
      TimeUnit.MINUTES
    ).setConstraints(constraints).build()

    manager.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
  }
}
