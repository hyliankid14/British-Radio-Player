package com.hyliankid14.bbcradioplayer

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock

object SubscriptionRefreshScheduler {
    private const val ACTION = "com.hyliankid14.bbcradioplayer.ACTION_REFRESH_SUBSCRIPTIONS"
    private const val REQUEST_CODE = 0xF2

    fun scheduleRefresh(context: Context) {
        val minutes = SubscriptionRefreshPreference.getIntervalMinutes(context)
        if (minutes <= 0) return cancel(context)

        val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = PendingIntent.getBroadcast(context, REQUEST_CODE, Intent(ACTION).setPackage(context.packageName), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val intervalMs = minutes.toLong() * 60L * 1000L
        val triggerAt = System.currentTimeMillis() + intervalMs

        try {
            // Use setInexactRepeating so the system can batch alarms
            alarm.setInexactRepeating(AlarmManager.RTC_WAKEUP, triggerAt, intervalMs, pi)
        } catch (e: Exception) {
            // Fallback to elapsed realtime version
            alarm.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + intervalMs, intervalMs, pi)
        }
    }

    fun cancel(context: Context) {
        val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = PendingIntent.getBroadcast(context, REQUEST_CODE, Intent(ACTION).setPackage(context.packageName), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        try { alarm.cancel(pi) } catch (_: Exception) {}
    }
}
