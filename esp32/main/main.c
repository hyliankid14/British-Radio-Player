#include <string.h>
#include <ctype.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_sntp.h"
#include "nvs_flash.h"
#include <time.h>

#include "bsp.h"
#include "bsp_display.h"
#include "bsp_touch.h"
#include "bsp_imu.h"
#include "lvgl_port.h"

#include "data/stations.h"
#include "audio/playback_state.h"
#include "audio/bbc_audio.h"
#include "ui/ui_manager.h"
#include "ui/screen_home.h"
#include "ui/screen_stations.h"
#include "wifi_settings.h"

#include "config.h"   /* copy config.h.example → config.h and fill in credentials */

static const char *TAG = "main";

#define STARTUP_DISPLAY_TEST_PATTERN_MS 2000

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
        /* Re-apply after association: the driver re-enables PM during STA connect. */
        esp_wifi_set_ps(WIFI_PS_NONE);
    }
}

static bool wifi_connect(void)
{
    char ssid[33] = {0};
    char password[65] = {0};
    wifi_settings_get_boot(ssid, sizeof(ssid), password, sizeof(password));

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

    wifi_config_t wcfg = {0};
    strlcpy((char *)wcfg.sta.ssid, ssid, sizeof(wcfg.sta.ssid));
    strlcpy((char *)wcfg.sta.password, password, sizeof(wcfg.sta.password));
    wcfg.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    /* Allow open networks (e.g. Wokwi-GUEST has no password) */
    if (password[0] == '\0') {
        wcfg.sta.threshold.authmode = WIFI_AUTH_OPEN;
    }

    ESP_LOGI(TAG, "Connecting to WiFi SSID: %s", ssid);
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wcfg));
    ESP_ERROR_CHECK(esp_wifi_start());
    /* Streaming is latency-sensitive; disable modem sleep to reduce audio jitter. */
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
    ESP_LOGI(TAG, "WiFi power save disabled for smoother audio");

    EventBits_t bits = xEventGroupWaitBits(s_wifi_events,
            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT, pdFALSE, pdFALSE,
            pdMS_TO_TICKS(30000));

    bool ok = (bits & WIFI_CONNECTED_BIT) != 0;
    ESP_LOGI(TAG, "WiFi %s", ok ? "connected" : "FAILED");
    return ok;
}

static void sync_time_if_needed(void)
{
    time_t now = time(NULL);
    if (now >= 1700000000) {
        return;
    }

    ESP_LOGI(TAG, "System time not set, starting SNTP sync");
    sntp_setoperatingmode(SNTP_OPMODE_POLL);
    sntp_setservername(0, "pool.ntp.org");
    sntp_setservername(1, "time.google.com");
    sntp_init();

    for (int i = 0; i < 30; i++) {
        vTaskDelay(pdMS_TO_TICKS(200));
        now = time(NULL);
        if (now >= 1700000000) {
            break;
        }
    }

    if (time(NULL) >= 1700000000) {
        struct tm tm_utc;
        gmtime_r(&now, &tm_utc);
        char buf[32];
        strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
        ESP_LOGI(TAG, "SNTP sync complete: %s", buf);
    } else {
        ESP_LOGW(TAG, "SNTP sync timed out; ESS timing may be stale");
    }
}

static lv_obj_t *show_startup_display_test_pattern(lv_disp_t *disp)
{
    if (!disp) {
        return NULL;
    }

    lv_coord_t w = lv_disp_get_hor_res(disp);
    lv_coord_t h = lv_disp_get_ver_res(disp);

    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_remove_style_all(scr);
    lv_obj_set_size(scr, w, h);
    lv_obj_align(scr, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x111111), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *top = lv_obj_create(scr);
    lv_obj_remove_style_all(top);
    lv_obj_set_size(top, w, 2);
    lv_obj_align(top, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_set_style_bg_color(top, lv_color_hex(0xFF0000), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(top, LV_OPA_COVER, LV_PART_MAIN);

    lv_obj_t *left = lv_obj_create(scr);
    lv_obj_remove_style_all(left);
    lv_obj_set_size(left, 2, h);
    lv_obj_align(left, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_set_style_bg_color(left, lv_color_hex(0x00FF00), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(left, LV_OPA_COVER, LV_PART_MAIN);

    lv_obj_t *right = lv_obj_create(scr);
    lv_obj_remove_style_all(right);
    lv_obj_set_size(right, 2, h);
    lv_obj_align(right, LV_ALIGN_TOP_RIGHT, 0, 0);
    lv_obj_set_style_bg_color(right, lv_color_hex(0x0000FF), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(right, LV_OPA_COVER, LV_PART_MAIN);

    lv_obj_t *bottom = lv_obj_create(scr);
    lv_obj_remove_style_all(bottom);
    lv_obj_set_size(bottom, w, 2);
    lv_obj_align(bottom, LV_ALIGN_BOTTOM_LEFT, 0, 0);
    lv_obj_set_style_bg_color(bottom, lv_color_hex(0xFFFF00), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(bottom, LV_OPA_COVER, LV_PART_MAIN);

    lv_obj_t *inner_border = lv_obj_create(scr);
    lv_obj_remove_style_all(inner_border);
    lv_obj_set_size(inner_border, w - 4, h - 4);
    lv_obj_align(inner_border, LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_style_bg_opa(inner_border, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_width(inner_border, 1, LV_PART_MAIN);
    lv_obj_set_style_border_color(inner_border, lv_color_hex(0xFFFFFF), LV_PART_MAIN);

    lv_obj_t *cross_h = lv_obj_create(scr);
    lv_obj_remove_style_all(cross_h);
    lv_obj_set_size(cross_h, w, 1);
    lv_obj_align(cross_h, LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_style_bg_color(cross_h, lv_color_hex(0xAAAAAA), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(cross_h, LV_OPA_COVER, LV_PART_MAIN);

    lv_obj_t *cross_v = lv_obj_create(scr);
    lv_obj_remove_style_all(cross_v);
    lv_obj_set_size(cross_v, 1, h);
    lv_obj_align(cross_v, LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_style_bg_color(cross_v, lv_color_hex(0xAAAAAA), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(cross_v, LV_OPA_COVER, LV_PART_MAIN);

    lv_scr_load(scr);
    lv_refr_now(NULL);
    ESP_LOGI(TAG, "Startup display test pattern shown (%dx%d)", (int)w, (int)h);

    return scr;
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

    lv_obj_t *startup_pattern = NULL;
    if (bsp_lvgl_port_lock(100)) {
        startup_pattern = show_startup_display_test_pattern(disp);
        bsp_lvgl_port_unlock();
    } else {
        ESP_LOGW(TAG, "Could not acquire LVGL lock for startup test pattern");
    }
    vTaskDelay(pdMS_TO_TICKS(STARTUP_DISPLAY_TEST_PATTERN_MS));

    /* Playback state init */
    playback_state_init();

    /* Audio subsystem (ADF decode on hardware when available, tone fallback otherwise) */
    bbc_audio_init();

    /* Show entry screen with Radio and Podcasts. */
    if (bsp_lvgl_port_lock(100)) {
        ESP_LOGI(TAG, "Creating home screen");
        ui_manager_init();
        lv_obj_t *home = screen_home_create();
        ui_set_root_screen(home);
        if (startup_pattern && lv_obj_is_valid(startup_pattern)) {
            lv_obj_del(startup_pattern);
        }
        lv_refr_now(NULL);
        ESP_LOGI(TAG, "Home screen loaded");
        bsp_lvgl_port_unlock();
    } else {
        ESP_LOGW(TAG, "Could not acquire LVGL lock for home screen");
    }

    /* WiFi */
    bool wifi_ok = wifi_connect();

    if (!wifi_ok) {
        ESP_LOGW(TAG, "No WiFi – live stations unavailable");
    } else {
        sync_time_if_needed();
        screen_stations_start_title_fetch();
    }

    ESP_LOGI(TAG, "BBC Radio Player ready");
}
