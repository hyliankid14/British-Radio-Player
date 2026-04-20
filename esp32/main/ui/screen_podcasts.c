#include "screen_podcasts.h"
#include "screen_pod_detail.h"
#include "ui_manager.h"
#include "podcast_index.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdint.h>
#include <stdlib.h>

static const char *TAG = "screen_podcasts";

#define POPULAR_FETCH_LIMIT 24
#define POPULAR_PAGE_SIZE    6

static lv_obj_t *s_popular_list = NULL;
static lv_obj_t *s_popular_spinner = NULL;
static lv_obj_t *s_prev_btn = NULL;
static lv_obj_t *s_next_btn = NULL;
static lv_obj_t *s_page_label = NULL;
static bool      s_fetch_in_progress = false;
static bool      s_fetch_attempted = false;
static esp_err_t s_last_fetch_err = ESP_OK;
static size_t    s_popular_page = 0;

static const char *popular_loading_message(void)
{
    if (podcast_index_is_ready()) {
        return "No popular podcasts available";
    }
    if (s_last_fetch_err == ESP_ERR_NO_MEM) {
        return "Not enough memory for podcasts";
    }
    if (s_fetch_attempted && !s_fetch_in_progress && s_last_fetch_err != ESP_OK) {
        return "Could not load podcasts";
    }
    return "Loading popular podcasts...";
}

static size_t popular_page_count(size_t total)
{
    return (total + POPULAR_PAGE_SIZE - 1) / POPULAR_PAGE_SIZE;
}

static void on_podcast_clicked(lv_event_t *e)
{
    podcast_t *podcast = (podcast_t *)lv_event_get_user_data(e);
    if (!podcast) {
        return;
    }
    lv_obj_t *scr = screen_pod_detail_create(podcast);
    ui_push_screen(scr, LV_SCR_LOAD_ANIM_MOVE_LEFT);
}

static void podcasts_fetch_task(void *arg)
{
    LV_UNUSED(arg);

    ESP_LOGI(TAG, "Fetching popular podcast index from Podcasts screen");
    esp_err_t err = podcast_index_fetch_popular(POPULAR_FETCH_LIMIT);
    s_last_fetch_err = err;
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "podcast_index_fetch_popular failed: %s", esp_err_to_name(err));
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
    if (xTaskCreate(podcasts_fetch_task, "pod_fetch_ui", 8192, NULL, 4, NULL) != pdPASS) {
        s_fetch_in_progress = false;
        s_last_fetch_err = ESP_FAIL;
        ESP_LOGW(TAG, "Could not start podcast fetch task");
    }
}

static void update_pager(size_t total)
{
    size_t pages = popular_page_count(total);
    if (pages == 0) {
        pages = 1;
    }
    if (s_popular_page >= pages) {
        s_popular_page = pages - 1;
    }

    if (s_page_label && lv_obj_is_valid(s_page_label)) {
        char page_text[24];
        snprintf(page_text, sizeof(page_text), "%u/%u",
                 (unsigned)(s_popular_page + 1), (unsigned)pages);
        lv_label_set_text(s_page_label, page_text);
    }

    if (s_prev_btn && lv_obj_is_valid(s_prev_btn)) {
        if (s_popular_page == 0) lv_obj_add_state(s_prev_btn, LV_STATE_DISABLED);
        else lv_obj_clear_state(s_prev_btn, LV_STATE_DISABLED);
    }
    if (s_next_btn && lv_obj_is_valid(s_next_btn)) {
        if (s_popular_page + 1 >= pages) lv_obj_add_state(s_next_btn, LV_STATE_DISABLED);
        else lv_obj_clear_state(s_next_btn, LV_STATE_DISABLED);
    }
}

static void add_popular_rows(void)
{
    size_t count = 0;
    podcast_t *all = podcast_index_get_all(&count);

    lv_obj_clean(s_popular_list);

    if (!all || count == 0) {
        lv_obj_t *lbl = lv_label_create(s_popular_list);
        lv_label_set_text(lbl, popular_loading_message());
        lv_obj_set_style_text_color(lbl, UI_COLOR_SUBTEXT, LV_PART_MAIN);
        lv_obj_set_style_pad_top(lbl, 10, LV_PART_MAIN);
        lv_obj_set_style_pad_left(lbl, 8, LV_PART_MAIN);
        update_pager(0);
        return;
    }

    size_t start = s_popular_page * POPULAR_PAGE_SIZE;
    size_t end = start + POPULAR_PAGE_SIZE;
    if (end > count) {
        end = count;
    }

    for (size_t i = start; i < end; i++) {
        lv_obj_t *btn = lv_list_add_btn(s_popular_list, LV_SYMBOL_AUDIO, all[i].title);
        lv_obj_set_style_bg_color(btn, UI_COLOR_CARD_BG, LV_PART_MAIN);
        lv_obj_set_style_text_color(btn, UI_COLOR_TEXT, LV_PART_MAIN);
        lv_obj_set_style_border_width(btn, 0, LV_PART_MAIN);
        lv_obj_set_style_radius(btn, 0, LV_PART_MAIN);
        ui_mark_selectable(btn);
        lv_obj_add_event_cb(btn, on_podcast_clicked, LV_EVENT_CLICKED, &all[i]);
    }

    update_pager(count);
}

void screen_podcasts_refresh(void *arg)
{
    LV_UNUSED(arg);

    if (s_popular_spinner && lv_obj_is_valid(s_popular_spinner)) {
        if (podcast_index_is_ready()) {
            lv_obj_add_flag(s_popular_spinner, LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_clear_flag(s_popular_spinner, LV_OBJ_FLAG_HIDDEN);
        }
    }

    if (s_popular_list && lv_obj_is_valid(s_popular_list)) {
        add_popular_rows();
        ui_refresh_navigation();
    }
}

static void on_prev_page(lv_event_t *e)
{
    LV_UNUSED(e);
    if (s_popular_page == 0) {
        return;
    }
    s_popular_page--;
    screen_podcasts_refresh(NULL);
}

static void on_next_page(lv_event_t *e)
{
    LV_UNUSED(e);
    size_t count = 0;
    (void)podcast_index_get_all(&count);
    size_t pages = popular_page_count(count);
    if (pages == 0 || s_popular_page + 1 >= pages) {
        return;
    }
    s_popular_page++;
    screen_podcasts_refresh(NULL);
}

static lv_obj_t *create_popular_screen(void)
{
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_remove_style_all(scr);
    lv_obj_set_style_bg_color(scr, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_outline_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(scr, 0, LV_PART_MAIN);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    ui_create_header(scr, "Popular Podcasts", true);

    s_popular_list = lv_list_create(scr);
    lv_obj_set_size(s_popular_list, 240, 240 - UI_HEADER_HEIGHT - 32);
    lv_obj_align(s_popular_list, LV_ALIGN_TOP_LEFT, 0, UI_HEADER_HEIGHT);
    lv_obj_set_style_bg_color(s_popular_list, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_popular_list, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_pad_all(s_popular_list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_left(s_popular_list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_right(s_popular_list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_row(s_popular_list, 2, LV_PART_MAIN);
    lv_obj_set_scroll_dir(s_popular_list, LV_DIR_VER);
    lv_obj_set_scrollbar_mode(s_popular_list, LV_SCROLLBAR_MODE_OFF);

    lv_obj_t *pager = lv_obj_create(scr);
    lv_obj_remove_style_all(pager);
    lv_obj_set_size(pager, 240, 32);
    lv_obj_align(pager, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_set_style_bg_color(pager, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(pager, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_pad_all(pager, 0, LV_PART_MAIN);
    lv_obj_clear_flag(pager, LV_OBJ_FLAG_SCROLLABLE);

    s_prev_btn = lv_btn_create(pager);
    lv_obj_remove_style_all(s_prev_btn);
    lv_obj_set_size(s_prev_btn, 52, 24);
    lv_obj_align(s_prev_btn, LV_ALIGN_LEFT_MID, 8, 0);
    lv_obj_set_style_bg_color(s_prev_btn, UI_COLOR_CARD_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_prev_btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_radius(s_prev_btn, 8, LV_PART_MAIN);
    lv_obj_add_event_cb(s_prev_btn, on_prev_page, LV_EVENT_PRESSED, NULL);
    lv_obj_add_event_cb(s_prev_btn, on_prev_page, LV_EVENT_CLICKED, NULL);
    lv_obj_set_ext_click_area(s_prev_btn, 12);
    ui_mark_selectable(s_prev_btn);
    lv_obj_t *prev_lbl = lv_label_create(s_prev_btn);
    lv_label_set_text(prev_lbl, "Prev");
    lv_obj_set_style_text_color(prev_lbl, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_center(prev_lbl);

    s_next_btn = lv_btn_create(pager);
    lv_obj_remove_style_all(s_next_btn);
    lv_obj_set_size(s_next_btn, 52, 24);
    lv_obj_align(s_next_btn, LV_ALIGN_RIGHT_MID, -8, 0);
    lv_obj_set_style_bg_color(s_next_btn, UI_COLOR_CARD_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_next_btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_radius(s_next_btn, 8, LV_PART_MAIN);
    lv_obj_add_event_cb(s_next_btn, on_next_page, LV_EVENT_PRESSED, NULL);
    lv_obj_add_event_cb(s_next_btn, on_next_page, LV_EVENT_CLICKED, NULL);
    lv_obj_set_ext_click_area(s_next_btn, 12);
    ui_mark_selectable(s_next_btn);
    lv_obj_t *next_lbl = lv_label_create(s_next_btn);
    lv_label_set_text(next_lbl, "Next");
    lv_obj_set_style_text_color(next_lbl, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_center(next_lbl);

    s_page_label = lv_label_create(pager);
    lv_label_set_text(s_page_label, "1/1");
    lv_obj_set_style_text_color(s_page_label, UI_COLOR_SUBTEXT, LV_PART_MAIN);
    lv_obj_align(s_page_label, LV_ALIGN_CENTER, 0, 0);

    s_popular_spinner = lv_spinner_create(scr, 1000, 60);
    lv_obj_set_size(s_popular_spinner, 42, 42);
    lv_obj_center(s_popular_spinner);

    screen_podcasts_refresh(NULL);
    return scr;
}

static lv_obj_t *make_tile(lv_obj_t *parent, const char *icon, const char *label,
                           lv_color_t colour, lv_event_cb_t cb)
{
    lv_obj_t *card = lv_obj_create(parent);
    lv_obj_remove_style_all(card);
    lv_obj_set_size(card, 116, 100);
    lv_obj_set_style_bg_color(card, colour, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(card, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(card, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(card, 0, LV_PART_MAIN);
    lv_obj_set_style_outline_width(card, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(card, 12, LV_PART_MAIN);
    lv_obj_set_style_pad_all(card, 8, LV_PART_MAIN);
    lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(card, LV_OBJ_FLAG_CLICKABLE);
    ui_mark_selectable(card);
    lv_obj_add_event_cb(card, cb, LV_EVENT_CLICKED, NULL);

    lv_obj_t *ico = lv_label_create(card);
    lv_label_set_text(ico, icon);
    lv_obj_set_style_text_color(ico, lv_color_white(), LV_PART_MAIN);
    lv_obj_align(ico, LV_ALIGN_CENTER, 0, -10);

    lv_obj_t *lbl = lv_label_create(card);
    lv_label_set_text(lbl, label);
    lv_obj_set_style_text_color(lbl, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_text_font(lbl, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(lbl, LV_ALIGN_BOTTOM_MID, 0, 0);

    return card;
}

static void on_open_popular(lv_event_t *e)
{
    LV_UNUSED(e);
    s_popular_page = 0;
    lv_obj_t *scr = create_popular_screen();
    ui_push_screen(scr, LV_SCR_LOAD_ANIM_MOVE_LEFT);
}

lv_obj_t *screen_podcasts_create(void)
{
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_remove_style_all(scr);
    lv_obj_set_style_bg_color(scr, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_outline_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(scr, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(scr, 0, LV_PART_MAIN);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    ui_create_header(scr, "Podcasts", true);

    lv_obj_t *row = lv_obj_create(scr);
    lv_obj_remove_style_all(row);
    lv_obj_set_size(row, LV_PCT(100), LV_SIZE_CONTENT);
    lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_width(row, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(row, 0, LV_PART_MAIN);
    lv_obj_set_style_outline_width(row, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(row, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(row, 0, LV_PART_MAIN);
    lv_obj_align(row, LV_ALIGN_CENTER, 0, 26);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);

    make_tile(row, LV_SYMBOL_LIST, "Popular", lv_color_make(0x1A, 0x73, 0xE8), on_open_popular);

    s_popular_list = NULL;
    s_popular_spinner = NULL;
    s_prev_btn = NULL;
    s_next_btn = NULL;
    s_page_label = NULL;
    s_fetch_in_progress = false;
    s_fetch_attempted = false;
    s_last_fetch_err = ESP_OK;
    ensure_podcast_fetch_started();

    return scr;
}
