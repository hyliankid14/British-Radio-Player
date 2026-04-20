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

#define UI_BRIGHTNESS_OFF    0
#define UI_BRIGHTNESS_LOW    20
#define UI_BRIGHTNESS_MEDIUM 50
#define UI_BRIGHTNESS_HIGH   80

static const int s_brightness_steps[] = {
    UI_BRIGHTNESS_OFF,
    UI_BRIGHTNESS_LOW,
    UI_BRIGHTNESS_MEDIUM,
    UI_BRIGHTNESS_HIGH,
};
static int s_brightness_step_index = 3;

static lv_obj_t   *s_volume_overlay = NULL;
static lv_obj_t   *s_volume_bar = NULL;
static lv_obj_t   *s_volume_label = NULL;
static lv_timer_t *s_volume_hide_timer = NULL;

static lv_obj_t   *s_power_msg = NULL;
static lv_timer_t *s_power_off_timer = NULL;

#define MAX_BAT_WIDGETS 16
static lv_obj_t  *s_battery_fills[MAX_BAT_WIDGETS];
static int        s_battery_fill_count = 0;
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
    s_brightness_step_index = 3;
    bsp_display_brightness_set(s_brightness_steps[s_brightness_step_index]);
    s_display_sleeping = false;
}

static void ui_cycle_display_brightness_async(void *arg)
{
    LV_UNUSED(arg);
    int step_count = (int)(sizeof(s_brightness_steps) / sizeof(s_brightness_steps[0]));
    s_brightness_step_index = (s_brightness_step_index + 1) % step_count;
    int brightness = s_brightness_steps[s_brightness_step_index];
    bsp_display_brightness_set(brightness);
    s_display_sleeping = (brightness == UI_BRIGHTNESS_OFF);

    const char *label = "High";
    if (s_brightness_step_index == 0) {
        label = "Off";
    } else if (s_brightness_step_index == 1) {
        label = "Low";
    } else if (s_brightness_step_index == 2) {
        label = "Medium";
    }
    ESP_LOGI(TAG, "Button PWR short (brightness: %s, %d%%)", label, brightness);
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

static lv_color_t battery_fill_color(int level, bool charging)
{
    if (charging)  return lv_color_make(0x00, 0xCC, 0xFF); /* cyan  */
    if (level >= 60) return lv_color_make(0x44, 0xBB, 0x44); /* green */
    if (level >= 20) return lv_color_make(0xFF, 0xAA, 0x00); /* amber */
    return lv_color_make(0xFF, 0x33, 0x33);                  /* red   */
}

static int battery_fill_width(int level)
{
    if (level <= 0)   return 0;
    if (level >= 100) return 20;
    return (level * 20) / 100;
}

static void battery_widgets_update(void)
{
    int  level    = bsp_get_battery_level();
    bool charging = bsp_is_charging();
    lv_color_t color = (level >= 0)
        ? battery_fill_color(level, charging)
        : lv_color_make(0x55, 0x55, 0x55);
    int fill_w = battery_fill_width(level);
    for (int i = 0; i < s_battery_fill_count; i++) {
        lv_obj_t *f = s_battery_fills[i];
        if (f && lv_obj_is_valid(f)) {
            lv_obj_set_size(f, fill_w > 0 ? fill_w : 1, 10);
            lv_obj_set_style_bg_opa(f, fill_w > 0 ? LV_OPA_COVER : LV_OPA_TRANSP, LV_PART_MAIN);
            lv_obj_set_style_bg_color(f, color, LV_PART_MAIN);
        }
    }
}

static void battery_timer_cb(lv_timer_t *timer)
{
    LV_UNUSED(timer);
    battery_widgets_update();
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
        /* Touch-first UI: keep keyboard focus functional without drawing outlines. */
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
                lv_async_call(ui_cycle_display_brightness_async, NULL);
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
    ESP_LOGI(TAG, "UI manager initialised (+/KEY=vol+, BOOT/-=vol-, PWR short=brightness cycle, hold=off)");
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

void ui_set_root_screen(lv_obj_t *scr)
{
    if (scr == NULL) {
        return;
    }

    s_top = 0;
    s_stack[0] = scr;
    lv_scr_load(scr);
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
    lv_obj_remove_style_all(hdr);
    lv_obj_set_size(hdr, lv_obj_get_width(parent), UI_HEADER_HEIGHT);
    lv_obj_align(hdr, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_clear_flag(hdr, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(hdr, UI_COLOR_BBC_RED,   LV_PART_MAIN);
    lv_obj_set_style_bg_opa(hdr, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(hdr, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(hdr, 0, LV_PART_MAIN);
    lv_obj_set_style_outline_width(hdr, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(hdr, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(hdr, 0, LV_PART_MAIN);

    lv_obj_t *lbl = lv_label_create(hdr);
    lv_label_set_text(lbl, title);
    lv_obj_set_style_text_color(lbl, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_set_style_text_font(lbl, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(lbl, LV_ALIGN_CENTER, 0, 1);

    if (show_back) {
        lv_obj_t *back_btn = lv_btn_create(hdr);
        lv_obj_set_size(back_btn, 44, 40);
        lv_obj_align(back_btn, LV_ALIGN_LEFT_MID, 0, 0);
        lv_obj_set_style_bg_opa(back_btn, LV_OPA_TRANSP, LV_PART_MAIN);
        lv_obj_set_style_bg_opa(back_btn, LV_OPA_TRANSP, LV_PART_MAIN | LV_STATE_PRESSED);
        lv_obj_set_style_bg_opa(back_btn, LV_OPA_TRANSP, LV_PART_MAIN | LV_STATE_FOCUSED);
        lv_obj_set_style_border_width(back_btn, 0, LV_PART_MAIN);
        lv_obj_set_style_shadow_width(back_btn, 0, LV_PART_MAIN);
        lv_obj_set_style_outline_width(back_btn, 0, LV_PART_MAIN);
        lv_obj_set_style_radius(back_btn, 0, LV_PART_MAIN);
        lv_obj_set_style_pad_all(back_btn, 0, LV_PART_MAIN);
        lv_obj_clear_flag(back_btn, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_ext_click_area(back_btn, 14);
        lv_obj_add_event_cb(back_btn, ui_back_clicked, LV_EVENT_CLICKED, NULL);
        ui_mark_selectable(back_btn);

        lv_obj_t *back = lv_label_create(back_btn);
        lv_label_set_text(back, LV_SYMBOL_LEFT);
        lv_obj_set_style_text_color(back, UI_COLOR_TEXT, LV_PART_MAIN);
        lv_obj_align(back, LV_ALIGN_CENTER, 0, 1);
    }

    if (s_battery_fill_count < MAX_BAT_WIDGETS) {
        /* Wrapper: 26×12 px, positioned 6 px from the right edge */
        lv_obj_t *bat_wrap = lv_obj_create(hdr);
        lv_obj_remove_style_all(bat_wrap);
        lv_obj_set_size(bat_wrap, 26, 12);
        lv_obj_align(bat_wrap, LV_ALIGN_RIGHT_MID, -6, 0);
        lv_obj_clear_flag(bat_wrap, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_style_pad_all(bat_wrap, 0, LV_PART_MAIN);

        /* Battery body outline (22×12, border=1 white, transparent bg) */
        lv_obj_t *bat_body = lv_obj_create(bat_wrap);
        lv_obj_remove_style_all(bat_body);
        lv_obj_set_pos(bat_body, 0, 0);
        lv_obj_set_size(bat_body, 22, 12);
        lv_obj_set_style_bg_opa(bat_body, LV_OPA_TRANSP, LV_PART_MAIN);
        lv_obj_set_style_border_color(bat_body, lv_color_white(), LV_PART_MAIN);
        lv_obj_set_style_border_width(bat_body, 1, LV_PART_MAIN);
        lv_obj_set_style_border_opa(bat_body, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_radius(bat_body, 2, LV_PART_MAIN);
        lv_obj_set_style_pad_all(bat_body, 0, LV_PART_MAIN);
        lv_obj_clear_flag(bat_body, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);

        /* Terminal nub (4×6, white, right of body, vertically centred) */
        lv_obj_t *bat_nub = lv_obj_create(bat_wrap);
        lv_obj_remove_style_all(bat_nub);
        lv_obj_set_pos(bat_nub, 22, 3);
        lv_obj_set_size(bat_nub, 4, 6);
        lv_obj_set_style_bg_color(bat_nub, lv_color_white(), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(bat_nub, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_radius(bat_nub, 1, LV_PART_MAIN);
        lv_obj_set_style_border_width(bat_nub, 0, LV_PART_MAIN);
        lv_obj_clear_flag(bat_nub, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);

        /* Charge fill bar inside body (max 16×8 px, colour by level) */
        lv_obj_t *bat_fill = lv_obj_create(bat_body);
        lv_obj_remove_style_all(bat_fill);
        lv_obj_set_pos(bat_fill, 0, 0);
        int  level    = bsp_get_battery_level();
        bool charging = bsp_is_charging();
        int  fill_w   = battery_fill_width(level);
        lv_color_t fill_color = (level >= 0)
            ? battery_fill_color(level, charging)
            : lv_color_make(0x55, 0x55, 0x55);
        lv_obj_set_size(bat_fill, fill_w > 0 ? fill_w : 1, 10);
        lv_obj_set_style_bg_color(bat_fill, fill_color, LV_PART_MAIN);
        lv_obj_set_style_bg_opa(bat_fill, fill_w > 0 ? LV_OPA_COVER : LV_OPA_TRANSP, LV_PART_MAIN);
        lv_obj_set_style_radius(bat_fill, 1, LV_PART_MAIN);
        lv_obj_set_style_border_width(bat_fill, 0, LV_PART_MAIN);
        lv_obj_clear_flag(bat_fill, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);

        s_battery_fills[s_battery_fill_count++] = bat_fill;
    }
}
