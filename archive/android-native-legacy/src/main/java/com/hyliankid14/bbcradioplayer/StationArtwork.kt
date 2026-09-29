package com.hyliankid14.bbcradioplayer

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import androidx.core.graphics.ColorUtils

/**
 * Generic station artwork configuration.
 *
 * Each station is assigned a distinctive background colour and a short label (number or
 * two-letter abbreviation). These are used to render [StationLogoDrawable] – artwork that
 * carries no BBC branding and is available offline.
 *
 * The drawable is used as both a loading placeholder and an error fallback in every
 * place that loads station imagery via Glide.
 */
object StationArtwork {

    data class Config(
        val backgroundColor: Int,
        val label: String,
        /** Colour of the circle that contains the label. Defaults to near-black. */
        val circleColor: Int = Color.parseColor("#1A1A1A"),
        /** Colour of the label text. Defaults to white. */
        val textColor: Int = Color.WHITE,
        /** Optional small badge in the top-right corner (used for station variants). */
        val badgeLabel: String? = null
    )

    private val configs: Map<String, Config> = mapOf(

        // ── National ─────────────────────────────────────────────────────────
        "radio1"                    to Config(Color.parseColor("#F5247F"), "1"),
        "1xtra"                     to Config(Color.parseColor("#231F20"), "1X",
                                               circleColor = Color.parseColor("#CC0000")),
        "radio1dance"               to Config(Color.parseColor("#0D0D0D"), "1D",
                                               circleColor = Color.parseColor("#CC0066")),
        "radio1anthems"             to Config(Color.parseColor("#0056B8"), "1A"),
        "radio2"                    to Config(Color.parseColor("#E66B21"), "2"),
        "radio3"                    to Config(Color.parseColor("#C13131"), "3"),
        "radio3unwind"              to Config(Color.parseColor("#4A2080"), "3U",
                                               circleColor = Color.parseColor("#6A40A0")),
        "radio4"                    to Config(Color.parseColor("#1B6CA8"), "4"),
        "radio4extra"               to Config(Color.parseColor("#9B1D73"), "4+"),
        "radio5live"                to Config(Color.parseColor("#009EAA"), "5"),
        "radio5livesportsextra"     to Config(Color.parseColor("#009EAA"), "5S"),
        "radio5livesportsextra2"    to Config(Color.parseColor("#000000"), "5S",
                                               circleColor = Color.parseColor("#009EAA"), badgeLabel = "2"),
        "radio5livesportsextra3"    to Config(Color.parseColor("#000000"), "5S",
                                               circleColor = Color.parseColor("#009EAA"), badgeLabel = "3"),
        "radio6"                    to Config(Color.parseColor("#007749"), "6"),
        "worldservice"              to Config(Color.parseColor("#BB1919"), "WS"),
        "asiannetwork"              to Config(Color.parseColor("#703FA0"), "AN"),

        // ── Regions ───────────────────────────────────────────────────────────
        "radiocymru"                to Config(Color.parseColor("#0057A8"), "CY"),
        "radiocymru2"               to Config(Color.parseColor("#007C55"), "CY2"),
        "radiofoyle"                to Config(Color.parseColor("#007C55"), "FO"),
        "radiogaidheal"             to Config(Color.parseColor("#0093C5"), "GD"),
        "radioorkney"               to Config(Color.parseColor("#C43A8A"), "OR"),
        "radioscotland"             to Config(Color.parseColor("#7B5EA7"), "SC"),
        "radioscotlandextra"        to Config(Color.parseColor("#7B5EA7"), "SC+"),
        "radioshetland"             to Config(Color.parseColor("#D4478A"), "SH"),
        "radioulster"               to Config(Color.parseColor("#007C55"), "UL"),
        "radiowales"                to Config(Color.parseColor("#D84315"), "WA"),
        "radiowalesextra"           to Config(Color.parseColor("#D84315"), "WA+"),

        // ── Local (England & Channel Islands) ────────────────────────────────
        "radioberkshire"            to Config(Color.parseColor("#000000"), "BE"),
        "radiobristol"              to Config(Color.parseColor("#000000"), "BR"),
        "radiocambridge"            to Config(Color.parseColor("#000000"), "CA"),
        "radiocornwall"             to Config(Color.parseColor("#000000"), "CO"),
        "radiocoventrywarwickshire" to Config(Color.parseColor("#000000"), "CW"),
        "radiocumbria"              to Config(Color.parseColor("#000000"), "CU"),
        "radioderby"                to Config(Color.parseColor("#000000"), "DE"),
        "radiodevon"                to Config(Color.parseColor("#000000"), "DV"),
        "radioessex"                to Config(Color.parseColor("#000000"), "ES"),
        "radiogloucestershire"      to Config(Color.parseColor("#000000"), "GL"),
        "radioguernsey"             to Config(Color.parseColor("#000000"), "GU"),
        "radioherefordworcester"    to Config(Color.parseColor("#000000"), "HW"),
        "radiohumberside"           to Config(Color.parseColor("#000000"), "HU"),
        "radiojersey"               to Config(Color.parseColor("#000000"), "JE"),
        "radiokent"                 to Config(Color.parseColor("#000000"), "KE"),
        "radiolancashire"           to Config(Color.parseColor("#000000"), "LA"),
        "radioleeds"                to Config(Color.parseColor("#000000"), "LE"),
        "radioleicester"            to Config(Color.parseColor("#000000"), "LR"),
        "radiolincolnshire"         to Config(Color.parseColor("#000000"), "LI"),
        "radiolon"                  to Config(Color.parseColor("#000000"), "LO"),
        "radiomanchester"           to Config(Color.parseColor("#000000"), "MA"),
        "radiomerseyside"           to Config(Color.parseColor("#000000"), "ME"),
        "radionewcastle"            to Config(Color.parseColor("#000000"), "NE"),
        "radionorfolk"              to Config(Color.parseColor("#000000"), "NF"),
        "radionorthampton"          to Config(Color.parseColor("#000000"), "NO"),
        "radionottingham"           to Config(Color.parseColor("#000000"), "NT"),
        "radiooxford"               to Config(Color.parseColor("#000000"), "OX"),
        "radiosheffield"            to Config(Color.parseColor("#000000"), "SF"),
        "radioshropshire"           to Config(Color.parseColor("#000000"), "SR"),
        "radiosolent"               to Config(Color.parseColor("#000000"), "SO"),
        "radiosolentwestdorset"     to Config(Color.parseColor("#000000"), "SD"),
        "radiosomerset"             to Config(Color.parseColor("#000000"), "SM"),
        "radiostoke"                to Config(Color.parseColor("#000000"), "ST"),
        "radiosuffolk"              to Config(Color.parseColor("#000000"), "SU"),
        "radiosurrey"               to Config(Color.parseColor("#000000"), "SY"),
        "radiosussex"               to Config(Color.parseColor("#000000"), "SX"),
        "radiotees"                 to Config(Color.parseColor("#000000"), "TE"),
        "radiothreecounties"        to Config(Color.parseColor("#000000"), "3C"),
        "radiowestmidlands"         to Config(Color.parseColor("#000000"), "WM"),
        "radiowiltshire"            to Config(Color.parseColor("#000000"), "WL"),
        "radioyork"                 to Config(Color.parseColor("#000000"), "YO")
    )

    private fun configFor(stationId: String): Config =
        configs[stationId] ?: Config(Color.parseColor("#4A4A8A"), stationId.take(2).uppercase())

    /**
     * Returns a fresh [StationLogoDrawable] for [stationId].
     * Falls back to a generic purple-blue if the station is not in the map.
     */
    fun createDrawable(stationId: String): StationLogoDrawable {
        val config = configFor(stationId)
        return StationLogoDrawable(
            backgroundColor = config.backgroundColor,
            label = config.label,
            circleColor = config.circleColor,
            textColor = config.textColor,
            badgeLabel = config.badgeLabel
        )
    }

    /**
     * Returns the strongest non-neutral colour available in the generated station logo.
     * When a logo is intentionally monochrome, fall back to a stable derived tint.
     */
    fun getTintColor(stationId: String): Int {
        val config = configFor(stationId)
        return listOf(config.backgroundColor, config.circleColor, config.textColor)
            .firstOrNull(::isUsableTintColor)
            ?: derivedTintColor(stationId)
    }

    private fun isUsableTintColor(color: Int): Boolean {
        if (Color.alpha(color) < 128) return false
        val hsl = FloatArray(3)
        ColorUtils.colorToHSL(color, hsl)
        val luminance = ColorUtils.calculateLuminance(color)
        return luminance in 0.08..0.92 && hsl[1] >= 0.18f
    }

    private fun derivedTintColor(stationId: String): Int {
        val hue = ((stationId.hashCode().toLong() and 0xffffffffL) % 360L).toFloat()
        return ColorUtils.HSLToColor(floatArrayOf(hue, 0.45f, 0.48f))
    }

    /**
     * Renders the [StationLogoDrawable] for [stationId] into a [Bitmap] of [size]×[size] pixels.
     * Results are cached alongside the drawable so repeated calls are cheap.
     */
    private val bitmapCache = mutableMapOf<String, Bitmap>()

    @Synchronized
    fun createBitmap(stationId: String, size: Int = 256): Bitmap =
        bitmapCache.getOrPut("$stationId:$size") {
            val drawable = createDrawable(stationId)
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            drawable.setBounds(0, 0, size, size)
            drawable.draw(canvas)
            bitmap
        }
}
