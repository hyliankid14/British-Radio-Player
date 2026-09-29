package com.hyliankid14.bbcradioplayer

import android.content.Context

object AlarmPreference {
    private const val PREFS_NAME = "alarm_prefs"
    private const val KEY_ENABLED = "alarm_enabled"
    private const val KEY_HOUR = "alarm_hour"
    private const val KEY_MINUTE = "alarm_minute"
    private const val KEY_DAYS_OF_WEEK = "alarm_days_of_week"
    private const val KEY_STATION_ID = "alarm_station_id"
    private const val KEY_ENABLE_VOLUME_RAMP = "alarm_enable_volume_ramp"
    private const val KEY_MANUAL_VOLUME = "alarm_manual_volume"

    // Days of week bitmask: bit 0 = Sunday, bit 1 = Monday, ..., bit 6 = Saturday
    const val DAY_SUNDAY = 1 shl 0
    const val DAY_MONDAY = 1 shl 1
    const val DAY_TUESDAY = 1 shl 2
    const val DAY_WEDNESDAY = 1 shl 3
    const val DAY_THURSDAY = 1 shl 4
    const val DAY_FRIDAY = 1 shl 5
    const val DAY_SATURDAY = 1 shl 6

    fun isEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_ENABLED, false)
    }

    fun setEnabled(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    fun getHour(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getInt(KEY_HOUR, 7)
    }

    fun setHour(context: Context, hour: Int) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putInt(KEY_HOUR, hour).apply()
    }

    fun getMinute(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getInt(KEY_MINUTE, 0)
    }

    fun setMinute(context: Context, minute: Int) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putInt(KEY_MINUTE, minute).apply()
    }

    fun getDaysOfWeek(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        // Default to weekdays (Monday-Friday)
        return prefs.getInt(KEY_DAYS_OF_WEEK, DAY_MONDAY or DAY_TUESDAY or DAY_WEDNESDAY or DAY_THURSDAY or DAY_FRIDAY)
    }

    fun setDaysOfWeek(context: Context, daysMask: Int) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putInt(KEY_DAYS_OF_WEEK, daysMask).apply()
    }

    fun getStationId(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_STATION_ID, null)
    }

    fun setStationId(context: Context, stationId: String?) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (stationId == null) {
            prefs.edit().remove(KEY_STATION_ID).apply()
        } else {
            prefs.edit().putString(KEY_STATION_ID, stationId).apply()
        }
    }

    fun isDayEnabled(context: Context, dayOfWeek: Int): Boolean {
        return (getDaysOfWeek(context) and dayOfWeek) != 0
    }

    fun setDayEnabled(context: Context, dayOfWeek: Int, enabled: Boolean) {
        val current = getDaysOfWeek(context)
        val updated = if (enabled) {
            current or dayOfWeek
        } else {
            current and dayOfWeek.inv()
        }
        setDaysOfWeek(context, updated)
    }

    fun isVolumeRampEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_ENABLE_VOLUME_RAMP, true)
    }

    fun setVolumeRampEnabled(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_ENABLE_VOLUME_RAMP, enabled).apply()
    }

    fun getManualVolume(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getInt(KEY_MANUAL_VOLUME, 5)
    }

    fun setManualVolume(context: Context, volume: Int) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putInt(KEY_MANUAL_VOLUME, volume).apply()
    }
}
