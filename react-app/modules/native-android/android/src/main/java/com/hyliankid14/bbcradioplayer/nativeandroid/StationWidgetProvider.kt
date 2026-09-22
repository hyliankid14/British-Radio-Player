package com.hyliankid14.bbcradioplayer.nativeandroid

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * Home screen widget showing the current station and playback state, with a play/pause
 * toggle. Mirrors the legacy Kotlin `StationWidgetProvider` behaviour.
 */
class StationWidgetProvider : AppWidgetProvider() {

  companion object {
    const val ACTION_TOGGLE = "com.hyliankid14.bbcradioplayer.action.WIDGET_TOGGLE"
    const val ACTION_UPDATE = "com.hyliankid14.bbcradioplayer.action.WIDGET_UPDATE"
    const val EXTRA_WIDGET_TOGGLE = "widget_toggle"

    private const val PREFS = "widget_state"
    private const val KEY_STATION_TITLE = "station_title"
    private const val KEY_SHOW_TITLE = "show_title"
    private const val KEY_IS_PLAYING = "is_playing"

    fun updateState(context: Context, stationTitle: String, showTitle: String, isPlaying: Boolean) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString(KEY_STATION_TITLE, stationTitle)
        .putString(KEY_SHOW_TITLE, showTitle)
        .putBoolean(KEY_IS_PLAYING, isPlaying)
        .apply()
      refresh(context)
    }

    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context) ?: return
      val component = ComponentName(context, StationWidgetProvider::class.java)
      val ids = manager.getAppWidgetIds(component)
      if (ids.isEmpty()) return
      val intent = Intent(context, StationWidgetProvider::class.java).apply {
        action = ACTION_UPDATE
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
      }
      context.sendBroadcast(intent)
    }

    private fun launchIntent(context: Context, toggle: Boolean): PendingIntent {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra(EXTRA_WIDGET_TOGGLE, toggle)
      }
      return PendingIntent.getActivity(
        context,
        if (toggle) 9402 else 9401,
        launch ?: Intent(),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    private fun render(context: Context, appWidgetId: Int) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val stationTitle = prefs.getString(KEY_STATION_TITLE, null) ?: "British Radio Player"
      val showTitle = prefs.getString(KEY_SHOW_TITLE, "") ?: ""
      val isPlaying = prefs.getBoolean(KEY_IS_PLAYING, false)

      val views = RemoteViews(context.packageName, R.layout.widget_station).apply {
        setTextViewText(R.id.widget_station_title, stationTitle)
        setTextViewText(R.id.widget_show_title, showTitle.ifBlank { "Tap to open" })
        setImageViewResource(
          R.id.widget_play_pause,
          if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        )
        setOnClickPendingIntent(R.id.widget_root, launchIntent(context, false))
        setOnClickPendingIntent(R.id.widget_play_pause, launchIntent(context, true))
      }

      AppWidgetManager.getInstance(context)?.updateAppWidget(appWidgetId, views)
    }
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    appWidgetIds.forEach { render(context, it) }
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action == ACTION_UPDATE) {
      val ids = intent.getIntArrayExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS)
        ?: AppWidgetManager.getInstance(context)
          .getAppWidgetIds(ComponentName(context, StationWidgetProvider::class.java))
      ids.forEach { render(context, it) }
    }
  }
}
