package com.hyliankid14.bbcradioplayer.nativeandroid

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

/**
 * Schedules the exact radio alarm, mirroring the legacy Kotlin `AlarmScheduler`.
 * Bit 0 of the day mask is Sunday, matching `AlarmPreference`.
 */
object AlarmScheduler {

  const val ACTION_ALARM = "com.hyliankid14.bbcradioplayer.action.ALARM"
  const val ACTION_DISMISS = "com.hyliankid14.bbcradioplayer.action.ALARM_DISMISS"
  const val ACTION_SNOOZE = "com.hyliankid14.bbcradioplayer.action.ALARM_SNOOZE"

  const val EXTRA_STATION_ID = "alarm_station_id"
  const val EXTRA_RAMP = "alarm_ramp"
  const val EXTRA_VOLUME = "alarm_volume"

  private const val REQUEST_CODE = 9001
  private const val SNOOZE_MINUTES = 10

  fun schedule(
    context: Context,
    hour: Int,
    minute: Int,
    daysMask: Int,
    stationId: String?,
    ramp: Boolean,
    volume: Int
  ) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val triggerAt = nextTriggerMillis(hour, minute, daysMask)
    val pendingIntent = buildPendingIntent(context, stationId, ramp, volume, null)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      } else {
        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      }
    } catch (_: SecurityException) {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
    }
  }

  /** Schedules a one-off snooze alarm [SNOOZE_MINUTES] from now. */
  fun snooze(context: Context, stationId: String?, ramp: Boolean, volume: Int) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val triggerAt = System.currentTimeMillis() + SNOOZE_MINUTES * 60_000L
    val pendingIntent = buildPendingIntent(context, stationId, ramp, volume, null)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      } else {
        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      }
    } catch (_: SecurityException) {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
    }
  }

  fun cancel(context: Context) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val pendingIntent = buildPendingIntent(context, null, true, 5, null)
    manager.cancel(pendingIntent)
  }

  private fun buildPendingIntent(
    context: Context,
    stationId: String?,
    ramp: Boolean,
    volume: Int,
    action: String?
  ): PendingIntent {
    val intent = Intent(context, AlarmReceiver::class.java).apply {
      this.action = action ?: ACTION_ALARM
      putExtra(EXTRA_STATION_ID, stationId)
      putExtra(EXTRA_RAMP, ramp)
      putExtra(EXTRA_VOLUME, volume)
    }
    return PendingIntent.getBroadcast(
      context,
      REQUEST_CODE,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /** Returns the next epoch millis matching the hour/minute and day mask. */
  private fun nextTriggerMillis(hour: Int, minute: Int, daysMask: Int): Long {
    val now = Calendar.getInstance()
    val target = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }

    fun isDayEnabled(calendar: Calendar): Boolean {
      // Calendar.DAY_OF_WEEK: 1 = Sunday ... 7 = Saturday; bit 0 = Sunday.
      val bit = 1 shl (calendar.get(Calendar.DAY_OF_WEEK) - 1)
      return (daysMask and bit) != 0
    }

    if (target.timeInMillis <= now.timeInMillis) {
      target.add(Calendar.DAY_OF_YEAR, 1)
    }

    // Find the next enabled day within a week.
    var guard = 0
    while (!isDayEnabled(target) && guard < 8) {
      target.add(Calendar.DAY_OF_YEAR, 1)
      guard++
    }
    return target.timeInMillis
  }
}
