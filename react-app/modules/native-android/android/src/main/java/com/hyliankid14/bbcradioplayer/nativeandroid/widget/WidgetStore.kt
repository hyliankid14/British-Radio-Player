package com.hyliankid14.bbcradioplayer.nativeandroid.widget

import android.content.Context
import org.json.JSONObject

/** A station the widget can be pointed at, pushed down from the React station catalogue. */
data class WidgetStation(
  val id: String,
  val title: String,
  val category: String
)

/** What the player is doing right now, used to decorate a widget that points at that station. */
data class WidgetLiveState(
  val stationId: String,
  val stationTitle: String,
  val showLine: String,
  val isPlaying: Boolean,
  val artworkUrl: String
)

/** One row of the station picker: either a category heading or a selectable station. */
sealed class WidgetStationRow {
  data class Header(val category: String) : WidgetStationRow()
  data class Station(val station: WidgetStation) : WidgetStationRow()
}

/**
 * Persistence for the home screen widgets.
 *
 * The React application owns the station catalogue and the playback state; it pushes both
 * here through the native module, and the widget reads them when it renders. Per-widget
 * station selections are owned by this side because they only exist to answer "which
 * station does widget 7 show", which the app itself never asks about.
 */
object WidgetStore {
  private const val PREFS = "brp_widget"
  private const val LEGACY_PREFS = "widget_prefs"
  private const val KEY_PREFIX_STATION = "widget_station_"

  private const val KEY_CATALOGUE = "catalogue_json"
  private const val KEY_STATION_ID = "station_id"
  private const val KEY_STATION_TITLE = "station_title"
  private const val KEY_SHOW_LINE = "show_line"
  private const val KEY_IS_PLAYING = "is_playing"
  private const val KEY_ARTWORK_URL = "artwork_url"
  private const val KEY_PENDING_ACTION = "pending_action"
  private const val KEY_PENDING_STATION_ID = "pending_station_id"

  /** Category order the picker groups stations by, matching the in-app station list. */
  val CATEGORY_ORDER = listOf("National", "Regions", "Local")

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ── Station catalogue ────────────────────────────────────────────────────────

  /** Stores the catalogue as `{"stations":[{"id","title","category"}]}` from the React layer. */
  fun saveCatalogue(context: Context, json: String) {
    val parsed = runCatching { parseCatalogue(json) }.getOrDefault(emptyList())
    // An empty catalogue is never worth writing: it would wipe the stations a picker may
    // still be showing, and it only ever arrives when the push itself failed.
    if (parsed.isEmpty()) return
    prefs(context).edit().putString(KEY_CATALOGUE, json).apply()
  }

  fun catalogue(context: Context): List<WidgetStation> {
    val raw = prefs(context).getString(KEY_CATALOGUE, null) ?: return emptyList()
    return runCatching { parseCatalogue(raw) }.getOrDefault(emptyList())
  }

  private fun parseCatalogue(json: String): List<WidgetStation> {
    val array = JSONObject(json).optJSONArray("stations") ?: return emptyList()
    val stations = ArrayList<WidgetStation>(array.length())
    for (index in 0 until array.length()) {
      val entry = array.optJSONObject(index) ?: continue
      val id = entry.optString("id").trim()
      val title = entry.optString("title").trim()
      if (id.isEmpty() || title.isEmpty()) continue
      stations.add(WidgetStation(id, title, entry.optString("category").trim()))
    }
    return stations
  }

  /** Stations grouped into picker rows: a category header followed by its stations. */
  fun catalogueRows(context: Context): List<WidgetStationRow> {
    val stations = catalogue(context)
    if (stations.isEmpty()) return emptyList()

    val ordered = CATEGORY_ORDER.flatMap { category -> stations.filter { it.category == category } } +
      stations.filter { station -> station.category !in CATEGORY_ORDER }
    val rows = ArrayList<WidgetStationRow>(ordered.size + CATEGORY_ORDER.size)
    var previous: String? = null
    for (station in ordered) {
      if (station.category != previous) {
        rows.add(WidgetStationRow.Header(station.category))
        previous = station.category
      }
      rows.add(WidgetStationRow.Station(station))
    }
    return rows
  }

  // ── Per-widget station selection ─────────────────────────────────────────────

  /**
   * The station a widget shows: the one chosen when it was added, otherwise the station
   * the player last used. Widgets added before a selection was made follow the player.
   */
  fun stationForWidget(context: Context, widgetId: Int): String? {
    val selected = prefs(context).getString("$KEY_PREFIX_STATION$widgetId", null)
    if (!selected.isNullOrEmpty()) return selected
    // An upgrade from the native app leaves per-widget bindings in the old preferences
    // file; honour them so an existing home screen keeps the station the user picked.
    val legacy = context.applicationContext
      .getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
      .getString("$KEY_PREFIX_STATION$widgetId", null)
    return legacy?.takeIf { it.isNotEmpty() }
  }

  fun setStationForWidget(context: Context, widgetId: Int, stationId: String) {
    prefs(context).edit().putString("$KEY_PREFIX_STATION$widgetId", stationId).apply()
  }

  fun deleteWidget(context: Context, widgetId: Int) {
    prefs(context).edit().remove("$KEY_PREFIX_STATION$widgetId").apply()
  }

  // ── Live playback state ──────────────────────────────────────────────────────

  fun saveLiveState(
    context: Context,
    stationId: String,
    stationTitle: String,
    showLine: String,
    isPlaying: Boolean,
    artworkUrl: String
  ) {
    prefs(context).edit()
      .putString(KEY_STATION_ID, stationId)
      .putString(KEY_STATION_TITLE, stationTitle)
      .putString(KEY_SHOW_LINE, showLine)
      .putBoolean(KEY_IS_PLAYING, isPlaying)
      .putString(KEY_ARTWORK_URL, artworkUrl)
      .apply()
  }

  fun liveState(context: Context): WidgetLiveState {
    val prefs = prefs(context)
    return WidgetLiveState(
      stationId = prefs.getString(KEY_STATION_ID, "") ?: "",
      stationTitle = prefs.getString(KEY_STATION_TITLE, "") ?: "",
      showLine = prefs.getString(KEY_SHOW_LINE, "") ?: "",
      isPlaying = prefs.getBoolean(KEY_IS_PLAYING, false),
      artworkUrl = prefs.getString(KEY_ARTWORK_URL, "") ?: ""
    )
  }

  // ── Actions queued by widget taps ────────────────────────────────────────────

  fun recordAction(context: Context, action: String, stationId: String?) {
    val editor = prefs(context).edit().putString(KEY_PENDING_ACTION, action)
    if (stationId.isNullOrEmpty()) editor.remove(KEY_PENDING_STATION_ID) else editor.putString(KEY_PENDING_STATION_ID, stationId)
    editor.apply()
  }

  /** Returns the queued action as JSON and clears it, so one tap is never handled twice. */
  fun consumeAction(context: Context): String? {
    val prefs = prefs(context)
    val action = prefs.getString(KEY_PENDING_ACTION, null)?.takeIf { it.isNotEmpty() } ?: return null
    val stationId = prefs.getString(KEY_PENDING_STATION_ID, null)
    prefs.edit().remove(KEY_PENDING_ACTION).remove(KEY_PENDING_STATION_ID).apply()
    return JSONObject()
      .put("action", action)
      .put("stationId", stationId ?: JSONObject.NULL)
      .toString()
  }
}
