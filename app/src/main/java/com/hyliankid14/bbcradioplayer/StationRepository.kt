package com.hyliankid14.bbcradioplayer

private const val STREAM_BASE = "https://lsn.lv/bbcradio.m3u8"
private const val LOGO_BASE = "https://sounds.files.bbci.co.uk/3.11.1/services"
private const val BBC_HLS_UK = "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/uk/sbr_high/ak"
private const val BBC_HLS_NONUK = "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/nonuk/sbr_low/ak"

data class Station(
    val id: String,
    val title: String,
    val serviceId: String,
    val streamServiceIds: List<String> = listOf(serviceId),
    val directStreamUrls: List<String> = emptyList(),
    val logoUrl: String,
    val category: StationCategory = StationCategory.LOCAL
) {
    fun getUri(quality: ThemePreference.AudioQuality, serviceIdOverride: String? = null): String {
        val resolvedServiceId = serviceIdOverride ?: serviceId
        return "$STREAM_BASE?station=$resolvedServiceId&bitrate=${quality.bitrate}"
    }

    fun getStreamCandidates(quality: ThemePreference.AudioQuality): List<String> {
        val requestedBitrate = quality.bitrate
        val fallbackBitrates = listOf("128000", "96000", "48000", "320000")
        val bitrates = listOf(requestedBitrate) + fallbackBitrates.filter { it != requestedBitrate }

        val candidates = mutableListOf<String>()
        candidates += directStreamUrls.filter { it.isNotBlank() }
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            for (bitrate in bitrates) {
                candidates += "$STREAM_BASE?station=$sid&bitrate=$bitrate"
            }
        }
        // BBC direct HLS streams as final fallbacks (UK high-quality then non-UK lower-quality)
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            candidates += "$BBC_HLS_UK/$sid.m3u8"
            candidates += "$BBC_HLS_NONUK/$sid.m3u8"
        }
        return candidates.distinct()
    }
}

enum class StationCategory(val displayName: String) {
    NATIONAL("National"),
    REGIONS("Regions"),
    LOCAL("Local")
}

object StationRepository {
    private fun station(
        id: String,
        title: String,
        serviceId: String,
        streamServiceIds: List<String> = listOf(serviceId),
        directStreamUrls: List<String> = emptyList(),
        logoServiceId: String = serviceId,
        category: StationCategory = StationCategory.LOCAL
    ): Station = Station(
        id = id,
        title = title,
        serviceId = serviceId,
        streamServiceIds = streamServiceIds,
        directStreamUrls = directStreamUrls,
        logoUrl = "$LOGO_BASE/$logoServiceId/blocks-colour-black_600x600.png",
        category = category
    )

    private val stations = listOf(
        // National and Digital Stations
        station("radio1", "Radio 1", "bbc_radio_one", category = StationCategory.NATIONAL),
        station("1xtra", "Radio 1Xtra", "bbc_1xtra", category = StationCategory.NATIONAL),
        station("radio1dance", "Radio 1 Dance", "bbc_radio_one_dance", category = StationCategory.NATIONAL),
        station("radio1anthems", "Radio 1 Anthems", "bbc_radio_one_anthems", category = StationCategory.NATIONAL),
        station("radio2", "Radio 2", "bbc_radio_two", category = StationCategory.NATIONAL),
        station("radio3", "Radio 3", "bbc_radio_three", category = StationCategory.NATIONAL),
        station("radio3unwind", "Radio 3 Unwind", "bbc_radio_three_unwind", category = StationCategory.NATIONAL),
        station("radio4", "Radio 4", "bbc_radio_fourfm", category = StationCategory.NATIONAL),
        station("radio4extra", "Radio 4 Extra", "bbc_radio_four_extra", category = StationCategory.NATIONAL),
        station(
            "radio5live",
            "Radio 5 Live",
            "bbc_radio_five_live",
            directStreamUrls = listOf(
                "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live&bitrate=320000&uk=1",
                "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live&bitrate=128000&uk=1",
                "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live&bitrate=96000&uk=1",
                "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live&bitrate=48000&uk=1",
                "https://as-hls-ww-live.akamaized.net/pool_89021708/live/ww/bbc_radio_five_live/bbc_radio_five_live.isml/bbc_radio_five_live-audio%3d96000.norewind.m3u8"
            ),
            category = StationCategory.NATIONAL
        ),
        station(
            "radio5livesportsextra",
            "Radio 5 Sports Extra",
            "bbc_radio_five_live_sports_extra",
            streamServiceIds = listOf(
                "bbc_radio_five_live_sports_extra",
                "bbc_radio_five_sports_extra"
            ),
            directStreamUrls = listOf(
                "https://as-hls-uk-live.akamaized.net/pool_47700285/live/uk/bbc_radio_five_live_sports_extra/bbc_radio_five_live_sports_extra.isml/bbc_radio_five_live_sports_extra-audio%3d96000.norewind.m3u8"
            ),
            category = StationCategory.NATIONAL
        ),
        station(
            "radio5livesportsextra2",
            "Radio 5 Sports Extra 2",
            "bbc_radio_five_sports_extra_2",
            streamServiceIds = listOf(
                "bbc_radio_five_sports_extra_2",
                "bbc_radio_five_live_sports_extra_2"
            ),
            directStreamUrls = listOf(
                "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/audio_syndication_high_sbr_v1/ak/bbc_radio_five_sports_extra_2.m3u8"
            ),
            category = StationCategory.NATIONAL
        ),
        station(
            "radio5livesportsextra3",
            "Radio 5 Sports Extra 3",
            "bbc_radio_five_sports_extra_3",
            streamServiceIds = listOf(
                "bbc_radio_five_sports_extra_3",
                "bbc_radio_five_live_sports_extra_3"
            ),
            directStreamUrls = listOf(
                "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/audio_syndication_high_sbr_v1/ak/bbc_radio_five_sports_extra_3.m3u8"
            ),
            category = StationCategory.NATIONAL
        ),
        station("radio6", "Radio 6 Music", "bbc_6music", category = StationCategory.NATIONAL),
        station("worldservice", "World Service", "bbc_world_service", category = StationCategory.NATIONAL),
        station("asiannetwork", "Asian Network", "bbc_asian_network", category = StationCategory.NATIONAL),

        // Nations Stations
        station("radiocymru", "Radio Cymru", "bbc_radio_cymru", category = StationCategory.REGIONS),
        station("radiocymru2", "Radio Cymru 2", "bbc_radio_cymru_2", category = StationCategory.REGIONS),
        station("radiofoyle", "Radio Foyle", "bbc_radio_foyle", category = StationCategory.REGIONS),
        station("radiogaidheal", "Radio nan Gaidheal", "bbc_radio_nan_gaidheal", category = StationCategory.REGIONS),
        station("radioorkney", "Radio Orkney", "bbc_radio_orkney", category = StationCategory.REGIONS),
        station("radioscotland", "Radio Scotland", "bbc_radio_scotland_fm", category = StationCategory.REGIONS),
        station("radioscotlandextra", "Radio Scotland Extra", "bbc_radio_scotland_mw", category = StationCategory.REGIONS),
        station("radioshetland", "Radio Shetland", "bbc_radio_shetland", category = StationCategory.REGIONS),
        station("radioulster", "Radio Ulster", "bbc_radio_ulster", category = StationCategory.REGIONS),
        station("radiowales", "Radio Wales", "bbc_radio_wales_fm", category = StationCategory.REGIONS),
        station("radiowalesextra", "Radio Wales Extra", "bbc_radio_wales_am", category = StationCategory.REGIONS),

        // Local/Regional Stations (England and Channel Islands)
        station("radioberkshire", "Radio Berkshire", "bbc_radio_berkshire", category = StationCategory.LOCAL),
        station("radiobristol", "Radio Bristol", "bbc_radio_bristol", category = StationCategory.LOCAL),
        station("radiocambridge", "Radio Cambridgeshire", "bbc_radio_cambridge", category = StationCategory.LOCAL),
        station("radiocornwall", "Radio Cornwall", "bbc_radio_cornwall", category = StationCategory.LOCAL),
        station("radiocoventrywarwickshire", "Radio Coventry & Warwickshire", "bbc_radio_coventry_warwickshire", category = StationCategory.LOCAL),
        station("radiocumbria", "Radio Cumbria", "bbc_radio_cumbria", category = StationCategory.LOCAL),
        station("radioderby", "Radio Derby", "bbc_radio_derby", category = StationCategory.LOCAL),
        station("radiodevon", "Radio Devon", "bbc_radio_devon", category = StationCategory.LOCAL),
        station("radioessex", "Radio Essex", "bbc_radio_essex", category = StationCategory.LOCAL),
        station("radioherefordworcester", "Radio Hereford & Worcester", "bbc_radio_hereford_worcester", category = StationCategory.LOCAL),
        station("radiogloucestershire", "Radio Gloucestershire", "bbc_radio_gloucestershire", category = StationCategory.LOCAL),
        station("radioguernsey", "Radio Guernsey", "bbc_radio_guernsey", category = StationCategory.LOCAL),
        station("radiohumberside", "Radio Humberside", "bbc_radio_humberside", category = StationCategory.LOCAL),
        station("radiojersey", "Radio Jersey", "bbc_radio_jersey", category = StationCategory.LOCAL),
        station("radiokent", "Radio Kent", "bbc_radio_kent", category = StationCategory.LOCAL),
        station("radiolancashire", "Radio Lancashire", "bbc_radio_lancashire", category = StationCategory.LOCAL),
        station("radioleeds", "Radio Leeds", "bbc_radio_leeds", category = StationCategory.LOCAL),
        station("radioleicester", "Radio Leicester", "bbc_radio_leicester", category = StationCategory.LOCAL),
        station("radiolincolnshire", "Radio Lincolnshire", "bbc_radio_lincolnshire", category = StationCategory.LOCAL),
        station("radiolon", "Radio London", "bbc_london", category = StationCategory.LOCAL),
        station("radiomanchester", "Radio Manchester", "bbc_radio_manchester", category = StationCategory.LOCAL),
        station("radiomerseyside", "Radio Merseyside", "bbc_radio_merseyside", category = StationCategory.LOCAL),
        station("radionewcastle", "Radio Newcastle", "bbc_radio_newcastle", category = StationCategory.LOCAL),
        station("radionorfolk", "Radio Norfolk", "bbc_radio_norfolk", category = StationCategory.LOCAL),
        station("radionorthampton", "Radio Northampton", "bbc_radio_northampton", category = StationCategory.LOCAL),
        station("radionottingham", "Radio Nottingham", "bbc_radio_nottingham", category = StationCategory.LOCAL),
        station("radiooxford", "Radio Oxford", "bbc_radio_oxford", category = StationCategory.LOCAL),
        station("radiosheffield", "Radio Sheffield", "bbc_radio_sheffield", category = StationCategory.LOCAL),
        station("radioshropshire", "Radio Shropshire", "bbc_radio_shropshire", category = StationCategory.LOCAL),
        station("radiosolent", "Radio Solent", "bbc_radio_solent", category = StationCategory.LOCAL),
        station("radiosolentwestdorset", "Radio Solent West Dorset", "bbc_radio_solent_west_dorset", category = StationCategory.LOCAL),
        station("radiosomerset", "Radio Somerset", "bbc_radio_somerset_sound", category = StationCategory.LOCAL),
        station("radiostoke", "Radio Stoke", "bbc_radio_stoke", category = StationCategory.LOCAL),
        station("radiosuffolk", "Radio Suffolk", "bbc_radio_suffolk", category = StationCategory.LOCAL),
        station("radiosurrey", "Radio Surrey", "bbc_radio_surrey", category = StationCategory.LOCAL),
        station("radiosussex", "Radio Sussex", "bbc_radio_sussex", category = StationCategory.LOCAL),
        station("radiotees", "Radio Tees", "bbc_tees", category = StationCategory.LOCAL),
        station("radiothreecounties", "Three Counties Radio", "bbc_three_counties_radio", category = StationCategory.LOCAL),
        station("radiowestmidlands", "Radio West Midlands", "bbc_wm", category = StationCategory.LOCAL),
        station("radiowiltshire", "Radio Wiltshire", "bbc_radio_wiltshire", category = StationCategory.LOCAL),
        station("radioyork", "Radio York", "bbc_radio_york", category = StationCategory.LOCAL)
    )

    fun getStations(): List<Station> = stations

    fun getStationById(id: String): Station? = stations.firstOrNull { it.id == id }
    
    fun getStationsByCategory(category: StationCategory): List<Station> = 
        stations.filter { it.category == category }
    
    fun getCategorizedStations(): Map<StationCategory, List<Station>> {
        return mapOf(
            StationCategory.NATIONAL to getStationsByCategory(StationCategory.NATIONAL),
            StationCategory.REGIONS to getStationsByCategory(StationCategory.REGIONS),
            StationCategory.LOCAL to getStationsByCategory(StationCategory.LOCAL)
        )
    }
}
