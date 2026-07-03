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
        "radio4", "Radio 4",
        "bbc_radio_fourfm",
        STREAM_DIRECT("55057080", "bbc_radio_fourfm"),
        LOGO("bbc_radio_fourfm"),
    },
    {
        "radio5live", "Radio 5 Live",
        "bbc_radio_five_live",
        "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live&bitrate=128000&uk=1",
        LOGO("bbc_radio_five_live"),
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
};

const station_t *stations_get_all(void)
{
    return s_stations;
}

size_t stations_count(void)
{
    return sizeof(s_stations) / sizeof(s_stations[0]);
}
