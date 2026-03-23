package com.hyliankid14.bbcradioplayer

private const val STREAM_BASE = "https://lsn.lv/bbcradio.m3u8"
private const val LOGO_BASE = "https://sounds.files.bbci.co.uk/3.11.1/services"

data class Station(
    val id: String,
    val title: String,
    val serviceId: String,
    val logoUrl: String,
    val category: StationCategory = StationCategory.LOCAL
) {
    fun getUri(quality: ThemePreference.AudioQuality): String {
        return "$STREAM_BASE?station=$serviceId&bitrate=${quality.bitrate}"
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
        logoServiceId: String = serviceId,
        category: StationCategory = StationCategory.LOCAL
    ): Station = Station(
        id = id,
        title = title,
        serviceId = serviceId,
        logoUrl = "$LOGO_BASE/$logoServiceId/blocks-colour-black_600x600.png",
        category = category
    )

    private val stations = listOf(
        // BBC National and Digital Stations
        station("radio1", "BBC Radio 1", "bbc_radio_one", category = StationCategory.NATIONAL),
        station("1xtra", "BBC Radio 1Xtra", "bbc_1xtra", category = StationCategory.NATIONAL),
        station("radio1dance", "BBC Radio 1 Dance", "bbc_radio_one_dance", category = StationCategory.NATIONAL),
        station("radio1anthems", "BBC Radio 1 Anthems", "bbc_radio_one_anthems", category = StationCategory.NATIONAL),
        station("radio2", "BBC Radio 2", "bbc_radio_two", category = StationCategory.NATIONAL),
        station("radio3", "BBC Radio 3", "bbc_radio_three", category = StationCategory.NATIONAL),
        station("radio3unwind", "BBC Radio 3 Unwind", "bbc_radio_three_unwind", category = StationCategory.NATIONAL),
        station("radio4", "BBC Radio 4", "bbc_radio_fourfm", category = StationCategory.NATIONAL),
        station("radio4extra", "BBC Radio 4 Extra", "bbc_radio_four_extra", category = StationCategory.NATIONAL),
        station("radio5live", "BBC Radio 5 Live", "bbc_radio_five_live", category = StationCategory.NATIONAL),
        station("radio6", "BBC Radio 6 Music", "bbc_6music", category = StationCategory.NATIONAL),
        station("worldservice", "BBC World Service", "bbc_world_service", category = StationCategory.NATIONAL),
        station("asiannetwork", "BBC Asian Network", "bbc_asian_network", category = StationCategory.NATIONAL),

        // BBC Nations Stations
        station("radiocymru", "BBC Radio Cymru", "bbc_radio_cymru", category = StationCategory.REGIONS),
        station("radiocymru2", "BBC Radio Cymru 2", "bbc_radio_cymru_2", category = StationCategory.REGIONS),
        station("radiofoyle", "BBC Radio Foyle", "bbc_radio_foyle", category = StationCategory.REGIONS),
        station("radiogaidheal", "BBC Radio nan Gaidheal", "bbc_radio_nan_gaidheal", category = StationCategory.REGIONS),
        station("radioorkney", "BBC Radio Orkney", "bbc_radio_orkney", category = StationCategory.REGIONS),
        station("radioscotland", "BBC Radio Scotland", "bbc_radio_scotland_fm", category = StationCategory.REGIONS),
        station("radioscotlandextra", "BBC Radio Scotland Extra", "bbc_radio_scotland_mw", category = StationCategory.REGIONS),
        station("radioshetland", "BBC Radio Shetland", "bbc_radio_shetland", category = StationCategory.REGIONS),
        station("radioulster", "BBC Radio Ulster", "bbc_radio_ulster", category = StationCategory.REGIONS),
        station("radiowales", "BBC Radio Wales", "bbc_radio_wales_fm", category = StationCategory.REGIONS),
        station("radiowalesextra", "BBC Radio Wales Extra", "bbc_radio_wales_am", category = StationCategory.REGIONS),

        // BBC Local/Regional Stations (England and Channel Islands)
        station("radioberkshire", "BBC Radio Berkshire", "bbc_radio_berkshire", category = StationCategory.LOCAL),
        station("radiobristol", "BBC Radio Bristol", "bbc_radio_bristol", category = StationCategory.LOCAL),
        station("radiocambridge", "BBC Radio Cambridgeshire", "bbc_radio_cambridge", category = StationCategory.LOCAL),
        station("radiocornwall", "BBC Radio Cornwall", "bbc_radio_cornwall", category = StationCategory.LOCAL),
        station("radiocoventrywarwickshire", "BBC Radio Coventry & Warwickshire", "bbc_radio_coventry_warwickshire", category = StationCategory.LOCAL),
        station("radiocumbria", "BBC Radio Cumbria", "bbc_radio_cumbria", category = StationCategory.LOCAL),
        station("radioderby", "BBC Radio Derby", "bbc_radio_derby", category = StationCategory.LOCAL),
        station("radiodevon", "BBC Radio Devon", "bbc_radio_devon", category = StationCategory.LOCAL),
        station("radioessex", "BBC Radio Essex", "bbc_radio_essex", category = StationCategory.LOCAL),
        station("radioherefordworcester", "BBC Radio Hereford & Worcester", "bbc_radio_hereford_worcester", category = StationCategory.LOCAL),
        station("radiogloucestershire", "BBC Radio Gloucestershire", "bbc_radio_gloucestershire", category = StationCategory.LOCAL),
        station("radioguernsey", "BBC Radio Guernsey", "bbc_radio_guernsey", category = StationCategory.LOCAL),
        station("radiohumberside", "BBC Radio Humberside", "bbc_radio_humberside", category = StationCategory.LOCAL),
        station("radiojersey", "BBC Radio Jersey", "bbc_radio_jersey", category = StationCategory.LOCAL),
        station("radiokent", "BBC Radio Kent", "bbc_radio_kent", category = StationCategory.LOCAL),
        station("radiolancashire", "BBC Radio Lancashire", "bbc_radio_lancashire", category = StationCategory.LOCAL),
        station("radioleeds", "BBC Radio Leeds", "bbc_radio_leeds", category = StationCategory.LOCAL),
        station("radioleicester", "BBC Radio Leicester", "bbc_radio_leicester", category = StationCategory.LOCAL),
        station("radiolincolnshire", "BBC Radio Lincolnshire", "bbc_radio_lincolnshire", category = StationCategory.LOCAL),
        station("radiolon", "BBC Radio London", "bbc_london", category = StationCategory.LOCAL),
        station("radiomanchester", "BBC Radio Manchester", "bbc_radio_manchester", category = StationCategory.LOCAL),
        station("radiomerseyside", "BBC Radio Merseyside", "bbc_radio_merseyside", category = StationCategory.LOCAL),
        station("radionewcastle", "BBC Radio Newcastle", "bbc_radio_newcastle", category = StationCategory.LOCAL),
        station("radionorfolk", "BBC Radio Norfolk", "bbc_radio_norfolk", category = StationCategory.LOCAL),
        station("radionorthampton", "BBC Radio Northampton", "bbc_radio_northampton", category = StationCategory.LOCAL),
        station("radionottingham", "BBC Radio Nottingham", "bbc_radio_nottingham", category = StationCategory.LOCAL),
        station("radiooxford", "BBC Radio Oxford", "bbc_radio_oxford", category = StationCategory.LOCAL),
        station("radiosheffield", "BBC Radio Sheffield", "bbc_radio_sheffield", category = StationCategory.LOCAL),
        station("radioshropshire", "BBC Radio Shropshire", "bbc_radio_shropshire", category = StationCategory.LOCAL),
        station("radiosolent", "BBC Radio Solent", "bbc_radio_solent", category = StationCategory.LOCAL),
        station("radiosolentwestdorset", "BBC Radio Solent West Dorset", "bbc_radio_solent_west_dorset", category = StationCategory.LOCAL),
        station("radiosomerset", "BBC Radio Somerset", "bbc_radio_somerset_sound", category = StationCategory.LOCAL),
        station("radiostoke", "BBC Radio Stoke", "bbc_radio_stoke", category = StationCategory.LOCAL),
        station("radiosuffolk", "BBC Radio Suffolk", "bbc_radio_suffolk", category = StationCategory.LOCAL),
        station("radiosurrey", "BBC Radio Surrey", "bbc_radio_surrey", category = StationCategory.LOCAL),
        station("radiosussex", "BBC Radio Sussex", "bbc_radio_sussex", category = StationCategory.LOCAL),
        station("radiotees", "BBC Radio Tees", "bbc_tees", category = StationCategory.LOCAL),
        station("radiothreecounties", "BBC Three Counties Radio", "bbc_three_counties_radio", category = StationCategory.LOCAL),
        station("radiowestmidlands", "BBC Radio West Midlands", "bbc_wm", category = StationCategory.LOCAL),
        station("radiowiltshire", "BBC Radio Wiltshire", "bbc_radio_wiltshire", category = StationCategory.LOCAL),
        station("radioyork", "BBC Radio York", "bbc_radio_york", category = StationCategory.LOCAL)
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
