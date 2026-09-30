package com.hyliankid14.bbcradioplayer.nativeandroid.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.ImageView
import android.widget.ListView
import android.widget.TextView
import com.hyliankid14.bbcradioplayer.nativeandroid.R

/**
 * Station picker shown by the launcher when a widget is added.
 *
 * The launcher keeps the widget only if this finishes with [AppWidgetManager.EXTRA_APPWIDGET_ID]
 * in a RESULT_OK intent, so backing out leaves no widget behind. The station list is the one
 * the React layer pushed down, so the picker always offers exactly the stations the app plays.
 */
class WidgetConfigActivity : Activity() {

  private var appWidgetId: Int = AppWidgetManager.INVALID_APPWIDGET_ID

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setResult(RESULT_CANCELED)

    appWidgetId = intent?.extras?.getInt(
      AppWidgetManager.EXTRA_APPWIDGET_ID,
      AppWidgetManager.INVALID_APPWIDGET_ID
    ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

    if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }

    setContentView(R.layout.activity_widget_config)
    val list = findViewById<ListView>(R.id.widget_station_list)
    val empty = findViewById<TextView>(R.id.widget_station_empty)
    val rows = WidgetStore.catalogueRows(this)

    if (rows.isEmpty()) {
      // The catalogue only arrives once the app has run, which it must have before a
      // widget can be added, so this means the push failed rather than the user acting
      // too early. Say so instead of showing a list the user cannot pick from.
      list.visibility = View.GONE
      empty.visibility = View.VISIBLE
      return
    }

    list.adapter = WidgetStationAdapter(layoutInflater, rows) { station -> onStationSelected(station.id) }
  }

  private fun onStationSelected(stationId: String) {
    WidgetStore.setStationForWidget(this, appWidgetId, stationId)
    WidgetRenderer.renderAll(this)
    setResult(
      RESULT_OK,
      Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
    )
    finish()
  }
}

/** Renders the categorised station list. Artwork is generated locally, so this never waits on the network. */
private class WidgetStationAdapter(
  private val inflater: LayoutInflater,
  private val rows: List<WidgetStationRow>,
  private val onSelected: (WidgetStation) -> Unit
) : BaseAdapter() {

  override fun getCount(): Int = rows.size

  override fun getItem(position: Int): Any = rows[position]

  override fun getItemId(position: Int): Long = position.toLong()

  override fun getViewTypeCount(): Int = 2

  override fun getItemViewType(position: Int): Int =
    if (rows[position] is WidgetStationRow.Header) TYPE_HEADER else TYPE_STATION

  override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
    return when (val row = rows[position]) {
      is WidgetStationRow.Header -> headerView(row, convertView, parent)
      is WidgetStationRow.Station -> stationView(row.station, convertView, parent)
    }
  }

  private fun headerView(row: WidgetStationRow.Header, convertView: View?, parent: ViewGroup?): View {
    val view = convertView ?: inflater.inflate(R.layout.widget_station_header, parent, false)
    view.findViewById<TextView>(R.id.widget_category_title).text = row.category
    return view
  }

  private fun stationView(station: WidgetStation, convertView: View?, parent: ViewGroup?): View {
    val view = convertView ?: inflater.inflate(R.layout.widget_station_row, parent, false)
    view.findViewById<TextView>(R.id.widget_row_title).text = station.title
    view.findViewById<ImageView>(R.id.widget_row_artwork).setImageDrawable(
      StationArtwork.createDrawable(station.id)
    )
    view.setOnClickListener { onSelected(station) }
    return view
  }

  private companion object {
    const val TYPE_HEADER = 0
    const val TYPE_STATION = 1
  }
}
