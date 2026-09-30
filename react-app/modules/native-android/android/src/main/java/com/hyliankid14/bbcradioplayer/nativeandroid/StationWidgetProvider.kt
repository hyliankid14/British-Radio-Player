package com.hyliankid14.bbcradioplayer.nativeandroid

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.hyliankid14.bbcradioplayer.nativeandroid.widget.WidgetRenderer
import com.hyliankid14.bbcradioplayer.nativeandroid.widget.WidgetStore

/**
 * Home screen widget bound to one station.
 *
 * The class name is the one the launcher recorded when the widget was added, so it must
 * not move or be renamed: existing widgets would stop receiving updates. The station a
 * widget shows is chosen by [widget.WidgetConfigActivity] when the widget is added and
 * stored per widget id, so several widgets can point at different stations at once.
 */
class StationWidgetProvider : AppWidgetProvider() {

  companion object {
    /** Broadcast a widget tap sends back here before the app is brought to the front. */
    const val ACTION_WIDGET_ACTION = "com.hyliankid14.bbcradioplayer.action.WIDGET_ACTION"
    const val EXTRA_WIDGET_ACTION = "widget_action"
    const val EXTRA_STATION_ID = "widget_station_id"

    const val ACTION_PLAY = "play"
    const val ACTION_STOP = "stop"

    private const val TAG = "StationWidgetProvider"

    /** Stores what the player is doing and redraws every widget. Pushed from React. */
    fun updateState(
      context: Context,
      stationId: String,
      stationTitle: String,
      showLine: String,
      isPlaying: Boolean,
      artworkUrl: String
    ) {
      WidgetStore.saveLiveState(context, stationId, stationTitle, showLine, isPlaying, artworkUrl)
      WidgetRenderer.renderAll(context)
    }

    fun refresh(context: Context) = WidgetRenderer.renderAll(context)
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    WidgetRenderer.render(context, appWidgetIds)
  }

  /** A widget can be resized, which swaps the layout it renders into. */
  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle?
  ) {
    WidgetRenderer.render(context, intArrayOf(appWidgetId))
  }

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    appWidgetIds.forEach { WidgetStore.deleteWidget(context, it) }
  }

  override fun onEnabled(context: Context) = WidgetRenderer.renderAll(context)

  override fun onDisabled(context: Context) = WidgetRenderer.renderAll(context)

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action != ACTION_WIDGET_ACTION) return

    val action = intent.getStringExtra(EXTRA_WIDGET_ACTION) ?: return
    val stationId = intent.getStringExtra(EXTRA_STATION_ID)
    // Recorded before the app starts, so the action survives both a cold start and a tap
    // that only warms a process already running in the background.
    WidgetStore.recordAction(context, action, stationId)
    launchApp(context)
  }

  private fun launchApp(context: Context) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    try {
      context.startActivity(launch)
    } catch (error: Exception) {
      Log.w(TAG, "Widget tap could not open the app: ${error.message}")
    }
  }
}
