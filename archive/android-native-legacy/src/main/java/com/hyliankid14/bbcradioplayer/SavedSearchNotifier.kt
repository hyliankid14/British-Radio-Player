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

object SavedSearchNotifier {
    private const val CHANNEL_ID = "saved_search_updates"
    private const val CHANNEL_NAME = "Saved search updates"

    fun notifyNewMatches(
        context: Context,
        search: SavedSearchesPreference.SavedSearch,
        exampleEpisodeTitle: String,
        newCount: Int
    ) {
        if (newCount <= 0) return
        if (!search.notificationsEnabled) return
        if (!areNotificationsAllowed(context)) return

        ensureChannel(context)

        val title = search.name.ifBlank { "Saved Search" }
        val text = if (newCount == 1) {
            "New episode match - ${exampleEpisodeTitle.ifBlank { "(Untitled Episode)" }}"
        } else {
            "$newCount new episodes match this search"
        }

        // When tapped, notification will open this saved search with the recent-episodes sort order
        // to show the newest episodes that match (same behavior as tapping the search in-app)
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("open_saved_search_id", search.id)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            abs(search.id.hashCode()),
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

        val id = 20_000 + abs(search.id.hashCode() % 10_000)
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
