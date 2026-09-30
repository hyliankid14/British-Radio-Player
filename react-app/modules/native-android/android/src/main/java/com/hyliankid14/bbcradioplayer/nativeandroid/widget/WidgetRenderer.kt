package com.hyliankid14.bbcradioplayer.nativeandroid.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import android.widget.RemoteViews
import com.hyliankid14.bbcradioplayer.nativeandroid.R
import com.hyliankid14.bbcradioplayer.nativeandroid.StationWidgetProvider
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Renders every home screen widget.
 *
 * Each widget points at one station, chosen when it was added. The player state pushed
 * down by the React layer only decorates the widget that points at the station currently
 * playing; every other widget keeps showing its own station and offers to play it.
 *
 * Rendering happens on a worker thread because a widget's background is a decoded,
 * blurred bitmap and decoding on the main thread of a broadcast receiver is a jank risk.
 */
object WidgetRenderer {
  private const val TAG = "WidgetRenderer"

  /** Keeps one PendingIntent per widget per tap target, since extras are not part of identity. */
  private const val REQUEST_CODE_ROOT_OFFSET = 100_000
  private const val REQUEST_CODE_BUTTON_OFFSET = 200_000

  private const val ARTWORK_SIZE = 400

  private val worker = Executors.newSingleThreadExecutor()

  /** Downloaded show artwork, keyed by URL. Small, because only the playing widget uses it. */
  private val remoteArtwork = object : LinkedHashMap<String, Bitmap>(0, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>): Boolean =
      size > 4
  }

  fun render(context: Context, appWidgetIds: IntArray) {
    val appContext = context.applicationContext
    val manager = AppWidgetManager.getInstance(appContext)
    appWidgetIds.forEach { id -> worker.execute { renderOne(appContext, manager, id) } }
  }

  fun renderAll(context: Context) {
    val appContext = context.applicationContext
    val ids = AppWidgetManager.getInstance(appContext)
      .getAppWidgetIds(ComponentName(appContext, StationWidgetProvider::class.java))
    render(appContext, ids)
  }

  private fun renderOne(context: Context, manager: AppWidgetManager, appWidgetId: Int) {
    val station = resolveStation(context, appWidgetId) ?: return
    val live = WidgetStore.liveState(context)
    val isCurrentStation = station.id == live.stationId
    val isPlaying = live.isPlaying && isCurrentStation

    val views = RemoteViews(context.packageName, layoutForSize(manager, appWidgetId))
    views.setTextViewText(R.id.widget_station_name, station.title)
    views.setTextViewText(
      R.id.widget_now_playing,
      formatNowPlaying(context, live, isCurrentStation, isPlaying)
    )
    views.setImageViewResource(
      R.id.widget_play_pause,
      if (isPlaying) R.drawable.ic_widget_stop else R.drawable.widget_ic_play
    )
    views.setOnClickPendingIntent(
      R.id.widget_root,
      actionIntent(context, appWidgetId + REQUEST_CODE_ROOT_OFFSET, StationWidgetProvider.ACTION_PLAY, station.id)
    )
    views.setOnClickPendingIntent(
      R.id.widget_play_pause,
      actionIntent(
        context,
        appWidgetId + REQUEST_CODE_BUTTON_OFFSET,
        if (isPlaying) StationWidgetProvider.ACTION_STOP else StationWidgetProvider.ACTION_PLAY,
        station.id
      )
    )

    val background = backgroundArtwork(context, station, live, isCurrentStation)
    views.setImageViewBitmap(R.id.widget_background_artwork, background)
    manager.updateAppWidget(appWidgetId, views)
  }

  /**
   * The station a widget shows. Falls back to whatever the player last used, then to the
   * first station in the catalogue, so a widget added without a selection is never blank.
   */
  private fun resolveStation(context: Context, appWidgetId: Int): WidgetStation? {
    val catalogue = WidgetStore.catalogue(context)
    val candidates = listOfNotNull(
      WidgetStore.stationForWidget(context, appWidgetId),
      WidgetStore.liveState(context).stationId.takeIf { it.isNotEmpty() },
      catalogue.firstOrNull()?.id
    )
    return candidates.firstNotNullOfOrNull { id -> catalogue.firstOrNull { it.id == id } }
  }

  /** One scalable widget, laid out for whichever of the three sizes the launcher gave it. */
  private fun layoutForSize(manager: AppWidgetManager, appWidgetId: Int): Int {
    val options = manager.getAppWidgetOptions(appWidgetId)
    val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
    val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
    return when {
      minHeight >= 170 || minWidth >= 300 -> R.layout.widget_station_large
      minHeight >= 110 || minWidth >= 220 -> R.layout.widget_station_medium
      else -> R.layout.widget_station_small
    }
  }

  /**
   * The legacy ladder, kept because the two platforms have to agree on the wording:
   * "tap to play" while nothing is playing, then the song, the episode, the programme,
   * and finally "live now" when the show is the generic BBC Radio placeholder.
   */
  private fun formatNowPlaying(
    context: Context,
    live: WidgetLiveState,
    isCurrentStation: Boolean,
    isPlaying: Boolean
  ): String {
    if (!isCurrentStation || !isPlaying) return context.getString(R.string.widget_tap_to_play)
    val line = live.showLine.trim()
    if (line.isNotEmpty()) return line
    val title = live.stationTitle.trim()
    if (title.isNotEmpty() && !title.equals("BBC Radio", ignoreCase = true)) return title
    return context.getString(R.string.widget_live)
  }

  /**
   * Show artwork for the station being played, otherwise generated station artwork. The
   * BBC station logo is deliberately never used, so BBC branding stays out of the widget.
   */
  private fun backgroundArtwork(
    context: Context,
    station: WidgetStation,
    live: WidgetLiveState,
    isCurrentStation: Boolean
  ): Bitmap {
    val url = live.artworkUrl.takeIf { isCurrentStation && it.isNotEmpty() }
    val source = url?.let { downloadArtwork(it) } ?: return StationArtwork.createBitmap(station.id, ARTWORK_SIZE)
    return soften(source)
  }

  private fun downloadArtwork(url: String): Bitmap? {
    synchronized(remoteArtwork) { remoteArtwork[url] }?.let { return it }
    var connection: HttpURLConnection? = null
    return try {
      connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 5_000
        readTimeout = 5_000
        instanceFollowRedirects = true
      }
      if (connection.responseCode !in 200..299) return null
      connection.inputStream.use { decodeArtwork(it) }?.also { bitmap ->
        synchronized(remoteArtwork) { remoteArtwork[url] = bitmap }
      }
    } catch (error: Exception) {
      Log.w(TAG, "Failed to load widget artwork: ${error.message}")
      null
    } finally {
      connection?.disconnect()
    }
  }

  private fun decodeArtwork(stream: InputStream): Bitmap? {
    val bytes = stream.readBytes()
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sampleSize = 1
    while (bounds.outWidth / sampleSize > ARTWORK_SIZE * 2 || bounds.outHeight / sampleSize > ARTWORK_SIZE * 2) {
      sampleSize *= 2
    }
    val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
  }

  /**
   * Softens the artwork so the text stays readable over it. Android 12 removed the
   * RenderScript blur and RemoteViews cannot host a RenderEffect, so the portable softening
   * is a downscale: the widget draws it back up, which reads as a blur.
   */
  private fun soften(bitmap: Bitmap): Bitmap =
    downscale(bitmap)

  private fun downscale(bitmap: Bitmap): Bitmap =
    Bitmap.createScaledBitmap(bitmap, (bitmap.width / 2).coerceAtLeast(1), (bitmap.height / 2).coerceAtLeast(1), true)

  /**
   * Widget taps are broadcast to the provider rather than sent straight to the activity:
   * the receiver records the action before the app is brought to front, so a tap that
   * warms a running app is not lost the way a launch-intent extra would be.
   */
  private fun actionIntent(context: Context, requestCode: Int, action: String, stationId: String): PendingIntent {
    val intent = Intent(context, StationWidgetProvider::class.java).apply {
      this.action = StationWidgetProvider.ACTION_WIDGET_ACTION
      putExtra(StationWidgetProvider.EXTRA_WIDGET_ACTION, action)
      putExtra(StationWidgetProvider.EXTRA_STATION_ID, stationId)
    }
    return PendingIntent.getBroadcast(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}
