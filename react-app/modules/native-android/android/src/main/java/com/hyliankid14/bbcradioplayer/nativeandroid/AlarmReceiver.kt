package com.hyliankid14.bbcradioplayer.nativeandroid

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Delivers the scheduled radio alarm as a high-priority notification with looping sound,
 * Snooze and Dismiss actions, and opens the app to begin playback.
 */
class AlarmReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val stationId = intent.getStringExtra(AlarmScheduler.EXTRA_STATION_ID)
    val ramp = intent.getBooleanExtra(AlarmScheduler.EXTRA_RAMP, true)
    val volume = intent.getIntExtra(AlarmScheduler.EXTRA_VOLUME, 5)

    // Reschedule recurring alarm for next matching day if configured
    AlarmScheduler.rescheduleNext(context)

    AlarmNotifier.show(context, stationId, ramp, volume)
  }
}

/** Dismisses the alarm notification and stops ringtone. */
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

  private const val LEGACY_CHANNEL_ID = "radio_alarm_channel"
  private const val CHANNEL_ID = "radio_alarm_channel_v2"
  private const val NOTIFICATION_ID = 9001

  @Volatile
  private var activeRingtone: Ringtone? = null

  fun show(context: Context, stationId: String?, ramp: Boolean, volume: Int) {
    // Acquire a brief wake-lock to guarantee CPU execution while triggering
    wakeUpDevice(context)

    val alarmUri = getAlarmUri()
    ensureChannel(context, alarmUri)

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
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setSound(alarmUri, AudioManager.STREAM_ALARM)
      .setAutoCancel(true)
      .setContentIntent(contentPendingIntent)
      .setFullScreenIntent(contentPendingIntent, true)
      .addAction(0, "Snooze 10 min", snoozeIntent)
      .addAction(0, "Dismiss", dismissIntent)
      .build()
      .apply {
        flags = flags or Notification.FLAG_INSISTENT
      }

    // Play active alarm ringtone as redundant guarantee across Android OEM variations
    startRingtone(context, alarmUri)

    try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS not granted; ringtone still sounds.
    }

    // Attempt direct activity launch if permitted
    if (openIntent != null) {
      try {
        context.startActivity(openIntent)
      } catch (_: Exception) {
      }
    }
  }

  fun cancel(context: Context) {
    stopRingtone()
    try {
      NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    } catch (_: Exception) {
    }
  }

  private fun getAlarmUri(): Uri {
    return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
  }

  private fun startRingtone(context: Context, soundUri: Uri) {
    stopRingtone()
    try {
      val r = RingtoneManager.getRingtone(context.applicationContext, soundUri)
      if (r != null) {
        val audioAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          r.audioAttributes = audioAttributes
        } else {
          @Suppress("DEPRECATION")
          r.streamType = AudioManager.STREAM_ALARM
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          r.isLooping = true
        }
        r.play()
        activeRingtone = r
      }
    } catch (_: Exception) {
    }
  }

  private fun stopRingtone() {
    try {
      activeRingtone?.stop()
    } catch (_: Exception) {
    }
    activeRingtone = null
  }

  private fun wakeUpDevice(context: Context) {
    try {
      val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      powerManager?.newWakeLock(
        PowerManager.PARTIAL_WAKE_LOCK,
        "BBCRadioPlayer:AlarmWakeLock"
      )?.acquire(30_000L)
    } catch (_: Exception) {
    }
  }

  private fun ensureChannel(context: Context, soundUri: Uri) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

    // Clean up legacy channel without sound configuration
    try {
      if (manager.getNotificationChannel(LEGACY_CHANNEL_ID) != null) {
        manager.deleteNotificationChannel(LEGACY_CHANNEL_ID)
      }
    } catch (_: Exception) {
    }

    val existing = manager.getNotificationChannel(CHANNEL_ID)
    if (existing != null) return

    val audioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

    val channel = NotificationChannel(
      CHANNEL_ID,
      "Radio Alarm",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "Wake-up alarm for your chosen radio station"
      setSound(soundUri, audioAttributes)
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 500, 200, 500, 200, 500)
      setBypassDnd(true)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
  }
}
