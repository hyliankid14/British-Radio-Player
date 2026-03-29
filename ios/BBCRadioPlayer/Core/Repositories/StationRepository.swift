import Foundation

protocol StationRepository {
    func allStations() -> [Station]
    func stations(for category: StationCategory) -> [Station]
    func station(id: String) -> Station?
}

struct DefaultStationRepository: StationRepository {
    private let stations: [Station] = [
        Station(id: "radio1", title: "BBC Radio 1", serviceId: "bbc_radio_one", directStreamURL: nil, category: .national),
        Station(id: "1xtra", title: "BBC Radio 1Xtra", serviceId: "bbc_1xtra", directStreamURL: nil, category: .national),
        Station(id: "radio1dance", title: "BBC Radio 1 Dance", serviceId: "bbc_radio_one_dance", directStreamURL: nil, category: .national),
        Station(id: "radio1anthems", title: "BBC Radio 1 Anthems", serviceId: "bbc_radio_one_anthems", directStreamURL: nil, category: .national),
        Station(id: "radio2", title: "BBC Radio 2", serviceId: "bbc_radio_two", directStreamURL: nil, category: .national),
        Station(id: "radio3", title: "BBC Radio 3", serviceId: "bbc_radio_three", directStreamURL: nil, category: .national),
        Station(id: "radio3unwind", title: "BBC Radio 3 Unwind", serviceId: "bbc_radio_three_unwind", directStreamURL: nil, category: .national),
        Station(id: "radio4", title: "BBC Radio 4", serviceId: "bbc_radio_fourfm", directStreamURL: nil, category: .national),
        Station(id: "radio4extra", title: "BBC Radio 4 Extra", serviceId: "bbc_radio_four_extra", directStreamURL: nil, category: .national),
        Station(id: "radio5live", title: "BBC Radio 5 Live", serviceId: "bbc_radio_five_live", directStreamURL: URL(string: "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live&bitrate=320000&uk=1"), category: .national),
        Station(id: "radio5livesportsextra", title: "BBC Radio 5 Sports Extra", serviceId: "bbc_radio_five_live_sports_extra", directStreamURL: nil, category: .national),
        Station(id: "radio5livesportsextra2", title: "BBC Radio 5 Sports Extra 2", serviceId: "bbc_radio_five_sports_extra_2", directStreamURL: nil, category: .national),
        Station(id: "radio5livesportsextra3", title: "BBC Radio 5 Sports Extra 3", serviceId: "bbc_radio_five_sports_extra_3", directStreamURL: nil, category: .national),
        Station(id: "radio6", title: "BBC Radio 6 Music", serviceId: "bbc_6music", directStreamURL: nil, category: .national),
        Station(id: "worldservice", title: "BBC World Service", serviceId: "bbc_world_service", directStreamURL: nil, category: .national),
        Station(id: "asiannetwork", title: "BBC Asian Network", serviceId: "bbc_asian_network", directStreamURL: nil, category: .national),

        Station(id: "radiocymru", title: "BBC Radio Cymru", serviceId: "bbc_radio_cymru", directStreamURL: nil, category: .regions),
        Station(id: "radiocymru2", title: "BBC Radio Cymru 2", serviceId: "bbc_radio_cymru_2", directStreamURL: nil, category: .regions),
        Station(id: "radiofoyle", title: "BBC Radio Foyle", serviceId: "bbc_radio_foyle", directStreamURL: nil, category: .regions),
        Station(id: "radiogaidheal", title: "BBC Radio nan Gaidheal", serviceId: "bbc_radio_nan_gaidheal", directStreamURL: nil, category: .regions),
        Station(id: "radioorkney", title: "BBC Radio Orkney", serviceId: "bbc_radio_orkney", directStreamURL: nil, category: .regions),
        Station(id: "radioscotland", title: "BBC Radio Scotland", serviceId: "bbc_radio_scotland_fm", directStreamURL: nil, category: .regions),
        Station(id: "radioscotlandextra", title: "BBC Radio Scotland Extra", serviceId: "bbc_radio_scotland_mw", directStreamURL: nil, category: .regions),
        Station(id: "radioshetland", title: "BBC Radio Shetland", serviceId: "bbc_radio_shetland", directStreamURL: nil, category: .regions),
        Station(id: "radioulster", title: "BBC Radio Ulster", serviceId: "bbc_radio_ulster", directStreamURL: nil, category: .regions),
        Station(id: "radiowales", title: "BBC Radio Wales", serviceId: "bbc_radio_wales_fm", directStreamURL: nil, category: .regions),
        Station(id: "radiowalesextra", title: "BBC Radio Wales Extra", serviceId: "bbc_radio_wales_am", directStreamURL: nil, category: .regions),

        Station(id: "radioberkshire", title: "BBC Radio Berkshire", serviceId: "bbc_radio_berkshire", directStreamURL: nil, category: .local),
        Station(id: "radiobristol", title: "BBC Radio Bristol", serviceId: "bbc_radio_bristol", directStreamURL: nil, category: .local),
        Station(id: "radiocambridge", title: "BBC Radio Cambridgeshire", serviceId: "bbc_radio_cambridge", directStreamURL: nil, category: .local),
        Station(id: "radiocornwall", title: "BBC Radio Cornwall", serviceId: "bbc_radio_cornwall", directStreamURL: nil, category: .local),
        Station(id: "radiocoventrywarwickshire", title: "BBC Radio Coventry & Warwickshire", serviceId: "bbc_radio_coventry_warwickshire", directStreamURL: nil, category: .local),
        Station(id: "radiocumbria", title: "BBC Radio Cumbria", serviceId: "bbc_radio_cumbria", directStreamURL: nil, category: .local),
        Station(id: "radioderby", title: "BBC Radio Derby", serviceId: "bbc_radio_derby", directStreamURL: nil, category: .local),
        Station(id: "radiodevon", title: "BBC Radio Devon", serviceId: "bbc_radio_devon", directStreamURL: nil, category: .local),
        Station(id: "radioessex", title: "BBC Radio Essex", serviceId: "bbc_radio_essex", directStreamURL: nil, category: .local),
        Station(id: "radioherefordworcester", title: "BBC Radio Hereford & Worcester", serviceId: "bbc_radio_hereford_worcester", directStreamURL: nil, category: .local),
        Station(id: "radiogloucestershire", title: "BBC Radio Gloucestershire", serviceId: "bbc_radio_gloucestershire", directStreamURL: nil, category: .local),
        Station(id: "radioguernsey", title: "BBC Radio Guernsey", serviceId: "bbc_radio_guernsey", directStreamURL: nil, category: .local),
        Station(id: "radiohumberside", title: "BBC Radio Humberside", serviceId: "bbc_radio_humberside", directStreamURL: nil, category: .local),
        Station(id: "radiojersey", title: "BBC Radio Jersey", serviceId: "bbc_radio_jersey", directStreamURL: nil, category: .local),
        Station(id: "radiokent", title: "BBC Radio Kent", serviceId: "bbc_radio_kent", directStreamURL: nil, category: .local),
        Station(id: "radiolancashire", title: "BBC Radio Lancashire", serviceId: "bbc_radio_lancashire", directStreamURL: nil, category: .local),
        Station(id: "radioleeds", title: "BBC Radio Leeds", serviceId: "bbc_radio_leeds", directStreamURL: nil, category: .local),
        Station(id: "radioleicester", title: "BBC Radio Leicester", serviceId: "bbc_radio_leicester", directStreamURL: nil, category: .local),
        Station(id: "radiolincolnshire", title: "BBC Radio Lincolnshire", serviceId: "bbc_radio_lincolnshire", directStreamURL: nil, category: .local),
        Station(id: "radiolon", title: "BBC Radio London", serviceId: "bbc_london", directStreamURL: nil, category: .local),
        Station(id: "radiomanchester", title: "BBC Radio Manchester", serviceId: "bbc_radio_manchester", directStreamURL: nil, category: .local),
        Station(id: "radiomerseyside", title: "BBC Radio Merseyside", serviceId: "bbc_radio_merseyside", directStreamURL: nil, category: .local),
        Station(id: "radionewcastle", title: "BBC Radio Newcastle", serviceId: "bbc_radio_newcastle", directStreamURL: nil, category: .local),
        Station(id: "radionorfolk", title: "BBC Radio Norfolk", serviceId: "bbc_radio_norfolk", directStreamURL: nil, category: .local),
        Station(id: "radionorthampton", title: "BBC Radio Northampton", serviceId: "bbc_radio_northampton", directStreamURL: nil, category: .local),
        Station(id: "radionottingham", title: "BBC Radio Nottingham", serviceId: "bbc_radio_nottingham", directStreamURL: nil, category: .local),
        Station(id: "radiooxford", title: "BBC Radio Oxford", serviceId: "bbc_radio_oxford", directStreamURL: nil, category: .local),
        Station(id: "radiosheffield", title: "BBC Radio Sheffield", serviceId: "bbc_radio_sheffield", directStreamURL: nil, category: .local),
        Station(id: "radioshropshire", title: "BBC Radio Shropshire", serviceId: "bbc_radio_shropshire", directStreamURL: nil, category: .local),
        Station(id: "radiosolent", title: "BBC Radio Solent", serviceId: "bbc_radio_solent", directStreamURL: nil, category: .local),
        Station(id: "radiosolentwestdorset", title: "BBC Radio Solent West Dorset", serviceId: "bbc_radio_solent_west_dorset", directStreamURL: nil, category: .local),
        Station(id: "radiosomerset", title: "BBC Radio Somerset", serviceId: "bbc_radio_somerset_sound", directStreamURL: nil, category: .local),
        Station(id: "radiostoke", title: "BBC Radio Stoke", serviceId: "bbc_radio_stoke", directStreamURL: nil, category: .local),
        Station(id: "radiosuffolk", title: "BBC Radio Suffolk", serviceId: "bbc_radio_suffolk", directStreamURL: nil, category: .local),
        Station(id: "radiosurrey", title: "BBC Radio Surrey", serviceId: "bbc_radio_surrey", directStreamURL: nil, category: .local),
        Station(id: "radiosussex", title: "BBC Radio Sussex", serviceId: "bbc_radio_sussex", directStreamURL: nil, category: .local),
        Station(id: "radiotees", title: "BBC Radio Tees", serviceId: "bbc_tees", directStreamURL: nil, category: .local),
        Station(id: "radiothreecounties", title: "BBC Three Counties Radio", serviceId: "bbc_three_counties_radio", directStreamURL: nil, category: .local),
        Station(id: "radiowestmidlands", title: "BBC Radio West Midlands", serviceId: "bbc_wm", directStreamURL: nil, category: .local),
        Station(id: "radiowiltshire", title: "BBC Radio Wiltshire", serviceId: "bbc_radio_wiltshire", directStreamURL: nil, category: .local),
        Station(id: "radioyork", title: "BBC Radio York", serviceId: "bbc_radio_york", directStreamURL: nil, category: .local)
    ]

    func allStations() -> [Station] {
        stations
    }

    func stations(for category: StationCategory) -> [Station] {
        stations.filter { $0.category == category }
    }

    func station(id: String) -> Station? {
        stations.first { $0.id == id }
    }
}
