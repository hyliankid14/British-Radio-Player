import Foundation

enum TVStationCatalogue {
    
    static func allStations() -> [TVStation] {
        return [
            // National Networks
            TVStation(id: "radio1", title: "Radio 1", serviceId: "bbc_radio_one", streamServiceIds: ["bbc_radio_one"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_one/blocks-colour-black_600x600.png", category: .national, tagline: "The best new music and entertainment"),
            TVStation(id: "1xtra", title: "Radio 1Xtra", serviceId: "bbc_1xtra", streamServiceIds: ["bbc_1xtra"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_1xtra/blocks-colour-black_600x600.png", category: .national, tagline: "Connecting you with Black music and culture"),
            TVStation(id: "radio1dance", title: "Radio 1 Dance", serviceId: "bbc_radio_one_dance", streamServiceIds: ["bbc_radio_one_dance"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_one_dance/blocks-colour-black_600x600.png", category: .national, tagline: "Non-stop dance anthems and DJ mixes"),
            TVStation(id: "radio1anthems", title: "Radio 1 Anthems", serviceId: "bbc_radio_one_anthems", streamServiceIds: ["bbc_radio_one_anthems"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_one_anthems/blocks-colour-black_600x600.png", category: .national, tagline: "Iconic hits and crowd favorites"),
            TVStation(id: "radio2", title: "Radio 2", serviceId: "bbc_radio_two", streamServiceIds: ["bbc_radio_two"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_two/blocks-colour-black_600x600.png", category: .national, tagline: "The UK's most listened to radio station"),
            TVStation(id: "radio3", title: "Radio 3", serviceId: "bbc_radio_three", streamServiceIds: ["bbc_radio_three"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_three/blocks-colour-black_600x600.png", category: .national, tagline: "Classical, jazz, world music, arts and drama"),
            TVStation(id: "radio3unwind", title: "Radio 3 Unwind", serviceId: "bbc_radio_three_unwind", streamServiceIds: ["bbc_radio_three_unwind"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_three_unwind/blocks-colour-black_600x600.png", category: .national, tagline: "Relaxing classical sounds and peaceful melodies"),
            TVStation(id: "radio4", title: "Radio 4", serviceId: "bbc_radio_fourfm", streamServiceIds: ["bbc_radio_fourfm"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_fourfm/blocks-colour-black_600x600.png", category: .national, tagline: "Intelligent speech, news, current affairs and drama"),
            TVStation(id: "radio4extra", title: "Radio 4 Extra", serviceId: "bbc_radio_four_extra", streamServiceIds: ["bbc_radio_four_extra"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_four_extra/blocks-colour-black_600x600.png", category: .national, tagline: "Archive comedy, drama and entertainment"),
            TVStation(
                id: "radio5live",
                title: "Radio 5 Live",
                serviceId: "bbc_radio_five_live",
                streamServiceIds: ["bbc_radio_five_live"],
                directStreamUrls: [
                    "https://as-hls-uk-live.akamaized.net/pool_89021708/live/uk/bbc_radio_five_live/bbc_radio_five_live.isml/bbc_radio_five_live-audio=320000.norewind.m3u8",
                    "https://as-hls-uk-live.akamaized.net/pool_89021708/live/uk/bbc_radio_five_live/bbc_radio_five_live.isml/bbc_radio_five_live-audio=128000.norewind.m3u8",
                    "https://as-hls-uk-live.akamaized.net/pool_89021708/live/uk/bbc_radio_five_live/bbc_radio_five_live.isml/bbc_radio_five_live-audio=96000.norewind.m3u8",
                    "https://as-hls-ww-live.akamaized.net/pool_89021708/live/ww/bbc_radio_five_live/bbc_radio_five_live.isml/bbc_radio_five_live-audio=96000.norewind.m3u8"
                ],
                logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_five_live/blocks-colour-black_600x600.png",
                category: .national,
                tagline: "Live news, live sport, and lively debate"
            ),
            TVStation(
                id: "radio5livesportsextra",
                title: "Radio 5 Sports Extra",
                serviceId: "bbc_radio_five_live_sports_extra",
                streamServiceIds: ["bbc_radio_five_live_sports_extra", "bbc_radio_five_sports_extra"],
                directStreamUrls: [
                    "https://as-hls-uk-live.akamaized.net/pool_47700285/live/uk/bbc_radio_five_live_sports_extra/bbc_radio_five_live_sports_extra.isml/bbc_radio_five_live_sports_extra-audio=96000.norewind.m3u8"
                ],
                logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_five_live_sports_extra/blocks-colour-black_600x600.png",
                category: .national,
                tagline: "Live commentary on major sporting events"
            ),
            TVStation(id: "radio5livesportsextra2", title: "Radio 5 Sports Extra 2", serviceId: "bbc_radio_five_sports_extra_2", streamServiceIds: ["bbc_radio_five_sports_extra_2"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_five_sports_extra_2/blocks-colour-black_600x600.png", category: .national, tagline: "Additional live commentary streams"),
            TVStation(id: "radio5livesportsextra3", title: "Radio 5 Sports Extra 3", serviceId: "bbc_radio_five_sports_extra_3", streamServiceIds: ["bbc_radio_five_sports_extra_3"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_five_sports_extra_3/blocks-colour-black_600x600.png", category: .national, tagline: "Special event sports coverage"),
            TVStation(id: "radio6", title: "Radio 6 Music", serviceId: "bbc_6music", streamServiceIds: ["bbc_6music"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_6music/blocks-colour-black_600x600.png", category: .national, tagline: "Alternative music from past legends and new voices"),
            TVStation(id: "radio6indieforever", title: "Radio 6 Indie Forever", serviceId: "bbc_radio_six_indie_forever", streamServiceIds: ["bbc_radio_six_indie_forever"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_six_indie_forever/blocks-colour-black_600x600.png", category: .national, tagline: "The finest indie anthems 24/7"),
            TVStation(id: "worldservice", title: "World Service", serviceId: "bbc_world_service", streamServiceIds: ["bbc_world_service"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_world_service/blocks-colour-black_600x600.png", category: .national, tagline: "Global perspectives and impartial international news"),
            TVStation(id: "livenews", title: "Live News", serviceId: "bbc_sounds_news", streamServiceIds: ["bbc_sounds_news"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_sounds_news/blocks-colour-black_600x600.png", category: .national, tagline: "Continuous breaking news and bulletins"),
            TVStation(id: "asiannetwork", title: "Asian Network", serviceId: "bbc_asian_network", streamServiceIds: ["bbc_asian_network"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_asian_network/blocks-colour-black_600x600.png", category: .national, tagline: "British Asian music, culture and conversation"),

            // Nations & Regions
            TVStation(id: "radioscotland", title: "Radio Scotland", serviceId: "bbc_radio_scotland_fm", streamServiceIds: ["bbc_radio_scotland_fm"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_scotland_fm/blocks-colour-black_600x600.png", category: .regions, tagline: "Scotland's national radio station"),
            TVStation(id: "radioscotlandextra", title: "Radio Scotland Extra", serviceId: "bbc_radio_scotland_mw", streamServiceIds: ["bbc_radio_scotland_mw"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_scotland_mw/blocks-colour-black_600x600.png", category: .regions, tagline: "Special sports and events for Scotland"),
            TVStation(id: "radiogaidheal", title: "Radio nan Gàidheal", serviceId: "bbc_radio_nan_gaidheal", streamServiceIds: ["bbc_radio_nan_gaidheal"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_nan_gaidheal/blocks-colour-black_600x600.png", category: .regions, tagline: "Scottish Gaelic news, discussion and music"),
            TVStation(id: "radiowales", title: "Radio Wales", serviceId: "bbc_radio_wales_fm", streamServiceIds: ["bbc_radio_wales_fm"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_wales_fm/blocks-colour-black_600x600.png", category: .regions, tagline: "The voice of Wales with news, sport and music"),
            TVStation(id: "radiowalesextra", title: "Radio Wales Extra", serviceId: "bbc_radio_wales_am", streamServiceIds: ["bbc_radio_wales_am"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_wales_am/blocks-colour-black_600x600.png", category: .regions, tagline: "Live sports and special broadcasts for Wales"),
            TVStation(id: "radiocymru", title: "Radio Cymru", serviceId: "bbc_radio_cymru", streamServiceIds: ["bbc_radio_cymru"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_cymru/blocks-colour-black_600x600.png", category: .regions, tagline: "Welsh language radio, news and culture"),
            TVStation(id: "radiocymru2", title: "Radio Cymru 2", serviceId: "bbc_radio_cymru_2", streamServiceIds: ["bbc_radio_cymru_2"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_cymru_2/blocks-colour-black_600x600.png", category: .regions, tagline: "Contemporary Welsh music and morning entertainment"),
            TVStation(id: "radioulster", title: "Radio Ulster", serviceId: "bbc_radio_ulster", streamServiceIds: ["bbc_radio_ulster"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_ulster/blocks-colour-black_600x600.png", category: .regions, tagline: "Northern Ireland's radio service"),
            TVStation(id: "radiofoyle", title: "Radio Foyle", serviceId: "bbc_radio_foyle", streamServiceIds: ["bbc_radio_foyle"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_foyle/blocks-colour-black_600x600.png", category: .regions, tagline: "Radio for Derry and the North West"),
            TVStation(id: "radioorkney", title: "Radio Orkney", serviceId: "bbc_radio_orkney", streamServiceIds: ["bbc_radio_orkney"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_orkney/blocks-colour-black_600x600.png", category: .regions, tagline: "Local programming for the Orkney islands"),
            TVStation(id: "radioshetland", title: "Radio Shetland", serviceId: "bbc_radio_shetland", streamServiceIds: ["bbc_radio_shetland"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_shetland/blocks-colour-black_600x600.png", category: .regions, tagline: "Local programming for the Shetland islands"),

            // Local Radio
            TVStation(id: "radiolon", title: "Radio London", serviceId: "bbc_london", streamServiceIds: ["bbc_london"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_london/blocks-colour-black_600x600.png", category: .local, tagline: "Live news, views and sounds from London"),
            TVStation(id: "radiomanchester", title: "Radio Manchester", serviceId: "bbc_radio_manchester", streamServiceIds: ["bbc_radio_manchester"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_manchester/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radioberkshire", title: "Radio Berkshire", serviceId: "bbc_radio_berkshire", streamServiceIds: ["bbc_radio_berkshire"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_berkshire/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiobristol", title: "Radio Bristol", serviceId: "bbc_radio_bristol", streamServiceIds: ["bbc_radio_bristol"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_bristol/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiocambridge", title: "Radio Cambridgeshire", serviceId: "bbc_radio_cambridge", streamServiceIds: ["bbc_radio_cambridge"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_cambridge/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiocornwall", title: "Radio Cornwall", serviceId: "bbc_radio_cornwall", streamServiceIds: ["bbc_radio_cornwall"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_cornwall/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiocoventrywarwickshire", title: "Radio Coventry & Warwickshire", serviceId: "bbc_radio_coventry_warwickshire", streamServiceIds: ["bbc_radio_coventry_warwickshire"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_coventry_warwickshire/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiocumbria", title: "Radio Cumbria", serviceId: "bbc_radio_cumbria", streamServiceIds: ["bbc_radio_cumbria"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_cumbria/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radioderby", title: "Radio Derby", serviceId: "bbc_radio_derby", streamServiceIds: ["bbc_radio_derby"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_derby/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiodevon", title: "Radio Devon", serviceId: "bbc_radio_devon", streamServiceIds: ["bbc_radio_devon"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_devon/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radioessex", title: "Radio Essex", serviceId: "bbc_radio_essex", streamServiceIds: ["bbc_radio_essex"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_essex/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiogloucestershire", title: "Radio Gloucestershire", serviceId: "bbc_radio_gloucestershire", streamServiceIds: ["bbc_radio_gloucestershire"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_gloucestershire/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radioguernsey", title: "Radio Guernsey", serviceId: "bbc_radio_guernsey", streamServiceIds: ["bbc_radio_guernsey"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_guernsey/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radioherefordworcester", title: "Hereford & Worcester", serviceId: "bbc_radio_hereford_worcester", streamServiceIds: ["bbc_radio_hereford_worcester"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_hereford_worcester/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiohumberside", title: "Radio Humberside", serviceId: "bbc_radio_humberside", streamServiceIds: ["bbc_radio_humberside"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_humberside/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiojersey", title: "Radio Jersey", serviceId: "bbc_radio_jersey", streamServiceIds: ["bbc_radio_jersey"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_jersey/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiokent", title: "Radio Kent", serviceId: "bbc_radio_kent", streamServiceIds: ["bbc_radio_kent"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_kent/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiolancashire", title: "Radio Lancashire", serviceId: "bbc_radio_lancashire", streamServiceIds: ["bbc_radio_lancashire"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_lancashire/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radioleeds", title: "Radio Leeds", serviceId: "bbc_radio_leeds", streamServiceIds: ["bbc_radio_leeds"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_leeds/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radioleicester", title: "Radio Leicester", serviceId: "bbc_radio_leicester", streamServiceIds: ["bbc_radio_leicester"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_leicester/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiolincolnshire", title: "Radio Lincolnshire", serviceId: "bbc_radio_lincolnshire", streamServiceIds: ["bbc_radio_lincolnshire"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_lincolnshire/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiomerseyside", title: "Radio Merseyside", serviceId: "bbc_radio_merseyside", streamServiceIds: ["bbc_radio_merseyside"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_merseyside/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radionewcastle", title: "Radio Newcastle", serviceId: "bbc_radio_newcastle", streamServiceIds: ["bbc_radio_newcastle"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_newcastle/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radionorfolk", title: "Radio Norfolk", serviceId: "bbc_radio_norfolk", streamServiceIds: ["bbc_radio_norfolk"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_norfolk/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radionorthampton", title: "Radio Northampton", serviceId: "bbc_radio_northampton", streamServiceIds: ["bbc_radio_northampton"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_northampton/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radionottingham", title: "Radio Nottingham", serviceId: "bbc_radio_nottingham", streamServiceIds: ["bbc_radio_nottingham"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_nottingham/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiooxford", title: "Radio Oxford", serviceId: "bbc_radio_oxford", streamServiceIds: ["bbc_radio_oxford"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_oxford/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiosheffield", title: "Radio Sheffield", serviceId: "bbc_radio_sheffield", streamServiceIds: ["bbc_radio_sheffield"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_sheffield/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radioshropshire", title: "Radio Shropshire", serviceId: "bbc_radio_shropshire", streamServiceIds: ["bbc_radio_shropshire"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_shropshire/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiosolent", title: "Radio Solent", serviceId: "bbc_radio_solent", streamServiceIds: ["bbc_radio_solent"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_solent/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiosolentwestdorset", title: "Radio Solent West Dorset", serviceId: "bbc_radio_solent_west_dorset", streamServiceIds: ["bbc_radio_solent_west_dorset"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_solent_west_dorset/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiosomerset", title: "Radio Somerset", serviceId: "bbc_radio_somerset_sound", streamServiceIds: ["bbc_radio_somerset_sound"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_somerset_sound/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiostoke", title: "Radio Stoke", serviceId: "bbc_radio_stoke", streamServiceIds: ["bbc_radio_stoke"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_stoke/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiosuffolk", title: "Radio Suffolk", serviceId: "bbc_radio_suffolk", streamServiceIds: ["bbc_radio_suffolk"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_suffolk/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiosurrey", title: "Radio Surrey", serviceId: "bbc_radio_surrey", streamServiceIds: ["bbc_radio_surrey"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_surrey/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiosussex", title: "Radio Sussex", serviceId: "bbc_radio_sussex", streamServiceIds: ["bbc_radio_sussex"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_sussex/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiotees", title: "Radio Tees", serviceId: "bbc_tees", streamServiceIds: ["bbc_tees"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_tees/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiothreecounties", title: "Three Counties Radio", serviceId: "bbc_three_counties_radio", streamServiceIds: ["bbc_three_counties_radio"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_three_counties_radio/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiowestmidlands", title: "Radio WM", serviceId: "bbc_wm", streamServiceIds: ["bbc_wm"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_wm/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radiowiltshire", title: "Radio Wiltshire", serviceId: "bbc_radio_wiltshire", streamServiceIds: ["bbc_radio_wiltshire"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_wiltshire/blocks-colour-black_600x600.png", category: .local),
            TVStation(id: "radioyork", title: "Radio York", serviceId: "bbc_radio_york", streamServiceIds: ["bbc_radio_york"], directStreamUrls: nil, logoUrl: "https://sounds.files.bbci.co.uk/3.11.1/services/bbc_radio_york/blocks-colour-black_600x600.png", category: .local),
        ]
    }
    
    static func stations(for category: TVStationCategory) -> [TVStation] {
        return allStations().filter { $0.category == category }
    }
    
    static func findById(_ id: String) -> TVStation? {
        return allStations().first { $0.id == id || $0.serviceId == id }
    }
    
    static func featuredStations() -> [TVStation] {
        let featuredIds = ["radio1", "radio2", "radio4", "radio6", "radio5live", "worldservice"]
        return featuredIds.compactMap { findById($0) }
    }
    
    static func favourites(from ids: [String]) -> [TVStation] {
        return ids.compactMap { findById($0) }
    }
}
