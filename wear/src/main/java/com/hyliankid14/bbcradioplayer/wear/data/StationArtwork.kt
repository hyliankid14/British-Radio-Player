package com.hyliankid14.bbcradioplayer.wear.data

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color

object StationArtwork {
    data class Config(
        val backgroundColor: Int,
        val label: String,
        val circleColor: Int = Color.parseColor("#1A1A1A"),
        val textColor: Int = Color.WHITE,
        val badgeLabel: String? = null
    )

    private val configs: Map<String, Config> = mapOf(
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
        "radio5livesportsextra2" to Config(
            Color.parseColor("#000000"), "5S",
            circleColor = Color.parseColor("#009EAA"), badgeLabel = "2"
        ),
        "radio5livesportsextra3" to Config(
            Color.parseColor("#000000"), "5S",
            circleColor = Color.parseColor("#009EAA"), badgeLabel = "3"
        ),
        "radio6" to Config(Color.parseColor("#007749"), "6"),
        "radio6indieforever" to Config(Color.parseColor("#0B0F0D"), "6IF", circleColor = Color.parseColor("#007749")),
        "worldservice" to Config(Color.parseColor("#BB1919"), "WS"),
        "asiannetwork" to Config(Color.parseColor("#703FA0"), "AN"),
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
        "radioberkshire" to Config(Color.parseColor("#000000"), "BE"),
        "radiobristol" to Config(Color.parseColor("#000000"), "BR"),
        "radiocambridge" to Config(Color.parseColor("#000000"), "CA"),
        "radiocornwall" to Config(Color.parseColor("#000000"), "CO"),
        "radiocoventrywarwickshire" to Config(Color.parseColor("#000000"), "CW"),
        "radiocumbria" to Config(Color.parseColor("#000000"), "CU"),
        "radioderby" to Config(Color.parseColor("#000000"), "DE"),
        "radiodevon" to Config(Color.parseColor("#000000"), "DV"),
        "radioessex" to Config(Color.parseColor("#000000"), "ES"),
        "radioherefordworcester" to Config(Color.parseColor("#000000"), "HW"),
        "radiogloucestershire" to Config(Color.parseColor("#000000"), "GL"),
        "radioguernsey" to Config(Color.parseColor("#000000"), "GU"),
        "radiohumberside" to Config(Color.parseColor("#000000"), "HU"),
        "radiojersey" to Config(Color.parseColor("#000000"), "JE"),
        "radiokent" to Config(Color.parseColor("#000000"), "KE"),
        "radiolancashire" to Config(Color.parseColor("#000000"), "LA"),
        "radioleeds" to Config(Color.parseColor("#000000"), "LE"),
        "radioleicester" to Config(Color.parseColor("#000000"), "LR"),
        "radiolincolnshire" to Config(Color.parseColor("#000000"), "LI"),
        "radiolon" to Config(Color.parseColor("#000000"), "LO"),
        "radiomanchester" to Config(Color.parseColor("#000000"), "MA"),
        "radiomerseyside" to Config(Color.parseColor("#000000"), "ME"),
        "radionewcastle" to Config(Color.parseColor("#000000"), "NE"),
        "radionorfolk" to Config(Color.parseColor("#000000"), "NF"),
        "radionorthampton" to Config(Color.parseColor("#000000"), "NO"),
        "radionottingham" to Config(Color.parseColor("#000000"), "NT"),
        "radiooxford" to Config(Color.parseColor("#000000"), "OX"),
        "radiosheffield" to Config(Color.parseColor("#000000"), "SF"),
        "radioshropshire" to Config(Color.parseColor("#000000"), "SR"),
        "radiosolent" to Config(Color.parseColor("#000000"), "SO"),
        "radiosolentwestdorset" to Config(Color.parseColor("#000000"), "SD"),
        "radiosomerset" to Config(Color.parseColor("#000000"), "SM"),
        "radiostoke" to Config(Color.parseColor("#000000"), "ST"),
        "radiosuffolk" to Config(Color.parseColor("#000000"), "SU"),
        "radiosurrey" to Config(Color.parseColor("#000000"), "SY"),
        "radiosussex" to Config(Color.parseColor("#000000"), "SX"),
        "radiotees" to Config(Color.parseColor("#000000"), "TE"),
        "radiothreecounties" to Config(Color.parseColor("#000000"), "3C"),
        "radiowestmidlands" to Config(Color.parseColor("#000000"), "WM"),
        "radiowiltshire" to Config(Color.parseColor("#000000"), "WL"),
        "radioyork" to Config(Color.parseColor("#000000"), "YO")
    )

    private val bitmapCache = mutableMapOf<String, Bitmap>()

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

    @Synchronized
    fun createBitmap(stationId: String, size: Int = 256): Bitmap =
        bitmapCache.getOrPut("$stationId:$size") {
            val drawable = createDrawable(stationId)
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
            val canvas = Canvas(bitmap)
            drawable.setBounds(0, 0, size, size)
            drawable.draw(canvas)
            bitmap
        }
}