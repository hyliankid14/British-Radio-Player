#include "ui_manager.h"
#include "bsp_power_manager.h"
#include "bsp_display.h"
#include "audio/bbc_audio.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

static const char *TAG = "ui_mgr";

/* ── Navigation stack ──────────────────────────────────────────────────── */
#define SCREEN_STACK_DEPTH 8
static lv_obj_t  *s_stack[SCREEN_STACK_DEPTH];
static int         s_top = -1;

#define MAX_FOCUSABLE_OBJS 64
static lv_obj_t *s_focusable[MAX_FOCUSABLE_OBJS];
static int       s_focusable_count = 0;
static int       s_focus_index = -1;
static int       s_volume_percent = 70;
static bool      s_display_sleeping = false;

#define UI_ACTIVE_BRIGHTNESS 80
#define UI_TOUCH_MIN_SIZE    44
#define UI_PWR_HOLD_MS       1400

static lv_obj_t   *s_volume_overlay = NULL;
static lv_obj_t   *s_volume_bar = NULL;
static lv_obj_t   *s_volume_label = NULL;
static lv_timer_t *s_volume_hide_timer = NULL;

static lv_obj_t   *s_power_msg = NULL;
static lv_timer_t *s_power_off_timer = NULL;

#define MAX_BAT_LABELS 16
static lv_obj_t *s_battery_labels[MAX_BAT_LABELS];
static int       s_battery_label_count = 0;
static lv_timer_t *s_battery_timer = NULL;

/* ── Button-driven LVGL input device ──────────────────────────────────── */
#define BTN_PLUS_GPIO  4
#define BTN_PWR_GPIO   5
#define BTN_BOOT_GPIO  0

static void ui_pop_screen_async(void *arg)
{
    LV_UNUSED(arg);
    ui_pop_screen();
}

static void ui_wake_display_if_needed(void)
{
    if (!s_display_sleeping) {
        return;
    }
    bsp_display_brightness_set(UI_ACTIVE_BRIGHTNESS);
    s_display_sleeping = false;
}

static void ui_sleep_display_async(void *arg)
{
    LV_UNUSED(arg);
    bsp_display_brightness_set(0);
    s_display_sleeping = true;
    ESP_LOGI(TAG, "Display sleeping");
}

static void ui_power_off_timer_cb(lv_timer_t *timer)
{
    LV_UNUSED(timer);
    if (s_power_msg && lv_obj_is_valid(s_power_msg)) {
        lv_obj_del(s_power_msg);
    }
    s_power_msg = NULL;
    s_power_off_timer = NULL;
    ESP_LOGI(TAG, "Entering deep sleep (wake: PWR button)");
    bsp_display_brightness_set(0);
    s_display_sleeping = true;
    
    /* Configure PWR button for wake from deep sleep */
    esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
    esp_sleep_enable_ext1_wakeup(1ULL << BTN_PWR_GPIO, ESP_EXT1_WAKEUP_ANY_LOW);
    /* Hold GPIO at current state to preserve pull-up during sleep */
    gpio_hold_en(BTN_PWR_GPIO);
    esp_deep_sleep_start();
}

static void ui_power_off_async(void *arg)
{
    LV_UNUSED(arg);
    lv_obj_t *screen = ui_current_screen();
    if (screen == NULL) {
        bsp_power_off();
        return;
    }

    if (s_power_msg == NULL || !lv_obj_is_valid(s_power_msg)) {
        s_power_msg = lv_obj_create(screen);
        lv_obj_set_size(s_power_msg, 180, 72);
        lv_obj_align(s_power_msg, LV_ALIGN_CENTER, 0, 0);
        lv_obj_set_style_bg_color(s_power_msg, UI_COLOR_CARD_BG, LV_PART_MAIN);
        lv_obj_set_style_border_color(s_power_msg, UI_COLOR_BBC_RED, LV_PART_MAIN);
        lv_obj_set_style_border_width(s_power_msg, 2, LV_PART_MAIN);
        lv_obj_set_style_radius(s_power_msg, 10, LV_PART_MAIN);
        lv_obj_set_style_pad_all(s_power_msg, 8, LV_PART_MAIN);

        lv_obj_t *label = lv_label_create(s_power_msg);
        lv_label_set_text(label, "Powering off...");
        lv_obj_set_style_text_color(label, UI_COLOR_TEXT, LV_PART_MAIN);
        lv_obj_center(label);
    }

    if (s_power_off_timer) {
        lv_timer_del(s_power_off_timer);
        s_power_off_timer = NULL;
    }
    s_power_off_timer = lv_timer_create(ui_power_off_timer_cb, 900, NULL);
    lv_timer_set_repeat_count(s_power_off_timer, 1);
}

static void ui_volume_hide_timer_cb(lv_timer_t *timer)
{
    LV_UNUSED(timer);
    if (s_volume_overlay && lv_obj_is_valid(s_volume_overlay)) {
        lv_obj_add_flag(s_volume_overlay, LV_OBJ_FLAG_HIDDEN);
    }
}

static void ui_ensure_volume_overlay(lv_obj_t *screen)
{
    if (screen == NULL) {
        return;
    }

    if (s_volume_overlay && lv_obj_is_valid(s_volume_overlay) && lv_obj_get_parent(s_volume_overlay) == screen) {
        return;
    }

    s_volume_overlay = lv_obj_create(screen);
    lv_obj_set_size(s_volume_overlay, 172, 48);
    lv_obj_align(s_volume_overlay, LV_ALIGN_BOTTOM_MID, 0, -8);
    lv_obj_set_style_bg_color(s_volume_overlay, UI_COLOR_CARD_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_volume_overlay, LV_OPA_90, LV_PART_MAIN);
    lv_obj_set_style_border_color(s_volume_overlay, UI_COLOR_BBC_RED, LV_PART_MAIN);
    lv_obj_set_style_border_width(s_volume_overlay, 1, LV_PART_MAIN);
    lv_obj_set_style_radius(s_volume_overlay, 10, LV_PART_MAIN);
    lv_obj_set_style_pad_all(s_volume_overlay, 6, LV_PART_MAIN);
    lv_obj_clear_flag(s_volume_overlay, LV_OBJ_FLAG_SCROLLABLE);

    s_volume_label = lv_label_create(s_volume_overlay);
    lv_label_set_text(s_volume_label, "Vol 70%");
    lv_obj_set_style_text_color(s_volume_label, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_align(s_volume_label, LV_ALIGN_TOP_MID, 0, 0);

    s_volume_bar = lv_bar_create(s_volume_overlay);
    lv_obj_set_size(s_volume_bar, 150, 10);
    lv_obj_align(s_volume_bar, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_bar_set_range(s_volume_bar, 0, 100);
    lv_obj_set_style_bg_color(s_volume_bar, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_volume_bar, UI_COLOR_BBC_RED, LV_PART_INDICATOR);

    lv_obj_add_flag(s_volume_overlay, LV_OBJ_FLAG_HIDDEN);

    if (s_volume_hide_timer == NULL) {
        s_volume_hide_timer = lv_timer_create(ui_volume_hide_timer_cb, 1400, NULL);
    }
}

static void ui_show_volume_overlay(void)
{
    lv_obj_t *screen = ui_current_screen();
    ui_ensure_volume_overlay(screen);
    if (s_volume_overlay == NULL || !lv_obj_is_valid(s_volume_overlay)) {
        return;
    }

    char text[20];
    snprintf(text, sizeof(text), "Vol %d%%", s_volume_percent);
    if (s_volume_label && lv_obj_is_valid(s_volume_label)) {
        lv_label_set_text(s_volume_label, text);
    }
    if (s_volume_bar && lv_obj_is_valid(s_volume_bar)) {
        lv_bar_set_value(s_volume_bar, s_volume_percent, LV_ANIM_ON);
    }

    lv_obj_clear_flag(s_volume_overlay, LV_OBJ_FLAG_HIDDEN);
    if (s_volume_hide_timer) {
        lv_timer_reset(s_volume_hide_timer);
    }
}

static void ui_volume_up_async(void *arg)
{
    LV_UNUSED(arg);
    ui_wake_display_if_needed();
    s_volume_percent += 5;
    if (s_volume_percent > 100) s_volume_percent = 100;
    bbc_audio_set_volume(s_volume_percent);
    ui_show_volume_overlay();
    ESP_LOGI(TAG, "Volume: %d%%", s_volume_percent);
}

static void ui_volume_down_async(void *arg)
{
    LV_UNUSED(arg);
    ui_wake_display_if_needed();
    s_volume_percent -= 5;
    if (s_volume_percent < 0) s_volume_percent = 0;
    bbc_audio_set_volume(s_volume_percent);
    ui_show_volume_overlay();
    ESP_LOGI(TAG, "Volume: %d%%", s_volume_percent);
}

static void ui_back_clicked(lv_event_t *e)
{
    LV_UNUSED(e);
    ui_wake_display_if_needed();
    lv_async_call(ui_pop_screen_async, NULL);
}

static void ui_touch_wake_cb(lv_event_t *e)
{
    LV_UNUSED(e);
    ui_wake_display_if_needed();
}

static void battery_label_text(char *buf, size_t len)
{
    int level = bsp_get_battery_level();
    if (level < 0) {
        snprintf(buf, len, "BAT --");
        return;
    }
    if (bsp_is_charging()) {
        snprintf(buf, len, "+%d%%", level);
    } else {
        snprintf(buf, len, "%d%%", level);
    }
}

static void battery_timer_cb(lv_timer_t *timer)
{
    LV_UNUSED(timer);
    char text[16];
    battery_label_text(text, sizeof(text));
    for (int i = 0; i < s_battery_label_count; i++) {
        if (s_battery_labels[i] && lv_obj_is_valid(s_battery_labels[i])) {
            lv_label_set_text(s_battery_labels[i], text);
        }
    }
}

static void ui_focus_next_async(void *arg)
{
    LV_UNUSED(arg);
    if (s_focusable_count <= 0) return;

    lv_obj_t *prev = (s_focus_index >= 0) ? s_focusable[s_focus_index] : NULL;
    if (prev && lv_obj_is_valid(prev)) {
        lv_obj_set_style_outline_width(prev, 0, LV_PART_MAIN);
    }

    s_focus_index = (s_focus_index + 1) % s_focusable_count;
    lv_obj_t *cur = s_focusable[s_focus_index];
    if (cur && lv_obj_is_valid(cur)) {
        lv_obj_set_style_outline_color(cur, lv_color_white(), LV_PART_MAIN);
        lv_obj_set_style_outline_width(cur, 2, LV_PART_MAIN);
        lv_obj_set_style_outline_pad(cur, 2, LV_PART_MAIN);

        /* Keep focused controls visible when navigating long scrollable lists. */
        lv_obj_scroll_to_view_recursive(cur, LV_ANIM_ON);
    }
}

static void ui_group_add_focusable_recursive(lv_obj_t *obj)
{
    if (obj == NULL) return;

    bool clickable = lv_obj_has_flag(obj, LV_OBJ_FLAG_CLICKABLE);
    bool marked = lv_obj_has_flag(obj, LV_OBJ_FLAG_USER_1);
    bool hidden = lv_obj_has_flag(obj, LV_OBJ_FLAG_HIDDEN);
    if (clickable && marked && !hidden && s_focusable_count < MAX_FOCUSABLE_OBJS) {
        s_focusable[s_focusable_count++] = obj;
    }

    uint32_t child_count = lv_obj_get_child_cnt(obj);
    for (uint32_t i = 0; i < child_count; i++) {
        lv_obj_t *child = lv_obj_get_child(obj, i);
        ui_group_add_focusable_recursive(child);
    }
}

static void ui_expand_touch_targets_recursive(lv_obj_t *obj)
{
    if (obj == NULL) {
        return;
    }

    if (lv_obj_has_flag(obj, LV_OBJ_FLAG_CLICKABLE) && !lv_obj_has_flag(obj, LV_OBJ_FLAG_HIDDEN)) {
        lv_obj_set_style_min_width(obj, UI_TOUCH_MIN_SIZE, LV_PART_MAIN);
        lv_obj_set_style_min_height(obj, UI_TOUCH_MIN_SIZE, LV_PART_MAIN);
        lv_obj_set_style_pad_left(obj, 10, LV_PART_MAIN);
        lv_obj_set_style_pad_right(obj, 10, LV_PART_MAIN);
        lv_obj_set_style_pad_top(obj, 8, LV_PART_MAIN);
        lv_obj_set_style_pad_bottom(obj, 8, LV_PART_MAIN);
    }

    uint32_t child_count = lv_obj_get_child_cnt(obj);
    for (uint32_t i = 0; i < child_count; i++) {
        ui_expand_touch_targets_recursive(lv_obj_get_child(obj, i));
    }
}

static void ui_rebuild_focus_group(lv_obj_t *root)
{
    if (root == NULL) return;

    ui_expand_touch_targets_recursive(root);

    for (int i = 0; i < s_focusable_count; i++) {
        lv_obj_t *obj = s_focusable[i];
        if (obj && lv_obj_is_valid(obj)) {
            lv_obj_set_style_outline_width(obj, 0, LV_PART_MAIN);
        }
    }

    s_focusable_count = 0;
    s_focus_index = -1;
    ui_group_add_focusable_recursive(root);

    if (s_focusable_count > 0) {
        s_focus_index = -1;
        ui_focus_next_async(NULL);
        ESP_LOGI(TAG, "Focus targets: %d", s_focusable_count);
    } else {
        ESP_LOGW(TAG, "No focusable widgets on current screen");
    }
}

static void button_poll_task(void *arg)
{
    const TickType_t poll_period = pdMS_TO_TICKS(15);
    const TickType_t debounce_ms = pdMS_TO_TICKS(80);
    const TickType_t power_hold_ticks = pdMS_TO_TICKS(UI_PWR_HOLD_MS);

    int last_plus = 1;
    int last_pwr  = 1;
    int last_boot = 1;

    TickType_t plus_unlock = 0;
    TickType_t pwr_unlock  = 0;
    TickType_t boot_unlock = 0;
    TickType_t pwr_press_start = 0;
    bool pwr_hold_handled = false;

    while (true) {
        vTaskDelay(poll_period);
        TickType_t now = xTaskGetTickCount();

        int plus = gpio_get_level(BTN_PLUS_GPIO);
        int pwr  = gpio_get_level(BTN_PWR_GPIO);
        int boot = gpio_get_level(BTN_BOOT_GPIO);

        if (last_plus == 1 && plus == 0 && now >= plus_unlock) {
            ESP_LOGI(TAG, "Button +/KEY (vol+)");
            lv_async_call(ui_volume_up_async, NULL);
            plus_unlock = now + debounce_ms;
        }

        if (last_pwr == 1 && pwr == 0) {
            pwr_press_start = now;
            pwr_hold_handled = false;
        }
        if (pwr == 0 && !pwr_hold_handled && (now - pwr_press_start) >= power_hold_ticks) {
            ESP_LOGI(TAG, "Button PWR hold (power off)");
            lv_async_call(ui_power_off_async, NULL);
            pwr_hold_handled = true;
            pwr_unlock = now + debounce_ms;
        }
        if (last_pwr == 0 && pwr == 1 && now >= pwr_unlock) {
            if (!pwr_hold_handled) {
                ESP_LOGI(TAG, "Button PWR short (sleep display)");
                lv_async_call(ui_sleep_display_async, NULL);
            }
            pwr_unlock = now + debounce_ms;
        }

        if (last_boot == 1 && boot == 0 && now >= boot_unlock) {
            ESP_LOGI(TAG, "Button BOOT/- (vol-)");
            lv_async_call(ui_volume_down_async, NULL);
            boot_unlock = now + debounce_ms;
        }

        last_plus = plus;
        last_pwr  = pwr;
        last_boot = boot;
    }
}

static void register_buttons(void)
{
    gpio_config_t io_cfg = {
        .pin_bit_mask = (1ULL << BTN_PLUS_GPIO) | (1ULL << BTN_PWR_GPIO) | (1ULL << BTN_BOOT_GPIO),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_cfg);

    xTaskCreate(button_poll_task, "ui_btn_poll", 2048, NULL, 5, NULL);
}

static void register_indev(void)
{
    /* Kept for API symmetry; navigation is handled explicitly. */
}

/* ── Public API ────────────────────────────────────────────────────────── */

void ui_manager_init(void)
{
    register_buttons();
    register_indev();
    if (s_battery_timer == NULL) {
        s_battery_timer = lv_timer_create(battery_timer_cb, 5000, NULL);
    }
    ESP_LOGI(TAG, "UI manager initialised (+/KEY=vol+, BOOT/-=vol-, PWR short=sleep, hold=off)");
}

void ui_mark_selectable(lv_obj_t *obj)
{
    if (obj == NULL) return;
    lv_obj_add_flag(obj, LV_OBJ_FLAG_USER_1);
    lv_obj_set_style_min_width(obj, UI_TOUCH_MIN_SIZE, LV_PART_MAIN);
    lv_obj_set_style_min_height(obj, UI_TOUCH_MIN_SIZE, LV_PART_MAIN);
    lv_obj_add_event_cb(obj, ui_touch_wake_cb, LV_EVENT_PRESSED, NULL);
}

void ui_refresh_navigation(void)
{
    lv_obj_t *root = ui_current_screen();
    if (root != NULL) {
        ui_rebuild_focus_group(root);
    }
}

void ui_push_screen(lv_obj_t *scr, lv_scr_load_anim_t anim)
{
    if (s_top >= SCREEN_STACK_DEPTH - 1) {
        ESP_LOGW(TAG, "Screen stack full");
        return;
    }
    s_stack[++s_top] = scr;
    lv_scr_load_anim(scr, anim, 200, 0, false);
    ui_rebuild_focus_group(scr);
}

void ui_pop_screen(void)
{
    if (s_top <= 0) return;
    s_top--;
    lv_scr_load_anim(s_stack[s_top], LV_SCR_LOAD_ANIM_MOVE_RIGHT, 200, 0, false);
    ui_rebuild_focus_group(s_stack[s_top]);
}

lv_obj_t *ui_current_screen(void)
{
    return (s_top >= 0) ? s_stack[s_top] : NULL;
}

void ui_create_header(lv_obj_t *parent, const char *title, bool show_back)
{
    lv_obj_t *hdr = lv_obj_create(parent);
    lv_obj_set_size(hdr, LV_PCT(100), UI_HEADER_HEIGHT);
    lv_obj_align(hdr, LV_ALIGN_TOP_MID, 0, 0);
    lv_obj_set_style_bg_color(hdr, UI_COLOR_BBC_RED,   LV_PART_MAIN);
    lv_obj_set_style_border_width(hdr, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(hdr, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(hdr, 6, LV_PART_MAIN);

    lv_obj_t *lbl = lv_label_create(hdr);
    lv_label_set_text(lbl, title);
    lv_obj_set_style_text_color(lbl, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_set_style_text_font(lbl, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(lbl, LV_ALIGN_CENTER, 0, 0);

    if (show_back) {
        lv_obj_t *back_btn = lv_btn_create(hdr);
        lv_obj_set_size(back_btn, 44, 40);
        lv_obj_align(back_btn, LV_ALIGN_LEFT_MID, 2, 0);
        lv_obj_set_style_bg_opa(back_btn, LV_OPA_TRANSP, LV_PART_MAIN);
        lv_obj_set_style_border_width(back_btn, 0, LV_PART_MAIN);
        lv_obj_set_style_shadow_width(back_btn, 0, LV_PART_MAIN);
        lv_obj_add_event_cb(back_btn, ui_back_clicked, LV_EVENT_CLICKED, NULL);
        ui_mark_selectable(back_btn);

        lv_obj_t *back = lv_label_create(back_btn);
        lv_label_set_text(back, LV_SYMBOL_LEFT);
        lv_obj_set_style_text_color(back, UI_COLOR_TEXT, LV_PART_MAIN);
        lv_obj_center(back);
    }

    if (s_battery_label_count < MAX_BAT_LABELS) {
        lv_obj_t *bat = lv_label_create(hdr);
        lv_obj_set_style_text_color(bat, UI_COLOR_TEXT, LV_PART_MAIN);
        lv_obj_set_style_text_font(bat, &lv_font_montserrat_14, LV_PART_MAIN);
        lv_obj_align(bat, LV_ALIGN_RIGHT_MID, -8, 0);
        s_battery_labels[s_battery_label_count++] = bat;
        char text[16];
        battery_label_text(text, sizeof(text));
        lv_label_set_text(bat, text);
    }
}
