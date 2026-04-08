#include <string.h>
#include <ctype.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "bsp.h"
#include "bsp_display.h"
#include "bsp_touch.h"
#include "bsp_imu.h"
#include "lvgl_port.h"

#include "data/stations.h"
#include "audio/playback_state.h"
#include "audio/bbc_audio.h"
#include "ui/ui_manager.h"
#include "ui/screen_stations.h"

#include "config.h"   /* copy config.h.example → config.h and fill in credentials */

static const char *TAG = "main";

/* ── WiFi ─────────────────────────────────────────────────────────────── */
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
#define WIFI_MAX_RETRY     5

static EventGroupHandle_t s_wifi_events;
static int                s_wifi_retries = 0;

static void wifi_event_handler(void *arg, esp_event_base_t base,
                                int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
        return;
    }
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_wifi_retries < WIFI_MAX_RETRY) {
            esp_wifi_connect();
            s_wifi_retries++;
            ESP_LOGI(TAG, "WiFi retry %d/%d", s_wifi_retries, WIFI_MAX_RETRY);
        } else {
            xEventGroupSetBits(s_wifi_events, WIFI_FAIL_BIT);
            ESP_LOGW(TAG, "WiFi connection failed");
        }
        return;
    }
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *ev = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&ev->ip_info.ip));
        s_wifi_retries = 0;
        xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
    }
}

static bool wifi_connect(void)
{
    s_wifi_events = xEventGroupCreate();

    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t h_any, h_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
            WIFI_EVENT, ESP_EVENT_ANY_ID,    wifi_event_handler, NULL, &h_any));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
            IP_EVENT,   IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL, &h_ip));

    wifi_config_t wcfg = {
        .sta = {
            .ssid     = WIFI_SSID,
            .password = WIFI_PASSWORD,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };
    /* Allow open networks (e.g. Wokwi-GUEST has no password) */
    if (strlen(WIFI_PASSWORD) == 0) {
        wcfg.sta.threshold.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wcfg));
    ESP_ERROR_CHECK(esp_wifi_start());

    EventBits_t bits = xEventGroupWaitBits(s_wifi_events,
            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT, pdFALSE, pdFALSE,
            pdMS_TO_TICKS(30000));

    bool ok = (bits & WIFI_CONNECTED_BIT) != 0;
    ESP_LOGI(TAG, "WiFi %s", ok ? "connected" : "FAILED");
    return ok;
}

/* ── Entry point ─────────────────────────────────────────────────────── */
void app_main(void)
{
    /* NVS (required by WiFi) */
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    /* Latch battery power on for standalone operation. */
    ESP_ERROR_CHECK(bsp_power_manager_init());

    /* I2C bus (shared by touch, IMU, codec) */
    i2c_master_bus_handle_t i2c_bus = bsp_i2c_init();

    /* IMU (non-fatal – absent in Wokwi) */
    bsp_imu_init(i2c_bus);

    /* Display */
    esp_lcd_panel_handle_t    panel  = NULL;
    esp_lcd_panel_io_handle_t io     = NULL;
    ESP_ERROR_CHECK(bsp_display_init(&panel, &io));
    ESP_ERROR_CHECK(bsp_display_brightness_init());
    ESP_ERROR_CHECK(bsp_display_brightness_set(80));
    ESP_LOGI(TAG, "Display stack ready");

    /* Touch (non-fatal – absent in Wokwi) */
    esp_lcd_touch_handle_t touch = NULL;
    bsp_touch_init(i2c_bus, &touch);

    /* Audio codec initialisation for real hardware speaker output. */
    ESP_ERROR_CHECK(bsp_codec_init(i2c_bus));

    /* LVGL port */
    lv_disp_t *disp = NULL;
    ESP_ERROR_CHECK(bsp_lvgl_port_init(panel, io, touch, &disp));

    /* Playback state init */
    playback_state_init();

    /* Audio subsystem (ADF decode on hardware when available, tone fallback otherwise) */
    bbc_audio_init();

    /* Show radio station screen directly (radio-only mode). */
    if (bsp_lvgl_port_lock(100)) {
        ESP_LOGI(TAG, "Creating stations screen");
        ui_manager_init();
        lv_obj_t *stations = screen_stations_create();
        ui_push_screen(stations, LV_SCR_LOAD_ANIM_NONE);
        lv_refr_now(NULL);
        ESP_LOGI(TAG, "Stations screen loaded");
        bsp_lvgl_port_unlock();
    } else {
        ESP_LOGW(TAG, "Could not acquire LVGL lock for stations screen");
    }

    /* WiFi */
    bool wifi_ok = wifi_connect();

    if (!wifi_ok) {
        ESP_LOGW(TAG, "No WiFi – live stations unavailable");
    }

    ESP_LOGI(TAG, "BBC Radio Player ready");
}
