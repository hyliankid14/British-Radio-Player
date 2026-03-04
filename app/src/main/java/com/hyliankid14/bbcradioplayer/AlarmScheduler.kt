package com.hyliankid14.bbcradioplayer

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

object AlarmScheduler {
    private const val REQUEST_CODE = 0xA1AE  // "ALAE" in hex
    private const val ACTION = "com.hyliankid14.bbcradioplayer.ACTION_ALARM"

    /**
     * Schedules an alarm for the next matching occurrence of the configured time/days.
     * Requires SCHEDULE_EXACT_ALARM permission on Android 12+.
     *
     * @throws SecurityException if exact alarm permission is not available on Android 12+
     */
    fun schedule(context: Context) {
        if (!AlarmPreference.isEnabled(context)) {
            cancel(context)
            return
        }

        val stationId = AlarmPreference.getStationId(context)
        if (stationId == null) {
            // Cannot schedule without a station selected
            cancel(context)
            return
        }

        // Check exact alarm capability on Android 12+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            if (!alarmManager.canScheduleExactAlarms()) {
                throw SecurityException("Cannot schedule exact alarm: SCHEDULE_EXACT_ALARM permission not granted or revoked")
            }
        }

        val nextTriggerTime = calculateNextOccurrence(context)
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(ACTION).setPackage(context.packageName)
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        try {
            // setExactAndAllowWhileIdle ensures alarm fires even in Doze/idle mode and at exact time
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                nextTriggerTime,
                pendingIntent
            )
        } catch (e: Exception) {
            // If setExactAndAllowWhileIdle fails, log and rethrow
            throw RuntimeException("Failed to schedule alarm", e)
        }
    }

    fun cancel(context: Context) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(ACTION).setPackage(context.packageName)
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        try {
            alarmManager.cancel(pendingIntent)
        } catch (_: Exception) {}
    }

    /**
     * Returns the action string used for alarm broadcasts.
     */
    fun getAlarmAction(): String = ACTION

    /**
     * Calculates the next occurrence of the alarm in milliseconds (RTC_WAKEUP time).
     * Takes into account the configured hour, minute, and days of week.
     * If the calculated time is in the past, moves to the next valid day.
     */
    private fun calculateNextOccurrence(context: Context): Long {
        val hour = AlarmPreference.getHour(context)
        val minute = AlarmPreference.getMinute(context)
        val daysOfWeek = AlarmPreference.getDaysOfWeek(context)

        val now = Calendar.getInstance()
        val alarm = Calendar.getInstance()

        // Set alarm to the configured time today
        alarm.set(Calendar.HOUR_OF_DAY, hour)
        alarm.set(Calendar.MINUTE, minute)
        alarm.set(Calendar.SECOND, 0)
        alarm.set(Calendar.MILLISECOND, 0)

        // If the alarm time has already passed today, move to tomorrow
        if (alarm.timeInMillis <= now.timeInMillis) {
            alarm.add(Calendar.DAY_OF_YEAR, 1)
        }

        // Find the next day that matches the enabled days of week
        val maxIterations = 7
        var iteration = 0
        while (iteration < maxIterations) {
            val dayOfWeek = alarm.get(Calendar.DAY_OF_WEEK)
            // Android Calendar: SUNDAY=1, MONDAY=2, ..., SATURDAY=7
            // Our bitmask: bit 0=SUNDAY, bit 1=MONDAY, ..., bit 6=SATURDAY
            val bitPosition = dayOfWeek - 1
            if ((daysOfWeek and (1 shl bitPosition)) != 0) {
                // This day is enabled
                return alarm.timeInMillis
            }
            alarm.add(Calendar.DAY_OF_YEAR, 1)
            iteration++
        }

        // Fallback: should never reach here if at least one day is enabled
        // Re-enable the alarm for the same time on the next day
        alarm.add(Calendar.DAY_OF_YEAR, 1)
        return alarm.timeInMillis
    }
}
