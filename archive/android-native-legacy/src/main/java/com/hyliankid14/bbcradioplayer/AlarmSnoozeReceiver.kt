package com.hyliankid14.bbcradioplayer

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.Calendar

class AlarmSnoozeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        // Dismiss the alarm notification
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.cancel(AlarmReceiver.ALARM_NOTIFICATION_ID)

        // Reschedule alarm for 10 minutes from now
        val snoozeCalendar = java.util.Calendar.getInstance()
        snoozeCalendar.add(java.util.Calendar.MINUTE, 10)

        val alarmIntent = Intent(AlarmScheduler.getAlarmAction()).setPackage(context.packageName)
        val pendingIntent = android.app.PendingIntent.getBroadcast(
            context,
            0xA1AE,  // Same REQUEST_CODE as AlarmScheduler
            alarmIntent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        )

        try {
            val am = context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
            am.setExactAndAllowWhileIdle(
                android.app.AlarmManager.RTC_WAKEUP,
                snoozeCalendar.timeInMillis,
                pendingIntent
            )
        } catch (e: Exception) {
            android.util.Log.e("AlarmSnoozeReceiver", "Failed to reschedule snooze alarm", e)
        }
    }
}
