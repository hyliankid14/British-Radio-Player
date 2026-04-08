cmake_minimum_required(VERSION 3.16)

set(EXTRA_COMPONENT_DIRS
    "${CMAKE_CURRENT_SOURCE_DIR}/components/bsp"
    "${CMAKE_CURRENT_SOURCE_DIR}/components/lvgl_port"
    "${CMAKE_CURRENT_SOURCE_DIR}/components/tf_card"
)

set(BBC_HAS_ADF 0)
set(BBC_ADF_PATH "")
if(DEFINED ENV{ADF_PATH} AND EXISTS "$ENV{ADF_PATH}/components/audio_pipeline")
    set(BBC_ADF_PATH "$ENV{ADF_PATH}")
elseif(EXISTS "$ENV{HOME}/esp/esp-adf/components/audio_pipeline")
    set(BBC_ADF_PATH "$ENV{HOME}/esp/esp-adf")
endif()

if(BBC_ADF_PATH)
    message(STATUS "BBC Radio Player: ESP-ADF detected at ${BBC_ADF_PATH}")
    list(APPEND EXTRA_COMPONENT_DIRS
        "${BBC_ADF_PATH}/components/adf_utils"
        "${BBC_ADF_PATH}/components/audio_board"
        "${BBC_ADF_PATH}/components/audio_hal"
        "${BBC_ADF_PATH}/components/audio_mixer"
        "${BBC_ADF_PATH}/components/esp_peripherals"
        "${BBC_ADF_PATH}/components/display_service"
        "${BBC_ADF_PATH}/components/dueros_service"
        "${BBC_ADF_PATH}/components/esp_event_cast"
        "${BBC_ADF_PATH}/components/esp_dispatcher"
        "${BBC_ADF_PATH}/components/esp_actions"
        "${BBC_ADF_PATH}/components/bluetooth_service"
        "${BBC_ADF_PATH}/components/clouds"
        "${BBC_ADF_PATH}/components/coredump_upload_service"
        "${BBC_ADF_PATH}/components/battery_service"
        "${BBC_ADF_PATH}/components/audio_recorder"
        "${BBC_ADF_PATH}/components/ota_service"
        "${BBC_ADF_PATH}/components/tone_partition"
        "${BBC_ADF_PATH}/components/esp_codec_dev"
        "${BBC_ADF_PATH}/components/esp_coze"
        "${BBC_ADF_PATH}/components/esp-sr"
        "${BBC_ADF_PATH}/components/input_key_service"
        "${BBC_ADF_PATH}/components/playlist"
        "${BBC_ADF_PATH}/components/wifi_service"
        "${BBC_ADF_PATH}/components/audio_pipeline"
        "${BBC_ADF_PATH}/components/audio_stream"
        "${BBC_ADF_PATH}/components/audio_sal"
        "${BBC_ADF_PATH}/components/audio_hal"
        "${BBC_ADF_PATH}/components/esp-adf-libs"
    )
            set(BBC_HAS_ADF 1)
            # esp_audio_codec is a sub-component; must be added explicitly
            if(EXISTS "${BBC_ADF_PATH}/components/esp-adf-libs/esp_audio_codec/CMakeLists.txt")
                list(APPEND EXTRA_COMPONENT_DIRS
                    "${BBC_ADF_PATH}/components/esp-adf-libs/esp_audio_codec"
                )
            endif()
else()
    message(STATUS "BBC Radio Player: ESP-ADF not found, using tone fallback")
endif()

# Make ADF availability visible to component CMake files (e.g. main/CMakeLists.txt).
set(BBC_HAS_ADF ${BBC_HAS_ADF} CACHE INTERNAL "BBC ADF availability")

add_compile_definitions(BBC_HAS_ADF=${BBC_HAS_ADF})

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(bbc_radio_player)
