package com.hyliankid14.bbcradioplayer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlin.math.abs

object PodcastEpisodeNotifier {
    private const val CHANNEL_ID = "podcast_updates"
    private const val CHANNEL_NAME = "Podcast updates"

    fun notifyNewEpisode(context: Context, podcast: Podcast, episodeTitle: String) {
        if (episodeTitle.isBlank()) return
        if (!PodcastSubscriptions.isNotificationsEnabled(context, podcast.id)) return
        if (!areNotificationsAllowed(context)) return

        ensureChannel(context)

        val title = podcast.title.ifBlank { "Podcast" }
        val text = "New episode added - $episodeTitle"

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("open_podcast_id", podcast.id)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            podcast.id.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_podcast)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        val id = 10_000 + abs(podcast.id.hashCode() % 10_000)
        NotificationManagerCompat.from(context).notify(id, notification)
    }

    fun notifyNewPodcastAdded(context: Context, podcast: Podcast) {
        notifyNewPodcastAdded(context, podcast.id, podcast.title)
    }

    fun notifyNewPodcastAdded(context: Context, podcastId: String, podcastTitle: String) {
        if (podcastId.isBlank()) return
        if (!areNotificationsAllowed(context)) return

        ensureChannel(context)

        val title = podcastTitle.ifBlank { "New podcast" }
        val text = "New podcast added"

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("open_podcast_id", podcastId)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            ("new_" + podcastId).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_podcast)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        val id = 20_000 + abs(podcastId.hashCode() % 10_000)
        NotificationManagerCompat.from(context).notify(id, notification)
    }

    private fun areNotificationsAllowed(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (!granted) return false
        }
        return true
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = manager.getNotificationChannel(CHANNEL_ID)
        if (existing != null) return
        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT)
        manager.createNotificationChannel(channel)
    }
}
