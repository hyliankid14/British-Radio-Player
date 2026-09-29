package com.hyliankid14.bbcradioplayer

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.bumptech.glide.Glide
import java.util.concurrent.Executors

object WidgetUpdateHelper {
    private const val REQUEST_CODE_ROOT_OFFSET = 100_000
    private const val REQUEST_CODE_PLAY_STOP_OFFSET = 200_000

    private val worker = Executors.newSingleThreadExecutor()

    private val providers = listOf(
        ProviderSpec(StationWidgetSmallProvider::class.java, R.layout.widget_station_small)
    )

    fun updateWidgets(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
        layoutResId: Int
    ) {
        val appContext = context.applicationContext
        appWidgetIds.forEach { id ->
            worker.execute { updateSingleWidget(appContext, appWidgetManager, id, layoutResId) }
        }
    }

    fun updateAllWidgets(context: Context) {
        val appContext = context.applicationContext
        val appWidgetManager = AppWidgetManager.getInstance(appContext)

        providers.forEach { provider ->
            val ids = appWidgetManager.getAppWidgetIds(ComponentName(appContext, provider.providerClass))
            ids.forEach { id ->
                worker.execute { updateSingleWidget(appContext, appWidgetManager, id, provider.layoutResId) }
            }
        }
    }

    private fun updateSingleWidget(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        layoutResId: Int
    ) {
        val selectedStationId = WidgetPreference.getStationForWidget(context, appWidgetId)
            ?: PlaybackPreference.getLastStationId(context)
            ?: StationRepository.getStations().firstOrNull()?.id
            ?: return

        val station = StationRepository.getStationById(selectedStationId) ?: return
        val currentStation = PlaybackStateHelper.getCurrentStation()
        val isCurrentStation = currentStation?.id == station.id
        val isPlaying = PlaybackStateHelper.getIsPlaying() && isCurrentStation
        val currentShow = if (isCurrentStation) PlaybackStateHelper.getCurrentShow() else null

        val resolvedLayoutResId = resolveLayoutForSize(appWidgetManager, appWidgetId, layoutResId)
        val views = RemoteViews(context.packageName, resolvedLayoutResId)

        views.setTextViewText(R.id.widget_station_name, station.title)
        views.setTextViewText(R.id.widget_now_playing, formatNowPlaying(context, currentShow, isCurrentStation, isPlaying))
        
        // Use widget-specific icons with correct colors baked in for proper visibility
        views.setImageViewResource(
            R.id.widget_play_pause,
            if (isPlaying) R.drawable.ic_stop else R.drawable.widget_ic_play
        )

        views.setOnClickPendingIntent(
            R.id.widget_root,
            playStationIntent(context, appWidgetId + REQUEST_CODE_ROOT_OFFSET, station.id)
        )
        views.setOnClickPendingIntent(
            R.id.widget_play_pause,
            if (isPlaying) stopIntent(context, appWidgetId + REQUEST_CODE_PLAY_STOP_OFFSET) else playStationIntent(context, appWidgetId + REQUEST_CODE_PLAY_STOP_OFFSET, station.id)
        )

        appWidgetManager.updateAppWidget(appWidgetId, views)

        // Only use show image artwork (not the BBC station logo); fall back to the generic
        // station icon so BBC branding never appears in the widget background.
        val showArtworkUrl = if (isCurrentStation && !currentShow?.imageUrl.isNullOrEmpty()) {
            currentShow?.imageUrl
        } else {
            null
        }

        val backgroundBitmap: android.graphics.Bitmap = if (!showArtworkUrl.isNullOrEmpty()) {
            try {
                val loaded = Glide.with(context)
                    .asBitmap()
                    .load(showArtworkUrl)
                    .transform(com.bumptech.glide.load.resource.bitmap.CenterCrop())
                    .override(400, 400)
                    .submit()
                    .get()
                applyBlur(context, loaded, 10f)
            } catch (e: Exception) {
                android.util.Log.w("WidgetUpdateHelper", "Failed to load show artwork: ${e.message}")
                applyBlur(context, StationArtwork.createBitmap(station.id, 400), 10f)
            }
        } else {
            applyBlur(context, StationArtwork.createBitmap(station.id, 400), 10f)
        }

        // Load mildly blurred background artwork to mirror Android Auto-like playback cards.
        views.setImageViewBitmap(R.id.widget_background_artwork, backgroundBitmap)
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun resolveLayoutForSize(
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        defaultLayoutResId: Int
    ): Int {
        val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
        val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
        val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)

        if (minHeight >= 170 || minWidth >= 300) {
            return R.layout.widget_station_large
        }
        if (minHeight >= 110 || minWidth >= 220) {
            return R.layout.widget_station_medium
        }
        return defaultLayoutResId
    }

    @Suppress("DEPRECATION")
    private fun applyBlur(context: Context, bitmap: android.graphics.Bitmap, radius: Float): android.graphics.Bitmap {
        return try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                // Use RenderEffect on Android 12+
                val scaledBitmap = android.graphics.Bitmap.createScaledBitmap(bitmap, bitmap.width / 2, bitmap.height / 2, true)
                scaledBitmap
            } else {
                // Use RenderScript for older versions
                val output = android.graphics.Bitmap.createBitmap(
                    bitmap.width,
                    bitmap.height,
                    bitmap.config ?: android.graphics.Bitmap.Config.ARGB_8888
                )
                val rs = android.renderscript.RenderScript.create(context)
                val script = android.renderscript.ScriptIntrinsicBlur.create(rs, android.renderscript.Element.U8_4(rs))
                val input = android.renderscript.Allocation.createFromBitmap(rs, bitmap)
                val outAlloc = android.renderscript.Allocation.createFromBitmap(rs, output)
                script.setRadius(radius.coerceIn(0f, 25f))
                script.setInput(input)
                script.forEach(outAlloc)
                outAlloc.copyTo(output)
                rs.destroy()
                output
            }
        } catch (e: Exception) {
            android.util.Log.w("WidgetUpdateHelper", "Blur failed: ${e.message}")
            // Fallback: just scale down for a softer look
            android.graphics.Bitmap.createScaledBitmap(bitmap, bitmap.width / 2, bitmap.height / 2, true)
        }
    }

    private fun formatNowPlaying(context: Context, show: CurrentShow?, isCurrentStation: Boolean, isPlaying: Boolean): String {
        if (!isCurrentStation || !isPlaying || show == null) {
            return context.getString(R.string.widget_tap_to_play)
        }

        val hasSong = !show.secondary.isNullOrEmpty() || !show.tertiary.isNullOrEmpty()
        if (hasSong) {
            val artist = show.secondary.orEmpty()
            val track = show.tertiary.orEmpty()
            return if (artist.isNotBlank() && track.isNotBlank()) "$artist - $track" else show.getFormattedTitle()
        }

        val episode = show.episodeTitle.orEmpty().trim()
        if (episode.isNotEmpty()) {
            return episode
        }

        val title = show.title.trim()
        if (title.isNotEmpty() && !title.equals("BBC Radio", ignoreCase = true)) {
            return title
        }

        return context.getString(R.string.widget_live)
    }

    private fun playStationIntent(context: Context, requestCode: Int, stationId: String): PendingIntent {
        val intent = Intent(context, RadioService::class.java).apply {
            action = RadioService.ACTION_PLAY_STATION
            putExtra(RadioService.EXTRA_STATION_ID, stationId)
        }
        return PendingIntent.getForegroundService(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun stopIntent(context: Context, requestCode: Int): PendingIntent {
        val intent = Intent(context, RadioService::class.java).apply {
            action = RadioService.ACTION_STOP
        }
        return PendingIntent.getForegroundService(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
    private data class ProviderSpec(
        val providerClass: Class<out BaseStationWidgetProvider>,
        val layoutResId: Int
    )
}
