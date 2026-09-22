package com.hyliankid14.bbcradioplayer.nativeandroid

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONArray
import java.util.concurrent.TimeUnit

/**
 * Persists the subscription snapshot used by the background worker and schedules the periodic
 * new-episode check, mirroring the legacy `BackgroundIndexWorker` behaviour.
 */
object BackgroundSync {

  private const val PREFS = "bg_sync_prefs"
  private const val KEY_ENABLED = "enabled"
  private const val KEY_WIFI_ONLY = "wifi_only"
  private const val KEY_SUBSCRIPTIONS = "subscriptions_json"
  private const val KEY_NOTIFIED = "notified_episode_ids"
  private const val WORK_NAME = "bbc_radio_index_refresh"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  data class Subscription(val id: String, val title: String, val rssUrl: String)

  /**
   * Stores the subscription list supplied by the JS layer. [subscriptionsJson] is a JSON array
   * of `{id, title, rssUrl}`.
   */
  fun syncSubscriptions(context: Context, subscriptionsJson: String) {
    prefs(context).edit().putString(KEY_SUBSCRIPTIONS, subscriptionsJson).apply()
  }

  fun getSubscriptions(context: Context): List<Subscription> {
    val raw = prefs(context).getString(KEY_SUBSCRIPTIONS, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      val list = mutableListOf<Subscription>()
      for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val id = item.optString("id", "")
        val rssUrl = item.optString("rssUrl", "")
        if (id.isNotBlank() && rssUrl.isNotBlank()) {
          list.add(Subscription(id, item.optString("title", ""), rssUrl))
        }
      }
      list
    } catch (_: Exception) {
      emptyList()
    }
  }

  fun isNotified(context: Context, episodeId: String): Boolean =
    prefs(context).getStringSet(KEY_NOTIFIED, emptySet())?.contains(episodeId) == true

  fun markNotified(context: Context, episodeId: String) {
    val current = prefs(context).getStringSet(KEY_NOTIFIED, emptySet())?.toMutableSet() ?: mutableSetOf()
    if (!current.add(episodeId)) return
    val trimmed = if (current.size > 1000) current.toList().takeLast(1000).toSet() else current
    prefs(context).edit().putStringSet(KEY_NOTIFIED, trimmed).apply()
  }

  /**
   * Schedules (or cancels) the periodic background refresh.
   * [intervalMinutes] of 0 disables the worker.
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
