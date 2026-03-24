package com.hyliankid14.bbcradioplayer

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color

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
        "radio1dance"               to Config(Color.parseColor("#CC0066"), "1D"),
        "radio1anthems"             to Config(Color.parseColor("#0056B8"), "1A"),
        "radio2"                    to Config(Color.parseColor("#E66B21"), "2"),
        "radio3"                    to Config(Color.parseColor("#C13131"), "3"),
        "radio3unwind"              to Config(Color.parseColor("#4A2080"), "3U",
                                               circleColor = Color.parseColor("#6A40A0")),
        "radio4"                    to Config(Color.parseColor("#1B6CA8"), "4"),
        "radio4extra"               to Config(Color.parseColor("#004B8D"), "4+"),
        "radio5live"                to Config(Color.parseColor("#2E2B8F"), "5",
                                               circleColor = Color.parseColor("#4E4BAF")),
        "radio5livesportsextra"     to Config(Color.parseColor("#006EB5"), "5S"),
        "radio5livesportsextra2"    to Config(Color.parseColor("#005FA0"), "5S", badgeLabel = "2"),
        "radio5livesportsextra3"    to Config(Color.parseColor("#00508B"), "5S", badgeLabel = "3"),
        "radio6"                    to Config(Color.parseColor("#F5E10D"), "6"),
        "worldservice"              to Config(Color.parseColor("#0A1128"), "WS",
                                               circleColor = Color.parseColor("#1E3A6E")),
        "asiannetwork"              to Config(Color.parseColor("#006E4E"), "AN"),

        // ── Regions ───────────────────────────────────────────────────────────
        "radiocymru"                to Config(Color.parseColor("#D5002B"), "CY"),
        "radiocymru2"               to Config(Color.parseColor("#B50025"), "CY2"),
        "radiofoyle"                to Config(Color.parseColor("#1D6B2E"), "FO"),
        "radiogaidheal"             to Config(Color.parseColor("#006385"), "GD"),
        "radioorkney"               to Config(Color.parseColor("#003A5C"), "OR",
                                               circleColor = Color.parseColor("#005A8C")),
        "radioscotland"             to Config(Color.parseColor("#0065BD"), "SC"),
        "radioscotlandextra"        to Config(Color.parseColor("#0055A0"), "SC+"),
        "radioshetland"             to Config(Color.parseColor("#2A4080"), "SH",
                                               circleColor = Color.parseColor("#4A60A0")),
        "radioulster"               to Config(Color.parseColor("#007041"), "UL"),
        "radiowales"                to Config(Color.parseColor("#D5002B"), "WA"),
        "radiowalesextra"           to Config(Color.parseColor("#B50025"), "WA+"),

        // ── Local (England & Channel Islands) ────────────────────────────────
        "radioberkshire"            to Config(Color.parseColor("#4A5580"), "BE"),
        "radiobristol"              to Config(Color.parseColor("#5A4A80"), "BR"),
        "radiocambridge"            to Config(Color.parseColor("#4A6080"), "CA"),
        "radiocornwall"             to Config(Color.parseColor("#805A4A"), "CO"),
        "radiocoventrywarwickshire" to Config(Color.parseColor("#554A80"), "CW"),
        "radiocumbria"              to Config(Color.parseColor("#4A8060"), "CU"),
        "radioderby"                to Config(Color.parseColor("#806A4A"), "DE"),
        "radiodevon"                to Config(Color.parseColor("#804A4A"), "DV"),
        "radioessex"                to Config(Color.parseColor("#803050"), "ES"),
        "radiogloucestershire"      to Config(Color.parseColor("#4A7060"), "GL"),
        "radioguernsey"             to Config(Color.parseColor("#306080"), "GU"),
        "radioherefordworcester"    to Config(Color.parseColor("#4A8055"), "HW"),
        "radiohumberside"           to Config(Color.parseColor("#505A80"), "HU"),
        "radiojersey"               to Config(Color.parseColor("#4A5580"), "JE"),
        "radiokent"                 to Config(Color.parseColor("#80354A"), "KE"),
        "radiolancashire"           to Config(Color.parseColor("#803040"), "LA"),
        "radioleeds"                to Config(Color.parseColor("#4A4A80"), "LE"),
        "radioleicester"            to Config(Color.parseColor("#604A80"), "LR"),
        "radiolincolnshire"         to Config(Color.parseColor("#4A6280"), "LI"),
        "radiolon"                  to Config(Color.parseColor("#802030"), "LO"),
        "radiomanchester"           to Config(Color.parseColor("#80504A"), "MA"),
        "radiomerseyside"           to Config(Color.parseColor("#80604A"), "ME"),
        "radionewcastle"            to Config(Color.parseColor("#404080"), "NE"),
        "radionorfolk"              to Config(Color.parseColor("#4A8060"), "NF"),
        "radionorthampton"          to Config(Color.parseColor("#524A80"), "NO"),
        "radionottingham"           to Config(Color.parseColor("#5E4A80"), "NT"),
        "radiooxford"               to Config(Color.parseColor("#80204A"), "OX"),
        "radiosheffield"            to Config(Color.parseColor("#4A5080"), "SF"),
        "radioshropshire"           to Config(Color.parseColor("#4A8050"), "SR"),
        "radiosolent"               to Config(Color.parseColor("#406080"), "SO"),
        "radiosolentwestdorset"     to Config(Color.parseColor("#406580"), "SD"),
        "radiosomerset"             to Config(Color.parseColor("#4A8070"), "SM"),
        "radiostoke"                to Config(Color.parseColor("#805040"), "ST"),
        "radiosuffolk"              to Config(Color.parseColor("#4A8065"), "SU"),
        "radiosurrey"               to Config(Color.parseColor("#5E4A80"), "SY"),
        "radiosussex"               to Config(Color.parseColor("#4A5280"), "SX"),
        "radiotees"                 to Config(Color.parseColor("#504A80"), "TE"),
        "radiothreecounties"        to Config(Color.parseColor("#4A6080"), "3C"),
        "radiowestmidlands"         to Config(Color.parseColor("#803040"), "WM"),
        "radiowiltshire"            to Config(Color.parseColor("#4A8055"), "WL"),
        "radioyork"                 to Config(Color.parseColor("#80604A"), "YO")
    )

    /**
     * Returns a fresh [StationLogoDrawable] for [stationId].
     * Falls back to a generic purple-blue if the station is not in the map.
     */
    fun createDrawable(stationId: String): StationLogoDrawable {
        val config = configs[stationId]
            ?: Config(Color.parseColor("#4A4A8A"), stationId.take(2).uppercase())
        return StationLogoDrawable(
            backgroundColor = config.backgroundColor,
            label = config.label,
            circleColor = config.circleColor,
            textColor = config.textColor,
            badgeLabel = config.badgeLabel
        )
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
