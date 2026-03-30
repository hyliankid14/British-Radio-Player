#include "screen_podcasts.h"
#include "screen_pod_detail.h"
#include "ui_manager.h"
#include "podcast_index.h"
#include "subscriptions.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdint.h>
#include <string.h>
#include <stdlib.h>

static const char *TAG = "screen_podcasts";

typedef enum {
    POD_CAT_POPULAR = 0,
    POD_CAT_SUBSCRIBED = 1,
    POD_CAT_NEW = 2,
} pod_category_t;

/* Active category subpage widgets used by refresh callback. */
static lv_obj_t *s_active_list = NULL;
static lv_obj_t *s_active_spinner = NULL;
static pod_category_t s_active_category = POD_CAT_POPULAR;

static bool      s_fetch_in_progress = false;
static bool      s_fetch_attempted = false;
static esp_err_t s_last_fetch_err = ESP_OK;

static const char *loading_message(void)
{
    if (podcast_index_is_ready()) {
        return "No podcasts available";
    }
    if (s_last_fetch_err == ESP_ERR_NO_MEM) {
        return "Not enough memory for podcast list";
    }
    if (s_fetch_attempted && !s_fetch_in_progress && s_last_fetch_err != ESP_OK) {
        return "Could not load podcasts";
    }
    return "Loading popular podcasts...";
}

static void podcasts_fetch_task(void *arg)
{
    LV_UNUSED(arg);

    ESP_LOGI(TAG, "Fetching podcast index from Podcasts screen");
    esp_err_t err = podcast_index_fetch();
    s_last_fetch_err = err;
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "podcast_index_fetch failed: %s", esp_err_to_name(err));
    }

    s_fetch_in_progress = false;
    lv_async_call(screen_podcasts_refresh, NULL);
    vTaskDelete(NULL);
}

static void ensure_podcast_fetch_started(void)
{
    if (podcast_index_is_ready() || s_fetch_in_progress || s_fetch_attempted) {
        return;
    }

    s_fetch_attempted = true;
    s_fetch_in_progress = true;
    BaseType_t ok = xTaskCreate(podcasts_fetch_task, "pod_fetch_ui", 10240, NULL, 4, NULL);
    if (ok != pdPASS) {
        s_fetch_in_progress = false;
        s_last_fetch_err = ESP_FAIL;
        ESP_LOGW(TAG, "Could not start podcast fetch task");
    }
}

static void add_info_row(lv_obj_t *list, const char *text)
{
    lv_obj_t *lbl = lv_label_create(list);
    lv_label_set_text(lbl, text);
    lv_obj_set_style_text_color(lbl, UI_COLOR_SUBTEXT, LV_PART_MAIN);
    lv_obj_set_style_pad_top(lbl, 10, LV_PART_MAIN);
    lv_obj_set_style_pad_left(lbl, 8, LV_PART_MAIN);
}

static const char *category_title(pod_category_t category)
{
    switch (category) {
    case POD_CAT_POPULAR: return "Popular";
    case POD_CAT_SUBSCRIBED: return "Subscribed";
    case POD_CAT_NEW: return "New";
    default: return "Podcasts";
    }
}

static void on_podcast_clicked(lv_event_t *e)
{
    podcast_t *p = (podcast_t *)lv_event_get_user_data(e);
    lv_obj_t  *scr = screen_pod_detail_create(p);
    ui_push_screen(scr, LV_SCR_LOAD_ANIM_MOVE_LEFT);
}

static void add_podcast_btn(lv_obj_t *list, podcast_t *p)
{
    lv_obj_t *btn = lv_list_add_btn(list, LV_SYMBOL_LIST, p->title);
    lv_obj_set_style_bg_color(btn, UI_COLOR_CARD_BG, LV_PART_MAIN);
    lv_obj_set_style_text_color(btn, UI_COLOR_TEXT,    LV_PART_MAIN);
    ui_mark_selectable(btn);
    lv_obj_add_event_cb(btn, on_podcast_clicked, LV_EVENT_CLICKED, p);
}

static void populate_popular_list(lv_obj_t *list)
{
    size_t     count;
    podcast_t *all = podcast_index_get_all(&count);
    if (!all || count == 0) {
        add_info_row(list, loading_message());
        return;
    }

    /* Show podcasts that have a popularity rank, sorted ascending */
    for (int rank = 1; rank <= (int)count; rank++) {
        for (size_t i = 0; i < count; i++) {
            if (all[i].popularity_rank == rank) {
                add_podcast_btn(list, &all[i]);
            }
        }
    }
    /* Also show unranked entries if list is empty */
    if (lv_obj_get_child_cnt(list) == 0) {
        for (size_t i = 0; i < count && i < 50; i++) {
            add_podcast_btn(list, &all[i]);
        }
    }
}

static void populate_subscribed_list(lv_obj_t *list)
{
    esp_err_t sub_ret = subscriptions_load();
    if (sub_ret != ESP_OK) {
        ESP_LOGW(TAG, "subscriptions_load failed: %s", esp_err_to_name(sub_ret));
    }

    size_t count = subscriptions_count();
    if (count == 0) {
        add_info_row(list, "No subscriptions found");
        add_info_row(list, "Wokwi may not have copied subscriptions.txt to the SD card");
        return;
    }

    for (size_t i = 0; i < count; i++) {
        podcast_t *podcast = subscriptions_get_podcast(i);
        if (!podcast) continue;
        add_podcast_btn(list, podcast);
    }
}

static void populate_new_list(lv_obj_t *list)
{
    size_t     count;
    podcast_t *all = podcast_index_get_all(&count);
    if (!all || count == 0) {
        add_info_row(list, podcast_index_is_ready()
            ? "No new podcasts available"
            : loading_message());
        return;
    }

    size_t shown = 0;
    for (int rank = 1; rank <= 20; rank++) {
        for (size_t i = 0; i < count; i++) {
            if (all[i].is_new && all[i].new_rank == rank) {
                add_podcast_btn(list, &all[i]);
                shown++;
                break;
            }
        }
    }
    if (shown == 0) {
        add_info_row(list, "No new podcasts available");
    }
}

void screen_podcasts_refresh(void *arg)
{
    LV_UNUSED(arg);

    if (!s_active_list || !lv_obj_is_valid(s_active_list)) {
        return;
    }

    if (s_active_spinner && lv_obj_is_valid(s_active_spinner)) {
        if (podcast_index_is_ready()) {
            lv_obj_add_flag(s_active_spinner, LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_clear_flag(s_active_spinner, LV_OBJ_FLAG_HIDDEN);
        }
    }

    lv_obj_clean(s_active_list);
    switch (s_active_category) {
    case POD_CAT_POPULAR:
        populate_popular_list(s_active_list);
        break;
    case POD_CAT_SUBSCRIBED:
        populate_subscribed_list(s_active_list);
        break;
    case POD_CAT_NEW:
        populate_new_list(s_active_list);
        break;
    }

    ui_refresh_navigation();
    ESP_LOGI(TAG, "Podcast lists refreshed");
}

static lv_obj_t *create_category_screen(pod_category_t category)
{
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_pad_all(scr, 0, LV_PART_MAIN);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    ui_create_header(scr, category_title(category), true);

    lv_obj_t *list = lv_list_create(scr);
    lv_obj_set_size(list, 240, 204);
    lv_obj_align(list, LV_ALIGN_TOP_LEFT, 0, 36);
    lv_obj_set_style_bg_color(list, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_border_width(list, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_row(list, 2, LV_PART_MAIN);

    lv_obj_t *spinner = lv_spinner_create(scr, 1000, 60);
    lv_obj_set_size(spinner, 50, 50);
    lv_obj_center(spinner);

    s_active_category = category;
    s_active_list = list;
    s_active_spinner = spinner;

    screen_podcasts_refresh(NULL);
    return scr;
}

static void on_category_clicked(lv_event_t *e)
{
    pod_category_t category = (pod_category_t)(uintptr_t)lv_event_get_user_data(e);
    lv_obj_t *scr = create_category_screen(category);
    ui_push_screen(scr, LV_SCR_LOAD_ANIM_MOVE_LEFT);
}

static void add_category_btn(lv_obj_t *list, const char *icon, const char *title, pod_category_t category)
{
    lv_obj_t *btn = lv_list_add_btn(list, icon, title);
    lv_obj_set_style_bg_color(btn, UI_COLOR_CARD_BG, LV_PART_MAIN);
    lv_obj_set_style_text_color(btn, UI_COLOR_TEXT, LV_PART_MAIN);
    ui_mark_selectable(btn);
    lv_obj_add_event_cb(btn, on_category_clicked, LV_EVENT_CLICKED, (void *)(uintptr_t)category);
}

lv_obj_t *screen_podcasts_create(void)
{
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_pad_all(scr, 0, LV_PART_MAIN);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    ui_create_header(scr, "Podcasts", true);

    lv_obj_t *list = lv_list_create(scr);
    lv_obj_set_size(list, 240, 204);
    lv_obj_align(list, LV_ALIGN_TOP_LEFT, 0, 36);
    lv_obj_set_style_bg_color(list, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_border_width(list, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_row(list, 2, LV_PART_MAIN);

    add_category_btn(list, LV_SYMBOL_LIST, "Popular", POD_CAT_POPULAR);
    add_category_btn(list, LV_SYMBOL_OK, "Subscribed", POD_CAT_SUBSCRIBED);
    add_category_btn(list, LV_SYMBOL_BELL, "New", POD_CAT_NEW);

    s_fetch_in_progress = false;
    s_fetch_attempted = false;
    s_last_fetch_err = ESP_OK;
    ensure_podcast_fetch_started();

    s_active_list = NULL;
    s_active_spinner = NULL;

    return scr;
}
