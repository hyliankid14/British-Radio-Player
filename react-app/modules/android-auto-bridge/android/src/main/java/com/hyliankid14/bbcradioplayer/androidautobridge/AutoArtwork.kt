package com.hyliankid14.bbcradioplayer.androidautobridge

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface

/**
 * Offline station artwork for Android Auto browse entries.
 *
 * Mirrors the Kotlin app's `StationArtwork`: every station is assigned a distinctive
 * background colour plus a short label so head units always have usable imagery even
 * when remote artwork is unavailable.
 */
object AutoArtwork {

  data class Config(
    val backgroundColor: Int,
    val label: String,
    val circleColor: Int = Color.parseColor("#1A1A1A"),
    val textColor: Int = Color.WHITE,
    val badgeLabel: String? = null
  )

  private val configs: Map<String, Config> = mapOf(
    // National
    "radio1" to Config(Color.parseColor("#F5247F"), "1"),
    "1xtra" to Config(Color.parseColor("#231F20"), "1X", circleColor = Color.parseColor("#CC0000")),
    "radio1dance" to Config(Color.parseColor("#0D0D0D"), "1D", circleColor = Color.parseColor("#CC0066")),
    "radio1anthems" to Config(Color.parseColor("#0056B8"), "1A"),
    "radio2" to Config(Color.parseColor("#E66B21"), "2"),
    "radio3" to Config(Color.parseColor("#C13131"), "3"),
    "radio3unwind" to Config(Color.parseColor("#4A2080"), "3U", circleColor = Color.parseColor("#6A40A0")),
    "radio4" to Config(Color.parseColor("#1B6CA8"), "4"),
    "radio4extra" to Config(Color.parseColor("#9B1D73"), "4+"),
    "radio5live" to Config(Color.parseColor("#009EAA"), "5"),
    "radio5livesportsextra" to Config(Color.parseColor("#009EAA"), "5S"),
    "radio5livesportsextra2" to Config(Color.parseColor("#000000"), "5S", circleColor = Color.parseColor("#009EAA"), badgeLabel = "2"),
    "radio5livesportsextra3" to Config(Color.parseColor("#000000"), "5S", circleColor = Color.parseColor("#009EAA"), badgeLabel = "3"),
    "radio6" to Config(Color.parseColor("#007749"), "6"),
    "worldservice" to Config(Color.parseColor("#BB1919"), "WS"),
    "asiannetwork" to Config(Color.parseColor("#703FA0"), "AN"),

    // Regions
    "radiocymru" to Config(Color.parseColor("#0057A8"), "CY"),
    "radiocymru2" to Config(Color.parseColor("#007C55"), "CY2"),
    "radiofoyle" to Config(Color.parseColor("#007C55"), "FO"),
    "radiogaidheal" to Config(Color.parseColor("#0093C5"), "GD"),
    "radioorkney" to Config(Color.parseColor("#C43A8A"), "OR"),
    "radioscotland" to Config(Color.parseColor("#7B5EA7"), "SC"),
    "radioscotlandextra" to Config(Color.parseColor("#7B5EA7"), "SC+"),
    "radioshetland" to Config(Color.parseColor("#D4478A"), "SH"),
    "radioulster" to Config(Color.parseColor("#007C55"), "UL"),
    "radiowales" to Config(Color.parseColor("#D84315"), "WA"),
    "radiowalesextra" to Config(Color.parseColor("#D84315"), "WA+"),

    // Local (England & Channel Islands)
    "radioberkshire" to Config(Color.BLACK, "BE"),
    "radiobristol" to Config(Color.BLACK, "BR"),
    "radiocambridge" to Config(Color.BLACK, "CA"),
    "radiocornwall" to Config(Color.BLACK, "CO"),
    "radiocoventrywarwickshire" to Config(Color.BLACK, "CW"),
    "radiocumbria" to Config(Color.BLACK, "CU"),
    "radioderby" to Config(Color.BLACK, "DE"),
    "radiodevon" to Config(Color.BLACK, "DV"),
    "radioessex" to Config(Color.BLACK, "ES"),
    "radiogloucestershire" to Config(Color.BLACK, "GL"),
    "radioguernsey" to Config(Color.BLACK, "GU"),
    "radioherefordworcester" to Config(Color.BLACK, "HW"),
    "radiohumberside" to Config(Color.BLACK, "HU"),
    "radiojersey" to Config(Color.BLACK, "JE"),
    "radiokent" to Config(Color.BLACK, "KE"),
    "radiolancashire" to Config(Color.BLACK, "LA"),
    "radioleeds" to Config(Color.BLACK, "LE"),
    "radioleicester" to Config(Color.BLACK, "LR"),
    "radiolincolnshire" to Config(Color.BLACK, "LI"),
    "radiolon" to Config(Color.BLACK, "LO"),
    "radiomanchester" to Config(Color.BLACK, "MA"),
    "radiomerseyside" to Config(Color.BLACK, "ME"),
    "radionewcastle" to Config(Color.BLACK, "NE"),
    "radionorfolk" to Config(Color.BLACK, "NF"),
    "radionorthampton" to Config(Color.BLACK, "NO"),
    "radionottingham" to Config(Color.BLACK, "NT"),
    "radiooxford" to Config(Color.BLACK, "OX"),
    "radiosheffield" to Config(Color.BLACK, "SF"),
    "radioshropshire" to Config(Color.BLACK, "SR"),
    "radiosolent" to Config(Color.BLACK, "SO"),
    "radiosolentwestdorset" to Config(Color.BLACK, "SD"),
    "radiosomerset" to Config(Color.BLACK, "SM"),
    "radiostoke" to Config(Color.BLACK, "ST"),
    "radiosuffolk" to Config(Color.BLACK, "SU"),
    "radiosurrey" to Config(Color.BLACK, "SY"),
    "radiosussex" to Config(Color.BLACK, "SX"),
    "radiotees" to Config(Color.BLACK, "TE"),
    "radiothreecounties" to Config(Color.BLACK, "3C"),
    "radiowestmidlands" to Config(Color.BLACK, "WM"),
    "radiowiltshire" to Config(Color.BLACK, "WL"),
    "radioyork" to Config(Color.BLACK, "YO")
  )

  private fun configFor(stationId: String): Config =
    configs[stationId] ?: Config(Color.parseColor("#4A4A8A"), stationId.take(2).uppercase())

  private val bitmapCache = mutableMapOf<String, Bitmap>()

  /** Renders the station logo for [stationId] into a [size]x[size] bitmap, cached per id/size. */
  @Synchronized
  fun createBitmap(stationId: String, size: Int = 256): Bitmap =
    bitmapCache.getOrPut("$stationId:$size") { render(configFor(stationId), size) }

  private fun render(config: Config, size: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(config.backgroundColor)

    val circle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = config.circleColor }
    val radius = size * 0.42f
    canvas.drawCircle(size / 2f, size / 2f, radius, circle)

    val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = config.textColor
      textAlign = Paint.Align.CENTER
      typeface = Typeface.create(Typeface.DEFAULT_BOLD, Typeface.BOLD)
    }
    val normalizedLabel = config.label.uppercase()
    val baseTextSize = radius * 1.58f
    label.textSize = baseTextSize
    val maxTextWidth = radius * 1.72f
    val measuredWidth = label.measureText(normalizedLabel)
    if (measuredWidth > maxTextWidth && measuredWidth > 0f) {
      label.textSize = baseTextSize * (maxTextWidth / measuredWidth)
    }
    val metrics = label.fontMetrics
    val centerY = size / 2f - (metrics.ascent + metrics.descent) / 2f
    canvas.drawText(normalizedLabel, size / 2f, centerY, label)

    val badge = config.badgeLabel?.trim().orEmpty()
    if (badge.isNotEmpty()) {
      val badgeRadius = size * 0.12f
      val badgeCx = size / 2f + radius * 0.78f
      val badgeCy = size / 2f - radius * 0.78f
      val badgeCirclePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#111111") }
      canvas.drawCircle(badgeCx, badgeCy, badgeRadius, badgeCirclePaint)

      val badgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create(Typeface.DEFAULT_BOLD, Typeface.BOLD)
        textSize = badgeRadius * 1.4f
      }
      val bm = badgePaint.fontMetrics
      val badgeTextY = badgeCy - (bm.ascent + bm.descent) / 2f
      canvas.drawText(badge, badgeCx, badgeTextY, badgePaint)
    }

    return bitmap
  }
}
