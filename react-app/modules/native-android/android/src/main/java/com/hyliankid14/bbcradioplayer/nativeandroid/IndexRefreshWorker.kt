package com.hyliankid14.bbcradioplayer.nativeandroid

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.net.HttpURLConnection
import java.net.URL

/**
 * Periodic worker that checks each subscribed podcast's RSS feed for a new episode and posts a
 * local notification. Mirrors the legacy `BackgroundIndexWorker` new-episode alerts.
 */
class IndexRefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

  override fun doWork(): Result {
    val context = applicationContext
    val subscriptions = BackgroundSync.getSubscriptions(context)
    if (subscriptions.isEmpty()) return Result.success()

    var anyNew = false
    for (subscription in subscriptions) {
      try {
        val feed = fetchFeed(subscription.rssUrl) ?: continue
        val latest = parseLatestEpisode(feed) ?: continue
        if (latest.id.isBlank() || BackgroundSync.isNotified(context, latest.id)) continue
        BackgroundSync.markNotified(context, latest.id)
        notifyNewEpisode(context, subscription.id, subscription.title, latest.title)
        anyNew = true
      } catch (_: Exception) {
        // Skip feeds that fail to load.
      }
    }
    return Result.success()
  }

  private data class LatestEpisode(val id: String, val title: String)

  private fun fetchFeed(rssUrl: String): String? {
    return try {
      val connection = (URL(rssUrl).openConnection() as HttpURLConnection).apply {
        connectTimeout = 10_000
        readTimeout = 10_000
        setRequestProperty("User-Agent", "BritishRadioPlayer/1.0")
      }
      connection.inputStream.bufferedReader().use { it.readText() }
    } catch (_: Exception) {
      null
    }
  }

  private fun parseLatestEpisode(feed: String): LatestEpisode? {
    val itemMatch = Regex("<item[\\s\\S]*?</item>", RegexOption.IGNORE_CASE).find(feed) ?: return null
    val item = itemMatch.value
    val title = Regex("<title[^>]*>([\\s\\S]*?)</title>", RegexOption.IGNORE_CASE)
      .find(item)?.groupValues?.get(1)?.let { decode(it.trim()) } ?: return null
    val guid = Regex("<guid[^>]*>([\\s\\S]*?)</guid>", RegexOption.IGNORE_CASE)
      .find(item)?.groupValues?.get(1)?.trim()
    val enclosure = Regex("<enclosure[^>]*url=\"([^\"]+)\"", RegexOption.IGNORE_CASE)
      .find(item)?.groupValues?.get(1)
    val id = guid?.takeIf { it.isNotBlank() } ?: enclosure ?: title
    return LatestEpisode(id, title)
  }

  private fun decode(value: String): String =
    value.replace("&amp;", "&")
      .replace("&lt;", "<")
      .replace("&gt;", ">")
      .replace("&quot;", "\"")
      .replace("&#39;", "'")

  private fun notifyNewEpisode(context: Context, podcastId: String, podcastTitle: String, episodeTitle: String) {
    ensureChannel(context)
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      data = Uri.parse("bbcradioplayer://modal/podcast-detail?podcastId=$podcastId")
      putExtra("url", "/modal/podcast-detail?podcastId=$podcastId")
      putExtra("podcastId", podcastId)
    }
    val pendingIntent = launchIntent?.let {
      PendingIntent.getActivity(
        context,
        kotlin.math.abs(podcastId.hashCode()),
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
    val smallIconRes = try {
      val resId = context.resources.getIdentifier("ic_stat_notification", "drawable", context.packageName)
      if (resId != 0) resId else R.drawable.ic_stat_notification
    } catch (_: Throwable) {
      try {
        R.drawable.ic_stat_notification
      } catch (_: Throwable) {
        context.applicationInfo.icon
      }
    }
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIconRes)
      .setContentTitle(podcastTitle.ifBlank { "New episode" })
      .setContentText(episodeTitle)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setAutoCancel(true)
      .apply {
        if (pendingIntent != null) {
          setContentIntent(pendingIntent)
        }
      }
      .build()
    try {
      NotificationManagerCompat.from(context).notify((podcastTitle + episodeTitle).hashCode(), notification)
    } catch (_: SecurityException) {
    }
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "New podcast episodes", NotificationManager.IMPORTANCE_DEFAULT)
    )
  }

  private companion object {
    const val CHANNEL_ID = "podcast_updates_channel"
  }
}
