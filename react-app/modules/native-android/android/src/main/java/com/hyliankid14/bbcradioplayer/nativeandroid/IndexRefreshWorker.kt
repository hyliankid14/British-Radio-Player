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
 * Periodic worker that refreshes every subscribed podcast's RSS feed while the app is closed.
 *
 * Two things come out of each run:
 *
 *  - **A persisted episode list per subscription**, handed back to JS by
 *    `BackgroundSync.episodeSnapshotsJson`. This is what keeps the Android Auto / CarPlay
 *    subscription lists fresh without the phone app being opened.
 *  - **A notification** for shows the user has armed the bell on. Unarmed subscriptions are
 *    refreshed but never alert, which is why the snapshot carries a per-show `notify` flag
 *    rather than the worker only being told about armed shows.
 *
 * Mirrors the legacy `BackgroundIndexWorker` new-episode alerts.
 */
class IndexRefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

  /**
   * Wall-clock budget for one run. WorkManager gives a worker roughly ten minutes before it
   * considers the run expired; stopping short means the feeds already parsed are stored rather
   * than lost with the process.
   */
  private val runBudgetMs = 8L * 60_000L

  override fun doWork(): Result {
    val context = applicationContext
    val subscriptions = BackgroundSync.getSubscriptions(context)
    if (subscriptions.isEmpty()) return Result.success()

    val deadline = System.currentTimeMillis() + runBudgetMs
    var ranOutOfTime = false

    for (subscription in subscriptions) {
      if (System.currentTimeMillis() >= deadline) {
        ranOutOfTime = true
        break
      }
      try {
        val feed = fetchFeed(subscription.rssUrl) ?: continue
        val episodes = RssEpisodes.parse(feed, subscription.id)
        if (episodes.isEmpty()) continue

        // Stored for every subscription, armed or not: the in-car surface browses all of them.
        BackgroundSync.saveEpisodeSnapshot(context, subscription.id, System.currentTimeMillis(), RssEpisodes.toJson(episodes))

        if (!subscription.notify) continue
        val newest = RssEpisodes.latest(episodes) ?: continue
        if (newest.id.isBlank() || BackgroundSync.isNotified(context, newest.id)) continue
        BackgroundSync.markNotified(context, newest.id)
        notifyNewEpisode(context, subscription.id, subscription.title, newest.title, newest.id)
      } catch (_: Exception) {
        // Skip feeds that fail to load.
      }
    }

    // Retrying reschedules the run so the shows the budget cut off are not skipped until the
    // next interval. Already-parsed feeds are re-fetched on the retry, which is wasteful but
    // idempotent — the snapshot is overwritten wholesale per podcast.
    return if (ranOutOfTime) Result.retry() else Result.success()
  }

  private fun fetchFeed(rssUrl: String): String? {
    return try {
      val connection = (URL(rssUrl.replace("http://", "https://")).openConnection() as HttpURLConnection).apply {
        connectTimeout = 10_000
        readTimeout = 10_000
        setRequestProperty("User-Agent", "BritishRadioPlayer/1.0")
      }
      connection.inputStream.bufferedReader().use { it.readText() }
    } catch (_: Exception) {
      null
    }
  }

  private fun notifyNewEpisode(
    context: Context,
    podcastId: String,
    podcastTitle: String,
    episodeTitle: String,
    episodeId: String
  ) {
    ensureChannel(context)
    val encodedPodcastId = java.net.URLEncoder.encode(podcastId, "UTF-8")
    val encodedEpisodeId = java.net.URLEncoder.encode(episodeId, "UTF-8")
    val detailUrl = "/modal/podcast-detail?podcastId=$encodedPodcastId&episodeId=$encodedEpisodeId"
    val targetUri = Uri.parse("bbcradioplayer:///modal/podcast-detail?podcastId=$encodedPodcastId&episodeId=$encodedEpisodeId")
    val launchIntent = Intent(Intent.ACTION_VIEW, targetUri).apply {
      setClassName(context.packageName, "com.hyliankid14.bbcradioplayer.MainActivity")
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("url", detailUrl)
      putExtra("podcastId", podcastId)
      putExtra("episodeId", episodeId)
    }
    // Key the notification and its PendingIntent on the episode rather than the podcast.
    // A podcast-keyed request code gave every alert for one show the same PendingIntent, so
    // FLAG_UPDATE_CURRENT rewrote the older notification's extras: tapping it then opened the
    // newest episode instead of the one that was advertised.
    val notificationId = stableNotificationId(podcastId, episodeId)
    val pendingIntent = PendingIntent.getActivity(
      context,
      notificationId,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
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
      .setContentIntent(pendingIntent)
      .build()
    try {
      NotificationManagerCompat.from(context).notify(notificationId, notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS not granted. The refresh above still landed, so the episode is in
      // the app's lists even though the alert could not be posted.
    }
  }

  /**
   * Stable per-episode notification id, used both as the `notify()` id and as the
   * `PendingIntent` request code so each alert owns its own launch target while re-notifying
   * the same episode replaces the previous alert. The sign bit is masked off rather than
   * taking an absolute value, which leaves [Int.MIN_VALUE] negative.
   */
  private fun stableNotificationId(podcastId: String, episodeId: String): Int =
    "$podcastId|$episodeId".hashCode() and 0x7FFFFFFF

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
