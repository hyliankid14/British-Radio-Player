package com.hyliankid14.bbcradioplayer

import android.content.Context

object WidgetPreference {
    private const val PREFS_NAME = "widget_prefs"
    private const val KEY_PREFIX_STATION = "widget_station_"

    fun setStationForWidget(context: Context, widgetId: Int, stationId: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString("$KEY_PREFIX_STATION$widgetId", stationId).apply()
    }

    fun getStationForWidget(context: Context, widgetId: Int): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString("$KEY_PREFIX_STATION$widgetId", null)
    }

    fun deleteWidget(context: Context, widgetId: Int) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove("$KEY_PREFIX_STATION$widgetId").apply()
    }
}
