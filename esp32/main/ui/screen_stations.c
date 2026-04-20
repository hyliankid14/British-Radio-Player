#include "screen_stations.h"
#include "screen_now_playing.h"
#include "ui_manager.h"
#include "stations.h"
#include "playback_state.h"
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>
#include <time.h>

static const char *TAG = "screen_stations";
static lv_obj_t *s_station_labels[16] = {0};
static const station_t *s_station_label_stations[16] = {0};
static size_t s_station_label_count = 0;
static TaskHandle_t s_station_titles_task = NULL;

typedef struct {
    lv_obj_t *label;
    char text[64];
} station_title_update_t;

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

static void on_station_clicked(lv_event_t *e)
{
    const station_t *st = (const station_t *)lv_event_get_user_data(e);
    esp_err_t err = playback_play_station(st);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Could not play station %s", st->title);
        return;
    }
    lv_obj_t *np_scr = screen_now_playing_create();
    ui_push_screen(np_scr, LV_SCR_LOAD_ANIM_MOVE_LEFT);
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

static char *ess_fetch_json(const char *service_id, char *now_iso, size_t now_iso_len)
{
        if (now_iso && now_iso_len > 0) {
            now_iso[0] = '\0';
        }

    char url[176];
    snprintf(url, sizeof(url), "https://ess.api.bbci.co.uk/schedules?serviceId=%s&mediatypes=audio&t=%lld",
             service_id, (long long)(time(NULL) * 1000LL));

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

    if (esp_http_client_open(client, 0) != ESP_OK || esp_http_client_fetch_headers(client) < 0) {
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
        free(buf);
        return NULL;
    }
    return buf;
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
                if (!next_upcoming && strcmp(start_iso, now_iso) > 0) {
                    next_upcoming = item;
                }
            }
        }

        cJSON *chosen = chosen_current ? chosen_current : (next_upcoming ? next_upcoming : first_item);

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

static void apply_station_title_async(void *arg)
{
    station_title_update_t *update = (station_title_update_t *)arg;
    if (!update) {
        return;
    }
    if (update->label && lv_obj_is_valid(update->label)) {
        lv_label_set_text(update->label, update->text);
    }
    free(update);
}

static void station_titles_task(void *arg)
{
    LV_UNUSED(arg);
    for (size_t i = 0; i < s_station_label_count; i++) {
        lv_obj_t *label = s_station_labels[i];
        const station_t *station = s_station_label_stations[i];
        if (!label || !station || !station->service_id) {
            continue;
        }

        char now_iso[20] = {0};
        char *json = ess_fetch_json(station->service_id, now_iso, sizeof(now_iso));
        if (!json) {
            continue;
        }

        char show_title[64] = {0};
        if (ess_parse_show_title(json, now_iso[0] ? now_iso : NULL, show_title, sizeof(show_title))) {
            station_title_update_t *update = malloc(sizeof(*update));
            if (update) {
                update->label = label;
                strlcpy(update->text, show_title, sizeof(update->text));
                lv_async_call(apply_station_title_async, update);
            }
        }
        free(json);
    }

    s_station_titles_task = NULL;
    vTaskDelete(NULL);
}

void screen_stations_start_title_fetch(void)
{
    if (s_station_label_count == 0 || s_station_titles_task != NULL) {
        return;
    }

    if (xTaskCreate(station_titles_task, "station_titles", 6144, NULL, 3, &s_station_titles_task) != pdPASS) {
        s_station_titles_task = NULL;
        ESP_LOGW(TAG, "Failed to start station titles task");
    }
}

lv_obj_t *screen_stations_create(void)
{
    s_station_label_count = 0;

    lv_obj_t *scr = lv_obj_create(NULL);
    lv_disp_t *disp = lv_disp_get_default();
    lv_coord_t disp_w = disp ? lv_disp_get_hor_res(disp) : 240;
    lv_coord_t disp_h = disp ? lv_disp_get_ver_res(disp) : 240;
    lv_obj_remove_style_all(scr);
    lv_obj_set_size(scr, disp_w, disp_h);
    lv_obj_align(scr, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_set_style_bg_color(scr, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_outline_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(scr, 0, LV_PART_MAIN);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    ui_create_header(scr, "BBC Radio", true);

    lv_obj_t *list = lv_obj_create(scr);
    lv_obj_remove_style_all(list);
    lv_obj_set_size(list, disp_w, disp_h - UI_HEADER_HEIGHT);
    lv_obj_align(list, LV_ALIGN_TOP_LEFT, 0, UI_HEADER_HEIGHT);
    lv_obj_set_style_bg_color(list, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(list, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(list, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_left(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_right(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_top(list, 6, LV_PART_MAIN);
    lv_obj_set_style_pad_bottom(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_row(list, 6, LV_PART_MAIN);
    lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(list, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    /* Disable horizontal scrolling/panning and scrollbars. */
    lv_obj_set_scroll_dir(list, LV_DIR_VER);
    lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_OFF);
    lv_obj_set_style_width(list, 0, LV_PART_SCROLLBAR);
    lv_obj_set_style_bg_opa(list, LV_OPA_TRANSP, LV_PART_SCROLLBAR);
    lv_obj_set_style_border_width(list, 0, LV_PART_SCROLLBAR);
    lv_obj_set_style_clip_corner(list, true, LV_PART_MAIN);
    lv_obj_clear_flag(list, LV_OBJ_FLAG_SCROLL_CHAIN_HOR);
    lv_obj_clear_flag(list, LV_OBJ_FLAG_SCROLL_ELASTIC);

    size_t count = stations_count();
    const station_t *stations = stations_get_all();

    for (size_t i = 0; i < count; i++) {
        lv_obj_t *btn = lv_btn_create(list);
        lv_obj_remove_style_all(btn);
        lv_obj_set_width(btn, LV_PCT(100));
        lv_obj_set_height(btn, 40);
        lv_obj_set_style_bg_color(btn, UI_COLOR_CARD_BG, LV_PART_MAIN);
        lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_text_color(btn, UI_COLOR_TEXT, LV_PART_MAIN);
        lv_obj_set_style_border_width(btn, 0, LV_PART_MAIN);
        lv_obj_set_style_shadow_width(btn, 0, LV_PART_MAIN);
        lv_obj_set_style_outline_width(btn, 0, LV_PART_MAIN);
        lv_obj_set_style_radius(btn, 0, LV_PART_MAIN);
        lv_obj_set_style_pad_left(btn, 0, LV_PART_MAIN);
        lv_obj_set_style_pad_right(btn, 0, LV_PART_MAIN);
        lv_obj_set_style_pad_top(btn, 0, LV_PART_MAIN);
        lv_obj_set_style_pad_bottom(btn, 0, LV_PART_MAIN);
        lv_obj_set_flex_flow(btn, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(btn, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        lv_obj_set_style_clip_corner(btn, true, LV_PART_MAIN);
        lv_obj_clear_flag(btn, LV_OBJ_FLAG_SCROLLABLE);

        /* Explicit generic station badge (left side). */
        lv_obj_t *badge = lv_obj_create(btn);
        lv_obj_set_size(badge, 22, 22);
        lv_obj_set_style_bg_color(badge, station_logo_bg(&stations[i]), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(badge, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_border_width(badge, 0, LV_PART_MAIN);
        lv_obj_set_style_radius(badge, LV_RADIUS_CIRCLE, LV_PART_MAIN);
        lv_obj_set_style_pad_all(badge, 0, LV_PART_MAIN);
        lv_obj_clear_flag(badge, LV_OBJ_FLAG_SCROLLABLE);

        lv_obj_t *badge_lbl = lv_label_create(badge);
        lv_label_set_text(badge_lbl, station_logo_label(&stations[i]));
        lv_obj_set_style_text_color(badge_lbl, UI_COLOR_TEXT, LV_PART_MAIN);
        lv_obj_set_style_text_font(badge_lbl, &lv_font_montserrat_14, LV_PART_MAIN);
        lv_obj_center(badge_lbl);

        lv_obj_t *label = lv_label_create(btn);
        char title[48];
        station_display_title(&stations[i], title, sizeof(title));
        lv_label_set_text(label, title);
        lv_label_set_long_mode(label, LV_LABEL_LONG_DOT);
        lv_obj_set_width(label, 200);
        lv_obj_set_style_text_color(label, UI_COLOR_TEXT, LV_PART_MAIN);
        lv_obj_set_style_pad_left(label, 6, LV_PART_MAIN);

        if (s_station_label_count < (sizeof(s_station_labels) / sizeof(s_station_labels[0]))) {
            s_station_labels[s_station_label_count] = label;
            s_station_label_stations[s_station_label_count] = &stations[i];
            s_station_label_count++;
        }

        ui_mark_selectable(btn);
        lv_obj_add_event_cb(btn, on_station_clicked, LV_EVENT_CLICKED,
                             (void *)&stations[i]);
    }

    lv_obj_scroll_to_y(list, 0, LV_ANIM_OFF);
    screen_stations_start_title_fetch();

    return scr;
}
