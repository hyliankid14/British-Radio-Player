package com.hyliankid14.bbcradioplayer.nativeandroid

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Delivers the scheduled radio alarm as a high-priority notification with Snooze and Dismiss
 * actions and a full-screen intent that opens the app to begin playback.
 */
class AlarmReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val stationId = intent.getStringExtra(AlarmScheduler.EXTRA_STATION_ID)
    val ramp = intent.getBooleanExtra(AlarmScheduler.EXTRA_RAMP, true)
    val volume = intent.getIntExtra(AlarmScheduler.EXTRA_VOLUME, 5)
    AlarmNotifier.show(context, stationId, ramp, volume)
  }
}

/** Dismisses the alarm notification. */
class AlarmDismissReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    AlarmNotifier.cancel(context)
  }
}

/** Snoozes the alarm for ten minutes. */
class AlarmSnoozeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val stationId = intent.getStringExtra(AlarmScheduler.EXTRA_STATION_ID)
    val ramp = intent.getBooleanExtra(AlarmScheduler.EXTRA_RAMP, true)
    val volume = intent.getIntExtra(AlarmScheduler.EXTRA_VOLUME, 5)
    AlarmScheduler.snooze(context, stationId, ramp, volume)
    AlarmNotifier.cancel(context)
  }
}

object AlarmNotifier {

  private const val CHANNEL_ID = "radio_alarm_channel"
  private const val NOTIFICATION_ID = 9001

  fun show(context: Context, stationId: String?, ramp: Boolean, volume: Int) {
    ensureChannel(context)

    val openIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra(AlarmScheduler.EXTRA_STATION_ID, stationId)
      putExtra(AlarmScheduler.EXTRA_RAMP, ramp)
      putExtra(AlarmScheduler.EXTRA_VOLUME, volume)
    }

    val contentPendingIntent = PendingIntent.getActivity(
      context,
      9101,
      openIntent ?: Intent(),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val dismissIntent = PendingIntent.getBroadcast(
      context,
      9102,
      Intent(context, AlarmDismissReceiver::class.java).setAction(AlarmScheduler.ACTION_DISMISS),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val snoozeIntent = PendingIntent.getBroadcast(
      context,
      9103,
      Intent(context, AlarmSnoozeReceiver::class.java).apply {
        action = AlarmScheduler.ACTION_SNOOZE
        putExtra(AlarmScheduler.EXTRA_STATION_ID, stationId)
        putExtra(AlarmScheduler.EXTRA_RAMP, ramp)
        putExtra(AlarmScheduler.EXTRA_VOLUME, volume)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle("Radio Alarm")
      .setContentText("Tap to start your station")
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setAutoCancel(true)
      .setContentIntent(contentPendingIntent)
      .setFullScreenIntent(contentPendingIntent, true)
      .addAction(0, "Snooze 10 min", snoozeIntent)
      .addAction(0, "Dismiss", dismissIntent)
      .build()

    try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS not granted; nothing more we can do here.
    }
  }

  fun cancel(context: Context) {
    try {
      NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    } catch (_: Exception) {
    }
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Radio Alarm",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "Wake-up alarm for your chosen radio station"
    }
    manager.createNotificationChannel(channel)
  }
}
