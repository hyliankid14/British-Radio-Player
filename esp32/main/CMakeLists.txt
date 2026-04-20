set(main_requires
    bsp
    lvgl_port
    lvgl__lvgl
    json
    nvs_flash
    esp_wifi
    esp_event
    esp_netif
    esp_http_client
    esp_http_server
    esp-tls
    driver
)

set(BBC_MAIN_HAS_ADF 0)
if(DEFINED ENV{ADF_PATH} AND EXISTS "$ENV{ADF_PATH}/components/audio_pipeline/CMakeLists.txt")
    set(BBC_MAIN_HAS_ADF 1)
elseif(EXISTS "$ENV{HOME}/esp/esp-adf/components/audio_pipeline/CMakeLists.txt")
    set(BBC_MAIN_HAS_ADF 1)
endif()

if(BBC_MAIN_HAS_ADF)
    list(APPEND main_requires
        adf_utils
        audio_pipeline
        audio_stream
        audio_sal
        audio_hal
        esp-adf-libs
    )
        # esp_audio_codec provides the TS simple decoder for HLS/TS streams
        # (added to EXTRA_COMPONENT_DIRS by top-level CMakeLists.txt when available)
        list(APPEND main_requires esp_audio_codec)
endif()

idf_component_register(
    SRCS
        "main.c"
        "wifi_settings.c"
        "wifi_portal.c"
        "ui/ui_manager.c"
        "ui/screen_home.c"
        "ui/screen_stations.c"
        "ui/screen_settings.c"
        "ui/screen_now_playing.c"
        "audio/audio_pipeline.c"
        "audio/playback_state.c"
        "data/stations.c"
    INCLUDE_DIRS
        "."
        "ui"
        "audio"
        "data"
    REQUIRES
        ${main_requires}
)
