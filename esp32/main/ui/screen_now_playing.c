#include "screen_now_playing.h"
#include "ui_manager.h"
#include "playback_state.h"
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static const char *TAG = "now_playing";

static lv_obj_t   *s_lbl_title     = NULL;
static lv_obj_t   *s_lbl_subtitle  = NULL;
static lv_obj_t   *s_station_badge = NULL;
static lv_obj_t   *s_station_badge_lbl = NULL;
static const station_t *s_last_station = NULL;
static lv_obj_t   *s_btn_playpause = NULL;
static lv_obj_t   *s_btn_prev      = NULL;
static lv_obj_t   *s_btn_next      = NULL;
static lv_obj_t   *s_btn_next_hit  = NULL;
static lv_obj_t   *s_bar_progress  = NULL;
static lv_obj_t   *s_lbl_elapsed   = NULL;
static lv_obj_t   *s_lbl_remaining = NULL;
static lv_timer_t *s_timer         = NULL;
static TaskHandle_t s_rms_task     = NULL;
static TaskHandle_t s_station_switch_task = NULL;
static uint32_t     s_rms_gen      = 0;
static char         s_rms_service_id[48] = {0};
static char         s_rms_text[128] = {0};
static char         s_ess_text[128] = {0};
static volatile int s_pending_station_delta = 0;

#define RMS_TEXT_MAX  128
#define RMS_POLL_INTERVAL_MS 30000
#define RMS_APPLY_DELAY_MS   15000
#define RMS_INITIAL_RETRY_MS 5000
#define ESS_REFRESH_EVERY_POLLS 2
#define STATION_SWITCH_COALESCE_MS 120

typedef struct {
    uint32_t gen;
    char text[RMS_TEXT_MAX];
} metadata_async_payload_t;

static const char *station_logo_label(const station_t *st)
{
    if (!st || !st->id) return "R";
    if (strcmp(st->id, "radio1") == 0) return "1";
    if (strcmp(st->id, "radio2") == 0) return "2";
    if (strcmp(st->id, "radio3") == 0) return "3";
    if (strcmp(st->id, "radio4") == 0) return "4";
    if (strcmp(st->id, "radio5live") == 0) return "5";
    if (strcmp(st->id, "radio6") == 0) return "6";
    if (strcmp(st->id, "worldservice") == 0) return "WS";
    return "R";
}

static lv_color_t station_logo_bg(const station_t *st)
{
    if (!st || !st->id) return lv_color_make(0x4A, 0x4A, 0x8A);
    if (strcmp(st->id, "radio1") == 0) return lv_color_make(0xF5, 0x24, 0x7F);
    if (strcmp(st->id, "radio2") == 0) return lv_color_make(0xE6, 0x6B, 0x21);
    if (strcmp(st->id, "radio3") == 0) return lv_color_make(0xC1, 0x31, 0x31);
    if (strcmp(st->id, "radio4") == 0) return lv_color_make(0x1B, 0x6C, 0xA8);
    if (strcmp(st->id, "radio5live") == 0) return lv_color_make(0x00, 0x9E, 0xAA);
    if (strcmp(st->id, "radio6") == 0) return lv_color_make(0x00, 0x77, 0x49);
    if (strcmp(st->id, "worldservice") == 0) return lv_color_make(0xBB, 0x19, 0x19);
    return lv_color_make(0x4A, 0x4A, 0x8A);
}

static void station_display_title(const station_t *st, char *out, size_t out_len)
{
    if (!out || out_len == 0) {
        return;
    }
    out[0] = '\0';
    if (!st || !st->title || st->title[0] == '\0') {
        strlcpy(out, "BBC Radio", out_len);
        return;
    }
    if (strncmp(st->title, "BBC ", 4) == 0) {
        strlcpy(out, st->title, out_len);
        return;
    }
    snprintf(out, out_len, "BBC %s", st->title);
}

static void rms_clear_async(void *arg)
{
    LV_UNUSED(arg);
    s_rms_text[0] = '\0';
    s_ess_text[0] = '\0';
    screen_now_playing_refresh(NULL);
}

static void rms_apply_text_async(void *arg)
{
    metadata_async_payload_t *payload = (metadata_async_payload_t *)arg;
    if (!payload) {
        s_rms_text[0] = '\0';
        screen_now_playing_refresh(NULL);
        return;
    }

    if (payload->gen == s_rms_gen) {
        strlcpy(s_rms_text, payload->text, sizeof(s_rms_text));
    }
    free(payload);
    screen_now_playing_refresh(NULL);
}

static void rms_clear_text_async(void *arg)
{
    metadata_async_payload_t *payload = (metadata_async_payload_t *)arg;
    if (!payload) {
        s_rms_text[0] = '\0';
        screen_now_playing_refresh(NULL);
        return;
    }

    if (payload->gen == s_rms_gen) {
        s_rms_text[0] = '\0';
    }
    free(payload);
    screen_now_playing_refresh(NULL);
}

static void ess_apply_text_async(void *arg)
{
    metadata_async_payload_t *payload = (metadata_async_payload_t *)arg;
    if (!payload) {
        s_ess_text[0] = '\0';
        screen_now_playing_refresh(NULL);
        return;
    }

    if (payload->gen == s_rms_gen) {
        strlcpy(s_ess_text, payload->text, sizeof(s_ess_text));
    }
    free(payload);
    screen_now_playing_refresh(NULL);
}

static metadata_async_payload_t *metadata_payload_create(const char *text, uint32_t gen)
{
    metadata_async_payload_t *payload = malloc(sizeof(*payload));
    if (!payload) {
        return NULL;
    }
    payload->gen = gen;
    payload->text[0] = '\0';
    if (text) {
        strlcpy(payload->text, text, sizeof(payload->text));
    }
    return payload;
}

static void preview_station_ui(const station_t *station)
{
    if (!station) {
        return;
    }

    s_rms_gen++;
    s_rms_task = NULL;
    strlcpy(s_rms_service_id, station->service_id ? station->service_id : "", sizeof(s_rms_service_id));
    s_last_station = station;
    s_rms_text[0] = '\0';
    s_ess_text[0] = '\0';

    if (s_station_badge && s_station_badge_lbl) {
        lv_obj_clear_flag(s_station_badge, LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_style_bg_color(s_station_badge, station_logo_bg(station), LV_PART_MAIN);
        lv_label_set_text(s_station_badge_lbl, station_logo_label(station));
    }

    if (s_lbl_title && s_lbl_subtitle) {
        char station_title[64];
        station_display_title(station, station_title, sizeof(station_title));
        lv_label_set_text(s_lbl_title, station_title);
        lv_label_set_text(s_lbl_subtitle, "Loading...");
        lv_label_set_long_mode(s_lbl_subtitle, LV_LABEL_LONG_DOT);
    }

    if (s_bar_progress)  lv_obj_add_flag(s_bar_progress, LV_OBJ_FLAG_HIDDEN);
    if (s_lbl_elapsed)   lv_obj_add_flag(s_lbl_elapsed, LV_OBJ_FLAG_HIDDEN);
    if (s_lbl_remaining) lv_obj_add_flag(s_lbl_remaining, LV_OBJ_FLAG_HIDDEN);
}

static void rms_stop_tracking(void)
{
    s_rms_gen++;
    s_rms_task = NULL;
    s_rms_service_id[0] = '\0';
    s_rms_text[0] = '\0';
}

static bool parse_http_date_to_iso(const char *date_hdr, char *out, size_t out_len)
{
    if (!date_hdr || !out || out_len < 20) {
        return false;
    }

    int day = 0, year = 0, hh = 0, mm = 0, ss = 0;
    char mon[4] = {0};
    if (sscanf(date_hdr, "%*[^,], %d %3s %d %d:%d:%d GMT", &day, mon, &year, &hh, &mm, &ss) != 6) {
        return false;
    }

    int month = 0;
    if (strcmp(mon, "Jan") == 0) month = 1;
    else if (strcmp(mon, "Feb") == 0) month = 2;
    else if (strcmp(mon, "Mar") == 0) month = 3;
    else if (strcmp(mon, "Apr") == 0) month = 4;
    else if (strcmp(mon, "May") == 0) month = 5;
    else if (strcmp(mon, "Jun") == 0) month = 6;
    else if (strcmp(mon, "Jul") == 0) month = 7;
    else if (strcmp(mon, "Aug") == 0) month = 8;
    else if (strcmp(mon, "Sep") == 0) month = 9;
    else if (strcmp(mon, "Oct") == 0) month = 10;
    else if (strcmp(mon, "Nov") == 0) month = 11;
    else if (strcmp(mon, "Dec") == 0) month = 12;
    if (month == 0) {
        return false;
    }

    snprintf(out, out_len, "%04d-%02d-%02dT%02d:%02d:%02d", year, month, day, hh, mm, ss);
    return true;
}

static char *rms_fetch_json(const char *service_id, int *status_code)
{
    char url[160];
    /* Add a timestamp query to avoid CDN returning stale segment payloads. */
    snprintf(url, sizeof(url), "https://rms.api.bbc.co.uk/v2/services/%s/segments/latest?t=%lld",
             service_id, (long long)(esp_timer_get_time() / 1000LL));

    size_t cap = 8192;
    char *buf = heap_caps_malloc(cap, MALLOC_CAP_SPIRAM);
    if (!buf) {
        buf = malloc(cap);
    }
    if (!buf) {
        if (status_code) *status_code = -1;
        return NULL;
    }

    esp_http_client_config_t cfg = {
        .url = url,
        .timeout_ms = 5000,
        .buffer_size = 2048,
        .buffer_size_tx = 1024,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .keep_alive_enable = false,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        free(buf);
        if (status_code) *status_code = -1;
        return NULL;
    }

    esp_http_client_set_method(client, HTTP_METHOD_GET);
    esp_http_client_set_header(client, "User-Agent", "BBC-Radio-Player/esp32");
    esp_http_client_set_header(client, "Accept", "application/json");
    if (esp_http_client_open(client, 0) != ESP_OK) {
        ESP_LOGW(TAG, "RMS open failed for service=%s", service_id);
        esp_http_client_cleanup(client);
        free(buf);
        if (status_code) *status_code = -1;
        return NULL;
    }

    if (esp_http_client_fetch_headers(client) < 0) {
        ESP_LOGW(TAG, "RMS fetch headers failed for service=%s", service_id);
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        free(buf);
        return NULL;
    }
    size_t len = 0;
    int read_len = 0;
    while ((read_len = esp_http_client_read(client, buf + len, (int)(cap - len - 1))) > 0) {
        len += (size_t)read_len;
        if (len >= cap - 1) {
            break;
        }
    }
    buf[len] = '\0';

    int status = esp_http_client_get_status_code(client);
    if (status_code) *status_code = status;
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    if (status != 200 || len == 0) {
        ESP_LOGW(TAG, "RMS status=%d len=%u service=%s", status, (unsigned)len, service_id);
        free(buf);
        return NULL;
    }

    return buf;
}

static char *ess_fetch_json(const char *service_id, char *now_iso, size_t now_iso_len)
{
    char url[176];
    snprintf(url, sizeof(url), "https://ess.api.bbci.co.uk/schedules?serviceId=%s&mediatypes=audio&t=%lld",
             service_id, (long long)(esp_timer_get_time() / 1000LL));

    if (now_iso && now_iso_len > 0) {
        now_iso[0] = '\0';
    }

    /* ESS responses are larger than RMS; keep a bigger buffer to avoid truncating JSON. */
    size_t cap = 32768;
    char *buf = malloc(cap);
    if (!buf) {
        return NULL;
    }

    esp_http_client_config_t cfg = {
        .url = url,
        .timeout_ms = 5000,
        .buffer_size = 2048,
        .buffer_size_tx = 1024,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .keep_alive_enable = false,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        free(buf);
        return NULL;
    }

    esp_http_client_set_method(client, HTTP_METHOD_GET);
    esp_http_client_set_header(client, "User-Agent", "BBC-Radio-Player/esp32");
    esp_http_client_set_header(client, "Accept", "application/json");

    if (esp_http_client_open(client, 0) != ESP_OK) {
        ESP_LOGW(TAG, "ESS open failed for service=%s", service_id);
        esp_http_client_cleanup(client);
        free(buf);
        return NULL;
    }
    if (esp_http_client_fetch_headers(client) < 0) {
        ESP_LOGW(TAG, "ESS fetch headers failed for service=%s", service_id);
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        free(buf);
        return NULL;
    }

    if (now_iso && now_iso_len >= 20) {
        char *date_hdr = NULL;
        if (esp_http_client_get_header(client, "Date", &date_hdr) == ESP_OK && date_hdr) {
            parse_http_date_to_iso(date_hdr, now_iso, now_iso_len);
        }
    }

    size_t len = 0;
    int read_len = 0;
    while ((read_len = esp_http_client_read(client, buf + len, (int)(cap - len - 1))) > 0) {
        len += (size_t)read_len;
        if (len >= cap - 1) {
            break;
        }
    }
    buf[len] = '\0';

    int status = esp_http_client_get_status_code(client);
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    if (status != 200 || len == 0) {
        ESP_LOGW(TAG, "ESS status=%d len=%u service=%s", status, (unsigned)len, service_id);
        free(buf);
        return NULL;
    }
    if (len >= (cap - 1)) {
        ESP_LOGW(TAG, "ESS payload truncated at %u bytes for service=%s", (unsigned)cap, service_id);
    }
    return buf;
}

static bool rms_parse_text(const char *json, char *out, size_t out_len)
{
    cJSON *root = cJSON_Parse(json);
    if (!root) {
        return false;
    }

    bool ok = false;
    cJSON *data = cJSON_GetObjectItemCaseSensitive(root, "data");
    cJSON *chosen = NULL;
    if (cJSON_IsArray(data)) {
        cJSON *item = NULL;
        cJSON_ArrayForEach(item, data) {
            cJSON *offset = cJSON_GetObjectItemCaseSensitive(item, "offset");
            cJSON *now_playing = offset ? cJSON_GetObjectItemCaseSensitive(offset, "now_playing") : NULL;
            if (cJSON_IsBool(now_playing) && cJSON_IsTrue(now_playing)) {
                chosen = item;
                break;
            }
        }
    }

    if (chosen) {
        cJSON *titles = cJSON_GetObjectItemCaseSensitive(chosen, "titles");
        cJSON *primary = titles ? cJSON_GetObjectItemCaseSensitive(titles, "primary") : NULL;
        cJSON *secondary = titles ? cJSON_GetObjectItemCaseSensitive(titles, "secondary") : NULL;
        cJSON *tertiary = titles ? cJSON_GetObjectItemCaseSensitive(titles, "tertiary") : NULL;
        const char *p = (cJSON_IsString(primary) && primary->valuestring[0] != '\0') ? primary->valuestring : NULL;
        const char *s = (cJSON_IsString(secondary) && secondary->valuestring[0] != '\0') ? secondary->valuestring : NULL;
        const char *t = (cJSON_IsString(tertiary) && tertiary->valuestring[0] != '\0') ? tertiary->valuestring : NULL;

        if (t) {
            /* RMS song segments frequently map artist/title across secondary/tertiary. */
            snprintf(out, out_len, "%s - %s", s ? s : (p ? p : ""), t);
            ok = true;
        } else if (p && s) {
            snprintf(out, out_len, "%s - %s", p, s);
            ok = true;
        } else if (s) {
            strlcpy(out, s, out_len);
            ok = true;
        } else if (p) {
            strlcpy(out, p, out_len);
            ok = true;
        }
    }

    cJSON_Delete(root);
    return ok;
}

static bool ess_parse_show_title(const char *json, const char *now_iso_override, char *out, size_t out_len)
{
    cJSON *root = cJSON_Parse(json);
    if (!root) {
        return false;
    }

    bool ok = false;
    cJSON *items = cJSON_GetObjectItemCaseSensitive(root, "items");
    if (cJSON_IsArray(items)) {
        char now_iso[20] = {0};

        if (now_iso_override && strlen(now_iso_override) >= 19) {
            memcpy(now_iso, now_iso_override, 19);
        } else {
            time_t now_epoch = time(NULL);
            struct tm now_tm;
            gmtime_r(&now_epoch, &now_tm);
            strftime(now_iso, sizeof(now_iso), "%Y-%m-%dT%H:%M:%S", &now_tm);
        }

        cJSON *chosen_current = NULL;
        cJSON *latest_started = NULL;
        char latest_start_iso[20] = {0};
        cJSON *next_upcoming = NULL;
        cJSON *first_item = NULL;
        cJSON *item = NULL;
        cJSON_ArrayForEach(item, items) {
            if (!first_item) {
                first_item = item;
            }
            cJSON *published = cJSON_GetObjectItemCaseSensitive(item, "published_time");
            cJSON *start = published ? cJSON_GetObjectItemCaseSensitive(published, "start") : NULL;
            cJSON *end = published ? cJSON_GetObjectItemCaseSensitive(published, "end") : NULL;
            const char *start_s = cJSON_IsString(start) ? start->valuestring : NULL;
            const char *end_s = cJSON_IsString(end) ? end->valuestring : NULL;

            if (start_s && end_s && strlen(start_s) >= 19 && strlen(end_s) >= 19) {
                char start_iso[20] = {0};
                char end_iso[20] = {0};
                memcpy(start_iso, start_s, 19);
                memcpy(end_iso, end_s, 19);
                if (strcmp(start_iso, now_iso) <= 0 && strcmp(now_iso, end_iso) < 0) {
                    chosen_current = item;
                    break;
                }
                if (strcmp(start_iso, now_iso) <= 0 &&
                    (!latest_started || strcmp(start_iso, latest_start_iso) > 0)) {
                    latest_started = item;
                    memcpy(latest_start_iso, start_iso, sizeof(latest_start_iso));
                }
                if (!next_upcoming && strcmp(start_iso, now_iso) > 0) {
                    next_upcoming = item;
                }
            }
        }

        cJSON *chosen = chosen_current ? chosen_current
                           : (next_upcoming ? next_upcoming
                                : (latest_started ? latest_started : first_item));

        if (chosen) {
            cJSON *brand = cJSON_GetObjectItemCaseSensitive(chosen, "brand");
            cJSON *episode = cJSON_GetObjectItemCaseSensitive(chosen, "episode");
            cJSON *brand_title = brand ? cJSON_GetObjectItemCaseSensitive(brand, "title") : NULL;
            cJSON *episode_title = episode ? cJSON_GetObjectItemCaseSensitive(episode, "title") : NULL;

            const char *title = NULL;
            if (cJSON_IsString(brand_title) && brand_title->valuestring[0] != '\0') {
                title = brand_title->valuestring;
            } else if (cJSON_IsString(episode_title) && episode_title->valuestring[0] != '\0') {
                title = episode_title->valuestring;
            }

            if (title) {
                strlcpy(out, title, out_len);
                ok = true;
            }
        }
    }

    cJSON_Delete(root);
    return ok;
}

static void rms_task(void *arg)
{
    uint32_t my_gen = (uint32_t)(uintptr_t)arg;
    char last_text[RMS_TEXT_MAX] = {0};
    char last_ess[RMS_TEXT_MAX] = {0};
    char pending_text[RMS_TEXT_MAX] = {0};
    uint32_t failure_count = 0;
    uint32_t ess_polls_until_refresh = 0;
    bool pending_is_clear = false;
    int64_t pending_apply_us = 0;
    int poll_interval_ms = RMS_INITIAL_RETRY_MS;

    while (my_gen == s_rms_gen) {
        playback_state_t st = playback_get_state();
        if (st.type != PLAYBACK_STATION || !st.station || !st.is_live) {
            break;
        }

        int rms_status = -1;
        char *json = rms_fetch_json(st.station->service_id, &rms_status);
        if (my_gen != s_rms_gen) {
            free(json);
            break;
        }

        if (json) {
            char text[RMS_TEXT_MAX] = {0};
            if (rms_parse_text(json, text, sizeof(text))) {
                if (strcmp(text, last_text) != 0 || pending_is_clear) {
                    strlcpy(pending_text, text, sizeof(pending_text));
                    pending_is_clear = false;
                    pending_apply_us = esp_timer_get_time() + ((int64_t)RMS_APPLY_DELAY_MS * 1000LL);
                }
            } else {
                ESP_LOGW(TAG, "RMS parse produced empty text for service=%s", st.station->service_id);
                if (last_text[0] != '\0' || !pending_is_clear) {
                    pending_text[0] = '\0';
                    pending_is_clear = true;
                    pending_apply_us = esp_timer_get_time() + ((int64_t)RMS_APPLY_DELAY_MS * 1000LL);
                }
            }
            failure_count = 0;
            free(json);
        } else if (rms_status == 404) {
            if (last_text[0] != '\0' || !pending_is_clear) {
                pending_text[0] = '\0';
                pending_is_clear = true;
                pending_apply_us = esp_timer_get_time() + ((int64_t)RMS_APPLY_DELAY_MS * 1000LL);
            }
        } else {
            failure_count++;
            if ((failure_count % 5U) == 0U) {
                ESP_LOGW(TAG, "RMS fetch failing repeatedly (count=%u, service=%s)",
                         (unsigned)failure_count, st.station->service_id);
            }
        }

        if (ess_polls_until_refresh == 0 || last_ess[0] == '\0') {
            char now_iso[20] = {0};
            char *ess_json = ess_fetch_json(st.station->service_id, now_iso, sizeof(now_iso));
            if (my_gen != s_rms_gen) {
                free(ess_json);
                break;
            }
            if (ess_json) {
                char show_title[RMS_TEXT_MAX] = {0};
                if (ess_parse_show_title(ess_json, now_iso[0] ? now_iso : NULL,
                                         show_title, sizeof(show_title)) &&
                    strcmp(show_title, last_ess) != 0) {
                        metadata_async_payload_t *payload = metadata_payload_create(show_title, my_gen);
                        if (payload) {
                        strlcpy(last_ess, show_title, sizeof(last_ess));
                            lv_async_call(ess_apply_text_async, payload);
                    }
                } else if (show_title[0] == '\0') {
                    ESP_LOGW(TAG, "ESS parse produced empty text for service=%s", st.station->service_id);
                }
                free(ess_json);
            }
            ess_polls_until_refresh = ESS_REFRESH_EVERY_POLLS;
        } else {
            ess_polls_until_refresh--;
        }

        if (last_text[0] != '\0' || last_ess[0] != '\0' || pending_text[0] != '\0') {
            poll_interval_ms = RMS_POLL_INTERVAL_MS;
        } else {
            poll_interval_ms = RMS_INITIAL_RETRY_MS;
        }

        if (pending_apply_us != 0 && esp_timer_get_time() >= pending_apply_us) {
            if (pending_is_clear) {
                last_text[0] = '\0';
                pending_is_clear = false;
                pending_apply_us = 0;
                metadata_async_payload_t *payload = metadata_payload_create(NULL, my_gen);
                lv_async_call(rms_clear_text_async, payload);
            } else if (pending_text[0] != '\0') {
                metadata_async_payload_t *payload = metadata_payload_create(pending_text, my_gen);
                if (payload) {
                    strlcpy(last_text, pending_text, sizeof(last_text));
                    pending_text[0] = '\0';
                    pending_apply_us = 0;
                    lv_async_call(rms_apply_text_async, payload);
                }
            }
        }

        /* Retry quickly until metadata appears, then settle to Android's steady-state cadence. */
        for (int i = 0; i < (poll_interval_ms / 100) && my_gen == s_rms_gen; i++) {
            if (pending_apply_us != 0 && esp_timer_get_time() >= pending_apply_us) {
                if (pending_is_clear) {
                    last_text[0] = '\0';
                    pending_is_clear = false;
                    pending_apply_us = 0;
                    metadata_async_payload_t *payload = metadata_payload_create(NULL, my_gen);
                    lv_async_call(rms_clear_text_async, payload);
                } else if (pending_text[0] != '\0') {
                    metadata_async_payload_t *payload = metadata_payload_create(pending_text, my_gen);
                    if (payload) {
                        strlcpy(last_text, pending_text, sizeof(last_text));
                        pending_text[0] = '\0';
                        pending_apply_us = 0;
                        lv_async_call(rms_apply_text_async, payload);
                    }
                }
            }
            vTaskDelay(pdMS_TO_TICKS(100));
        }
    }

    if (my_gen == s_rms_gen) {
        s_rms_task = NULL;
    }
    vTaskDelete(NULL);
}

static void rms_ensure_tracking(const station_t *station)
{
    if (!station || !station->service_id || station->service_id[0] == '\0') {
        rms_stop_tracking();
        return;
    }

    if (strcmp(s_rms_service_id, station->service_id) == 0 && s_rms_task != NULL) {
        return;
    }

    s_rms_gen++;
    s_rms_task = NULL;
    strlcpy(s_rms_service_id, station->service_id, sizeof(s_rms_service_id));
    lv_async_call(rms_clear_async, NULL);

    if (xTaskCreate(rms_task, "rms_meta", 6144, (void *)(uintptr_t)s_rms_gen,
                    3, &s_rms_task) != pdPASS) {
        s_rms_task = NULL;
        ESP_LOGW(TAG, "Failed to start RMS metadata task");
    }
}

static void stop_playback_task(void *arg)
{
    LV_UNUSED(arg);
    playback_stop();
    lv_async_call(screen_now_playing_refresh, NULL);
    vTaskDelete(NULL);
}

static void station_switch_task(void *arg)
{
    LV_UNUSED(arg);

    while (true) {
        vTaskDelay(pdMS_TO_TICKS(STATION_SWITCH_COALESCE_MS));

        int delta = s_pending_station_delta;
        s_pending_station_delta = 0;
        if (delta == 0) {
            break;
        }

        playback_state_t st = playback_get_state();
        if (st.type != PLAYBACK_STATION || !st.station) {
            break;
        }

        int idx = 0;
        const station_t *all = stations_get_all();
        size_t count = stations_count();
        for (size_t i = 0; i < count; i++) {
            if (&all[i] == st.station) {
                idx = (int)i;
                break;
            }
        }

        int next_idx = (idx + delta) % (int)count;
        if (next_idx < 0) {
            next_idx += (int)count;
        }

        preview_station_ui(&all[next_idx]);

        esp_err_t err = playback_play_station(&all[next_idx]);
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "station switch failed: 0x%x", (unsigned)err);
        }
        lv_async_call(screen_now_playing_refresh, NULL);
    }

    s_station_switch_task = NULL;
    vTaskDelete(NULL);
}

static void queue_station_switch(int delta)
{
    s_pending_station_delta += delta;

    playback_state_t st = playback_get_state();
    if (st.type == PLAYBACK_STATION && st.station) {
        const station_t *all = stations_get_all();
        size_t count = stations_count();
        int idx = 0;
        for (size_t i = 0; i < count; i++) {
            if (&all[i] == st.station) {
                idx = (int)i;
                break;
            }
        }
        int preview_idx = (idx + s_pending_station_delta) % (int)count;
        if (preview_idx < 0) {
            preview_idx += (int)count;
        }
        preview_station_ui(&all[preview_idx]);
    }

    if (s_station_switch_task == NULL) {
        if (xTaskCreate(station_switch_task, "station_sw", 4096, NULL, 4, &s_station_switch_task) != pdPASS) {
            s_station_switch_task = NULL;
            ESP_LOGW(TAG, "Failed to start station switch task");
        }
    }
}

static void on_playpause_clicked(lv_event_t *e)
{
    LV_UNUSED(e);
    playback_state_t st = playback_get_state();
    if (st.type == PLAYBACK_STATION && st.is_playing) {
        xTaskCreate(stop_playback_task, "stop_live", 4096, NULL, 5, NULL);
    } else {
        playback_toggle();
        lv_async_call(screen_now_playing_refresh, NULL);
    }
}

static void on_prev_clicked(lv_event_t *e)
{
    LV_UNUSED(e);
    playback_state_t st = playback_get_state();
    if (st.type == PLAYBACK_STATION) {
        queue_station_switch(-1);
    } else if (st.type == PLAYBACK_EPISODE) {
        playback_seek_relative(-10);
        lv_async_call(screen_now_playing_refresh, NULL);
    }
}

static void on_next_clicked(lv_event_t *e)
{
    LV_UNUSED(e);
    playback_state_t st = playback_get_state();
    if (st.type == PLAYBACK_STATION) {
        queue_station_switch(1);
    } else if (st.type == PLAYBACK_EPISODE) {
        playback_seek_relative(30);
        lv_async_call(screen_now_playing_refresh, NULL);
    }
}

static void on_screen_delete(lv_event_t *e)
{
    LV_UNUSED(e);
    rms_stop_tracking();
    s_lbl_title     = NULL;
    s_lbl_subtitle  = NULL;
    s_station_badge = NULL;
    s_station_badge_lbl = NULL;
    s_btn_playpause = NULL;
    s_btn_prev      = NULL;
    s_btn_next      = NULL;
    s_btn_next_hit  = NULL;
    s_bar_progress  = NULL;
    s_lbl_elapsed   = NULL;
    s_lbl_remaining = NULL;
    if (s_timer) { lv_timer_del(s_timer); s_timer = NULL; }
}

static void on_progress_timer(lv_timer_t *t)
{
    (void)t;
    playback_state_t st = playback_get_state();
    if (st.type == PLAYBACK_STATION && st.station && st.is_live) {
        if (s_rms_task == NULL) {
            rms_ensure_tracking(st.station);
        }
    } else if (st.type == PLAYBACK_EPISODE) {
        lv_async_call(screen_now_playing_refresh, NULL);
    }
}

static void time_fmt(char *buf, size_t len, int32_t secs)
{
    if (secs < 0) secs = 0;
    int m = (int)(secs / 60);
    int s = (int)(secs % 60);
    if (m >= 60) {
        snprintf(buf, len, "%d:%02d:%02d", m / 60, m % 60, s);
    } else {
        snprintf(buf, len, "%d:%02d", m, s);
    }
}

void screen_now_playing_refresh(void *arg)
{
    if (!s_lbl_title) return;

    playback_state_t st = playback_get_state();

    if (st.type == PLAYBACK_STATION && st.station) {
        char station_title[64];
        station_display_title(st.station, station_title, sizeof(station_title));
        s_last_station = st.station;
        rms_ensure_tracking(st.station);
        if (s_station_badge && s_station_badge_lbl) {
            lv_obj_clear_flag(s_station_badge, LV_OBJ_FLAG_HIDDEN);
            lv_obj_set_style_bg_color(s_station_badge, station_logo_bg(st.station), LV_PART_MAIN);
            lv_label_set_text(s_station_badge_lbl, station_logo_label(st.station));
        }
        lv_label_set_text(s_lbl_title,    station_title);
        lv_label_set_text(s_lbl_subtitle, s_rms_text[0] ? s_rms_text : (s_ess_text[0] ? s_ess_text : "BBC Radio Live"));
        lv_label_set_long_mode(s_lbl_subtitle, LV_LABEL_LONG_SCROLL_CIRCULAR);
        lv_obj_set_style_anim_speed(s_lbl_subtitle, 20, LV_PART_MAIN);
        lv_obj_add_flag(s_bar_progress,  LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(s_lbl_elapsed,   LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(s_lbl_remaining, LV_OBJ_FLAG_HIDDEN);
    } else if (st.type == PLAYBACK_EPISODE) {
        rms_stop_tracking();
        if (s_station_badge) {
            lv_obj_add_flag(s_station_badge, LV_OBJ_FLAG_HIDDEN);
        }
        lv_label_set_text(s_lbl_title,    st.episode_title);
        lv_label_set_text(s_lbl_subtitle, st.podcast_title);
        lv_label_set_long_mode(s_lbl_subtitle, LV_LABEL_LONG_DOT);
        lv_obj_clear_flag(s_bar_progress,  LV_OBJ_FLAG_HIDDEN);
        lv_obj_clear_flag(s_lbl_elapsed,   LV_OBJ_FLAG_HIDDEN);
        lv_obj_clear_flag(s_lbl_remaining, LV_OBJ_FLAG_HIDDEN);
        int32_t pos = playback_get_position_secs();
        int32_t dur = st.episode_duration_secs;
        lv_bar_set_range(s_bar_progress, 0, (dur > 0) ? dur : 100);
        lv_bar_set_value(s_bar_progress, pos, LV_ANIM_OFF);
        char buf[16];
        time_fmt(buf, sizeof(buf), pos);
        lv_label_set_text(s_lbl_elapsed, buf);
        if (dur > 0) {
            int32_t rem = dur - pos;
            if (rem < 0) rem = 0;
            char rbuf[18];
            time_fmt(rbuf, sizeof(rbuf), rem);
            char disp[20];
            snprintf(disp, sizeof(disp), "-%s", rbuf);
            lv_label_set_text(s_lbl_remaining, disp);
        } else {
            lv_label_set_text(s_lbl_remaining, "");
        }
    } else {
        rms_stop_tracking();
        if (s_last_station) {
            char station_title[64];
            station_display_title(s_last_station, station_title, sizeof(station_title));
            if (s_station_badge && s_station_badge_lbl) {
                lv_obj_clear_flag(s_station_badge, LV_OBJ_FLAG_HIDDEN);
                lv_obj_set_style_bg_color(s_station_badge, station_logo_bg(s_last_station), LV_PART_MAIN);
                lv_label_set_text(s_station_badge_lbl, station_logo_label(s_last_station));
            }
            lv_label_set_text(s_lbl_title, station_title);
            lv_label_set_text(s_lbl_subtitle, "Nothing Playing");
            lv_label_set_long_mode(s_lbl_subtitle, LV_LABEL_LONG_DOT);
        } else {
            if (s_station_badge) {
                lv_obj_add_flag(s_station_badge, LV_OBJ_FLAG_HIDDEN);
            }
            lv_label_set_text(s_lbl_title,    "Nothing Playing");
            lv_label_set_text(s_lbl_subtitle, "");
            lv_label_set_long_mode(s_lbl_subtitle, LV_LABEL_LONG_DOT);
        }
        lv_obj_add_flag(s_bar_progress,  LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(s_lbl_elapsed,   LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(s_lbl_remaining, LV_OBJ_FLAG_HIDDEN);
    }

    lv_obj_t *btn_lbl = lv_obj_get_child(s_btn_playpause, 0);
    if (st.type == PLAYBACK_STATION && st.is_playing) {
        lv_label_set_text(btn_lbl, LV_SYMBOL_STOP);
    } else {
        lv_label_set_text(btn_lbl, st.is_playing ? LV_SYMBOL_PAUSE : LV_SYMBOL_PLAY);
    }
}

lv_obj_t *screen_now_playing_create(void)
{
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_outline_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(scr, 0, LV_PART_MAIN);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_add_event_cb(scr, on_screen_delete, LV_EVENT_DELETE, NULL);

    ui_create_header(scr, "Now Playing", true);

    /* Station logo badge (shown for live radio). */
    s_station_badge = lv_obj_create(scr);
    lv_obj_set_size(s_station_badge, 30, 30);
    lv_obj_align(s_station_badge, LV_ALIGN_TOP_LEFT, 8, UI_HEADER_HEIGHT + 13);
    lv_obj_set_style_bg_color(s_station_badge, lv_color_make(0x4A, 0x4A, 0x8A), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_station_badge, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(s_station_badge, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(s_station_badge, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_set_style_pad_all(s_station_badge, 0, LV_PART_MAIN);
    lv_obj_clear_flag(s_station_badge, LV_OBJ_FLAG_SCROLLABLE);

    s_station_badge_lbl = lv_label_create(s_station_badge);
    lv_label_set_text(s_station_badge_lbl, "R");
    lv_obj_set_style_text_color(s_station_badge_lbl, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_set_style_text_font(s_station_badge_lbl, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_center(s_station_badge_lbl);

    /* Station / episode title */
    s_lbl_title = lv_label_create(scr);
    lv_label_set_long_mode(s_lbl_title, LV_LABEL_LONG_DOT);
    lv_obj_set_width(s_lbl_title, 172);
    lv_obj_set_style_text_font(s_lbl_title, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_lbl_title, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_align(s_lbl_title, LV_ALIGN_TOP_LEFT, 56, UI_HEADER_HEIGHT + 25);

    /* Now playing subtitle under station title row. */
    s_lbl_subtitle = lv_label_create(scr);
    lv_label_set_long_mode(s_lbl_subtitle, LV_LABEL_LONG_DOT);
    lv_obj_set_width(s_lbl_subtitle, 224);
    lv_obj_set_style_text_font(s_lbl_subtitle, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_lbl_subtitle, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_align(s_lbl_subtitle, LV_ALIGN_TOP_LEFT, 8, UI_HEADER_HEIGHT + 66);

    /* Progress bar (episode mode only, hidden for live radio) */
    s_bar_progress = lv_bar_create(scr);
    lv_obj_set_size(s_bar_progress, 190, 6);
    lv_obj_align(s_bar_progress, LV_ALIGN_TOP_MID, 0, UI_HEADER_HEIGHT + 94);
    lv_obj_set_style_bg_color(s_bar_progress, lv_color_make(0x44, 0x44, 0x44), LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_bar_progress, UI_COLOR_BBC_RED, LV_PART_INDICATOR);
    lv_obj_set_style_border_width(s_bar_progress, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(s_bar_progress, 3, LV_PART_MAIN);
    lv_obj_set_style_radius(s_bar_progress, 3, LV_PART_INDICATOR);
    lv_bar_set_range(s_bar_progress, 0, 100);
    lv_bar_set_value(s_bar_progress, 0, LV_ANIM_OFF);
    lv_obj_add_flag(s_bar_progress, LV_OBJ_FLAG_HIDDEN);

    /* Elapsed time label (left of bar) */
    s_lbl_elapsed = lv_label_create(scr);
    lv_label_set_text(s_lbl_elapsed, "0:00");
    lv_obj_set_style_text_color(s_lbl_elapsed, UI_COLOR_SUBTEXT, LV_PART_MAIN);
    lv_obj_set_style_text_font(s_lbl_elapsed, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(s_lbl_elapsed, LV_ALIGN_TOP_MID, -70, UI_HEADER_HEIGHT + 106);
    lv_obj_add_flag(s_lbl_elapsed, LV_OBJ_FLAG_HIDDEN);

    /* Remaining time label (right of bar) */
    s_lbl_remaining = lv_label_create(scr);
    lv_label_set_text(s_lbl_remaining, "");
    lv_obj_set_style_text_color(s_lbl_remaining, UI_COLOR_SUBTEXT, LV_PART_MAIN);
    lv_obj_set_style_text_font(s_lbl_remaining, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(s_lbl_remaining, LV_ALIGN_TOP_MID, 70, UI_HEADER_HEIGHT + 106);
    lv_obj_add_flag(s_lbl_remaining, LV_OBJ_FLAG_HIDDEN);

    /* Previous button */
    s_btn_prev = lv_btn_create(scr);
    lv_obj_set_size(s_btn_prev, 40, 40);
    lv_obj_set_style_bg_color(s_btn_prev, UI_COLOR_CARD_BG, LV_PART_MAIN);
    lv_obj_set_style_radius(s_btn_prev, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_align(s_btn_prev, LV_ALIGN_BOTTOM_MID, -62, -16);
    lv_obj_clear_flag(s_btn_prev, LV_OBJ_FLAG_SCROLLABLE);
    ui_mark_selectable(s_btn_prev);
    lv_obj_add_event_cb(s_btn_prev, on_prev_clicked, LV_EVENT_PRESSED, NULL);
    lv_obj_t *prev_lbl = lv_label_create(s_btn_prev);
    lv_label_set_text(prev_lbl, LV_SYMBOL_PREV);
    lv_obj_set_style_text_color(prev_lbl, lv_color_white(), LV_PART_MAIN);
    lv_obj_center(prev_lbl);

    /* Play / Pause button */
    s_btn_playpause = lv_btn_create(scr);
    lv_obj_set_size(s_btn_playpause, 52, 52);
    lv_obj_set_style_bg_color(s_btn_playpause, UI_COLOR_BBC_RED, LV_PART_MAIN);
    lv_obj_set_style_radius(s_btn_playpause, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_align(s_btn_playpause, LV_ALIGN_BOTTOM_MID, 0, -12);
    lv_obj_clear_flag(s_btn_playpause, LV_OBJ_FLAG_SCROLLABLE);
    ui_mark_selectable(s_btn_playpause);
    lv_obj_add_event_cb(s_btn_playpause, on_playpause_clicked, LV_EVENT_CLICKED, NULL);
    lv_obj_t *btn_lbl = lv_label_create(s_btn_playpause);
    lv_label_set_text(btn_lbl, LV_SYMBOL_PAUSE);
    lv_obj_set_style_text_color(btn_lbl, lv_color_white(), LV_PART_MAIN);
    lv_obj_center(btn_lbl);

    /* Next button */
    s_btn_next = lv_btn_create(scr);
    lv_obj_set_size(s_btn_next, 40, 40);
    lv_obj_set_style_bg_color(s_btn_next, UI_COLOR_CARD_BG, LV_PART_MAIN);
    lv_obj_set_style_radius(s_btn_next, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_align(s_btn_next, LV_ALIGN_BOTTOM_MID, 62, -16);
    lv_obj_clear_flag(s_btn_next, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_ext_click_area(s_btn_next, 10);
    ui_mark_selectable(s_btn_next);
    lv_obj_add_event_cb(s_btn_next, on_next_clicked, LV_EVENT_PRESSED, NULL);
    lv_obj_t *next_lbl = lv_label_create(s_btn_next);
    lv_label_set_text(next_lbl, LV_SYMBOL_NEXT);
    lv_obj_set_style_text_color(next_lbl, lv_color_white(), LV_PART_MAIN);
    lv_obj_center(next_lbl);

    /* Right-side invisible extender for panels with right-edge touch drift. */
    s_btn_next_hit = lv_btn_create(scr);
    lv_obj_set_size(s_btn_next_hit, 32, 44);
    lv_obj_align_to(s_btn_next_hit, s_btn_next, LV_ALIGN_OUT_RIGHT_MID, 0, 0);
    lv_obj_set_style_bg_opa(s_btn_next_hit, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_width(s_btn_next_hit, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(s_btn_next_hit, 0, LV_PART_MAIN);
    lv_obj_set_style_outline_width(s_btn_next_hit, 0, LV_PART_MAIN);
    lv_obj_clear_flag(s_btn_next_hit, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(s_btn_next_hit, on_next_clicked, LV_EVENT_PRESSED, NULL);
    ui_mark_selectable(s_btn_next_hit);

    /* 1-second timer to keep progress bar live */
    s_timer = lv_timer_create(on_progress_timer, 1000, NULL);

    /* Populate from current state */
    screen_now_playing_refresh(NULL);

    return scr;
}
