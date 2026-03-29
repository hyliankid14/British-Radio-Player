package com.hyliankid14.bbcradioplayer.wear.data

object StationRepository {
    private fun station(
        id: String,
        title: String,
        serviceId: String,
        streamServiceIds: List<String> = listOf(serviceId),
        directStreamUrls: List<String> = emptyList(),
        category: StationCategory = StationCategory.LOCAL
    ): Station = Station(
        id = id,
        title = title,
        serviceId = serviceId,
        streamServiceIds = streamServiceIds,
        directStreamUrls = directStreamUrls,
        logoUrl = "",
        category = category
    )

    private val stations = listOf(
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
            streamServiceIds = listOf("bbc_radio_five_live_sports_extra", "bbc_radio_five_sports_extra"),
            directStreamUrls = listOf("http://as-hls-uk-live.akamaized.net/pool_47700285/live/uk/bbc_radio_five_live_sports_extra/bbc_radio_five_live_sports_extra.isml/bbc_radio_five_live_sports_extra-audio%3d96000.norewind.m3u8"),
            category = StationCategory.NATIONAL
        ),
        station("radio6", "Radio 6 Music", "bbc_6music", category = StationCategory.NATIONAL),
        station("worldservice", "World Service", "bbc_world_service", category = StationCategory.NATIONAL),
        station("asiannetwork", "Asian Network", "bbc_asian_network", category = StationCategory.NATIONAL),
        station("radiocymru", "Radio Cymru", "bbc_radio_cymru", category = StationCategory.REGIONS),
        station("radiocymru2", "Radio Cymru 2", "bbc_radio_cymru_2", category = StationCategory.REGIONS),
        station("radiofoyle", "Radio Foyle", "bbc_radio_foyle", category = StationCategory.REGIONS),
        station("radioscotland", "Radio Scotland", "bbc_radio_scotland_fm", category = StationCategory.REGIONS),
        station("radioscotlandextra", "Radio Scotland Extra", "bbc_radio_scotland_mw", category = StationCategory.REGIONS),
        station("radioulster", "Radio Ulster", "bbc_radio_ulster", category = StationCategory.REGIONS),
        station("radiowales", "Radio Wales", "bbc_radio_wales_fm", category = StationCategory.REGIONS),
        station("radiowalesextra", "Radio Wales Extra", "bbc_radio_wales_am", category = StationCategory.REGIONS),
        station("radioberkshire", "Radio Berkshire", "bbc_radio_berkshire", category = StationCategory.LOCAL),
        station("radiobristol", "Radio Bristol", "bbc_radio_bristol", category = StationCategory.LOCAL),
        station("radiocambridge", "Radio Cambridgeshire", "bbc_radio_cambridge", category = StationCategory.LOCAL),
        station("radiocornwall", "Radio Cornwall", "bbc_radio_cornwall", category = StationCategory.LOCAL),
        station("radiocoventrywarwickshire", "Radio Coventry & Warwickshire", "bbc_radio_coventry_warwickshire", category = StationCategory.LOCAL),
        station("radiocumbria", "Radio Cumbria", "bbc_radio_cumbria", category = StationCategory.LOCAL),
        station("radioderby", "Radio Derby", "bbc_radio_derby", category = StationCategory.LOCAL),
        station("radiodevon", "Radio Devon", "bbc_radio_devon", category = StationCategory.LOCAL),
        station("radioessex", "Radio Essex", "bbc_radio_essex", category = StationCategory.LOCAL),
        station("radiogloucestershire", "Radio Gloucestershire", "bbc_radio_gloucestershire", category = StationCategory.LOCAL),
        station("radiohumberside", "Radio Humberside", "bbc_radio_humberside", category = StationCategory.LOCAL),
        station("radiokent", "Radio Kent", "bbc_radio_kent", category = StationCategory.LOCAL),
        station("radiolancashire", "Radio Lancashire", "bbc_radio_lancashire", category = StationCategory.LOCAL),
        station("radioleeds", "Radio Leeds", "bbc_radio_leeds", category = StationCategory.LOCAL),
        station("radiolon", "Radio London", "bbc_london", category = StationCategory.LOCAL),
        station("radiomanchester", "Radio Manchester", "bbc_radio_manchester", category = StationCategory.LOCAL),
        station("radiomerseyside", "Radio Merseyside", "bbc_radio_merseyside", category = StationCategory.LOCAL),
        station("radionewcastle", "Radio Newcastle", "bbc_radio_newcastle", category = StationCategory.LOCAL),
        station("radionorfolk", "Radio Norfolk", "bbc_radio_norfolk", category = StationCategory.LOCAL),
        station("radionottingham", "Radio Nottingham", "bbc_radio_nottingham", category = StationCategory.LOCAL),
        station("radiooxford", "Radio Oxford", "bbc_radio_oxford", category = StationCategory.LOCAL),
        station("radiosheffield", "Radio Sheffield", "bbc_radio_sheffield", category = StationCategory.LOCAL),
        station("radiosolent", "Radio Solent", "bbc_radio_solent", category = StationCategory.LOCAL),
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

    fun allStations(): List<Station> = stations

    fun findStationById(stationId: String): Station? = stations.firstOrNull { it.id == stationId }

    fun favouritesFromIds(ids: Set<String>): List<Station> = stations.filter { it.id in ids }
}
