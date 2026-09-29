package com.hyliankid14.bbcradioplayer

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        // Check if alarm is enabled and has a station configured
        if (!AlarmPreference.isEnabled(context)) {
            return
        }

        val stationId = AlarmPreference.getStationId(context) ?: return

        // Get station info for display (fallback to ID if name not found)
        val stationName = try {
            val station = StationRepository.getStationById(stationId)
            station?.title ?: stationId
        } catch (e: Exception) {
            stationId
        }

        // Create alarm notification
        createAlarmNotification(context, stationName)

        // Start playback of the alarm station
        val playIntent = Intent(context, RadioService::class.java).apply {
            action = RadioService.ACTION_PLAY_STATION
            putExtra(RadioService.EXTRA_STATION_ID, stationId)
            putExtra(RadioService.EXTRA_ALARM_VOLUME_RAMP, AlarmPreference.isVolumeRampEnabled(context))
            putExtra(RadioService.EXTRA_ALARM_MANUAL_VOLUME, AlarmPreference.getManualVolume(context))
        }

        // Use startForegroundService on Android 12+ for better reliability
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                context.startForegroundService(playIntent)
            } catch (e: Exception) {
                // Fallback to startService if foreground service start fails
                context.startService(playIntent)
            }
        } else {
            context.startService(playIntent)
        }

        // Reschedule the alarm for the next matching day
        try {
            AlarmScheduler.schedule(context)
        } catch (e: Exception) {
            // Log error but don't crash; alarm will not re-trigger but shouldn't crash the receiver
            android.util.Log.e("AlarmReceiver", "Failed to reschedule alarm", e)
        }
    }

    private fun createAlarmNotification(context: Context, stationName: String) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Ensure alarm notification channel exists with high importance
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val existingChannel = notificationManager.getNotificationChannel(ALARM_CHANNEL_ID)
            if (existingChannel == null) {
                val channel = android.app.NotificationChannel(
                    ALARM_CHANNEL_ID,
                    context.getString(R.string.alarm_notification_channel),
                    NotificationManager.IMPORTANCE_HIGH
                )
                channel.enableVibration(true)
                channel.enableLights(true)
                channel.setShowBadge(true)
                // Allow sound to bypass DND (alarm-like semantics)
                channel.setBypassDnd(true)
                notificationManager.createNotificationChannel(channel)
            }
        }

        // Snooze intent: reschedule alarm for +10 minutes
        val snoozeIntent = Intent(context, AlarmSnoozeReceiver::class.java)
        val snoozePendingIntent = PendingIntent.getBroadcast(
            context,
            SNOOZE_REQUEST_CODE,
            snoozeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Dismiss intent: clear the alarm
        val dismissIntent = Intent(context, AlarmDismissReceiver::class.java)
        val dismissPendingIntent = PendingIntent.getBroadcast(
            context,
            DISMISS_REQUEST_CODE,
            dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Tap intent: open main activity
        val mainActivityIntent = Intent(
            Intent.ACTION_VIEW,
            null,
            context,
            MainActivity::class.java
        )
        val mainActivityPendingIntent = PendingIntent.getActivity(
            context,
            MAIN_ACTIVITY_REQUEST_CODE,
            mainActivityIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, ALARM_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(context.getString(R.string.alarm_trigger_title))
            .setContentText(stationName)
            .setContentIntent(mainActivityPendingIntent)
            .setDeleteIntent(dismissPendingIntent)
            .addAction(
                android.R.drawable.ic_media_pause,
                context.getString(R.string.alarm_snooze_button),
                snoozePendingIntent
            )
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                context.getString(R.string.alarm_dismiss_button),
                dismissPendingIntent
            )
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .build()

        notificationManager.notify(ALARM_NOTIFICATION_ID, notification)
    }

    companion object {
        const val ALARM_CHANNEL_ID = "alarm_channel"
        const val ALARM_NOTIFICATION_ID = 9001
        const val SNOOZE_REQUEST_CODE = 9002
        const val DISMISS_REQUEST_CODE = 9003
        const val MAIN_ACTIVITY_REQUEST_CODE = 9004
    }
}
