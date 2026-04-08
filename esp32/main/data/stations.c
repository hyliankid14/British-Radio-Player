/*
 * Ported from app/src/main/java/com/hyliankid14/bbcradioplayer/StationRepository.kt
 * National stations plus one non-BBC internet test station.
 *
 * Stream URL pattern : http://as-hls-ww-live.akamaized.net/pool_{pool_id}/live/ww/{service_id}/{service_id}.isml/{service_id}-audio%3d128000.norewind.m3u8
 * Logo URL pattern   : https://sounds.files.bbci.co.uk/3.11.1/services/{service_id}/blocks-colour-black_600x600.png
 */

#include "stations.h"

#define STREAM_DIRECT(pool, svc) \
    "http://as-hls-ww-live.akamaized.net/pool_" pool "/live/ww/" svc "/" svc ".isml/" svc "-audio%3d128000.norewind.m3u8"

#define LOGO(svc) \
    "https://sounds.files.bbci.co.uk/3.11.1/services/" svc "/blocks-colour-black_600x600.png"

static const station_t s_stations[] = {
    {
        "radio1", "Radio 1",
        "bbc_radio_one",
        STREAM_DIRECT("01505109", "bbc_radio_one"),
        LOGO("bbc_radio_one"),
    },
    {
        "1xtra", "Radio 1Xtra",
        "bbc_1xtra",
        STREAM_DIRECT("92079267", "bbc_1xtra"),
        LOGO("bbc_1xtra"),
    },
    {
        "radio1dance", "Radio 1 Dance",
        "bbc_radio_one_dance",
        STREAM_DIRECT("62063831", "bbc_radio_one_dance"),
        LOGO("bbc_radio_one_dance"),
    },
    {
        "radio1anthems", "Radio 1 Anthems",
        "bbc_radio_one_anthems",
        STREAM_DIRECT("11351741", "bbc_radio_one_anthems"),
        LOGO("bbc_radio_one_anthems"),
    },
    {
        "radio2", "Radio 2",
        "bbc_radio_two",
        STREAM_DIRECT("74208725", "bbc_radio_two"),
        LOGO("bbc_radio_two"),
    },
    {
        "radio3", "Radio 3",
        "bbc_radio_three",
        STREAM_DIRECT("23461179", "bbc_radio_three"),
        LOGO("bbc_radio_three"),
    },
    {
        "radio3unwind", "Radio 3 Unwind",
        "bbc_radio_three_unwind",
        STREAM_DIRECT("30624046", "bbc_radio_three_unwind"),
        LOGO("bbc_radio_three_unwind"),
    },
    {
        "radio4", "Radio 4",
        "bbc_radio_fourfm",
        STREAM_DIRECT("55057080", "bbc_radio_fourfm"),
        LOGO("bbc_radio_fourfm"),
    },
    {
        "radio4extra", "Radio 4 Extra",
        "bbc_radio_four_extra",
        STREAM_DIRECT("26173715", "bbc_radio_four_extra"),
        LOGO("bbc_radio_four_extra"),
    },
    {
        "radio5live", "Radio 5 Live",
        "bbc_radio_five_live",
        STREAM_DIRECT("89021708", "bbc_radio_five_live"),
        LOGO("bbc_radio_five_live"),
    },
    {
        "radio5sportsextra", "Radio 5 Sports Extra",
        "bbc_radio_five_live_sports_extra",
        "https://as-hls-uk-live.akamaized.net/pool_47700285/live/uk/bbc_radio_five_live_sports_extra/"
        "bbc_radio_five_live_sports_extra.isml/"
        "bbc_radio_five_live_sports_extra-audio%3d96000.norewind.m3u8",
        LOGO("bbc_radio_five_live_sports_extra"),
    },
    {
        "radio6", "Radio 6 Music",
        "bbc_6music",
        STREAM_DIRECT("81827798", "bbc_6music"),
        LOGO("bbc_6music"),
    },
    {
        "worldservice", "World Service",
        "bbc_world_service",
        STREAM_DIRECT("87948813", "bbc_world_service"),
        LOGO("bbc_world_service"),
    },
    {
        "asiannetwork", "Asian Network",
        "bbc_asian_network",
        STREAM_DIRECT("22108647", "bbc_asian_network"),
        LOGO("bbc_asian_network"),
    },
    {
        "radio4lw", "Radio 4 LW",
        "bbc_radio_fourlw",
        STREAM_DIRECT("55057080", "bbc_radio_fourfm"),
        LOGO("bbc_radio_fourlw"),
    },
    {
        "cwitch", "Radio Cymru",
        "bbc_radio_cymru",
        STREAM_DIRECT("24792333", "bbc_radio_cymru"),
        LOGO("bbc_radio_cymru"),
    },
    {
        "groovesalad", "Groove Salad (Test)",
        "somafm_groovesalad",
        "http://ice1.somafm.com/groovesalad-128-mp3",
        "https://somafm.com/img/groovesalad-400.jpg",
    },
};

const station_t *stations_get_all(void)
{
    return s_stations;
}

size_t stations_count(void)
{
    return sizeof(s_stations) / sizeof(s_stations[0]);
}
