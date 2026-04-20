#include "screen_settings.h"

#include "ui_manager.h"
#include "wifi_settings.h"
#include "wifi_portal.h"

static lv_obj_t *s_setup_btn = NULL;

static void on_screen_delete(lv_event_t *e)
{
    LV_UNUSED(e);
    s_setup_btn = NULL;
}

static void on_start_portal(lv_event_t *e)
{
    LV_UNUSED(e);
    wifi_portal_start();
}

lv_obj_t *screen_settings_create(void)
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
    lv_obj_add_event_cb(scr, on_screen_delete, LV_EVENT_DELETE, NULL);

    ui_create_header(scr, "Settings", true);

    /* ── Current network label ───────────────────────────────────── */
    char ssid[33] = {0};
    char password[65] = {0};
    wifi_settings_get_boot(ssid, sizeof(ssid), password, sizeof(password));

    lv_obj_t *net_title = lv_label_create(scr);
    lv_label_set_text(net_title, "Wi-Fi Network");
    lv_obj_set_style_text_color(net_title, UI_COLOR_SUBTEXT, LV_PART_MAIN);
    lv_obj_align(net_title, LV_ALIGN_TOP_LEFT, 10, UI_HEADER_HEIGHT + 14);

    lv_obj_t *ssid_val = lv_label_create(scr);
    lv_label_set_text(ssid_val, ssid[0] ? ssid : "Not configured");
    lv_obj_set_style_text_color(ssid_val, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_set_style_text_font(ssid_val, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_width(ssid_val, 220);
    lv_label_set_long_mode(ssid_val, LV_LABEL_LONG_DOT);
    lv_obj_align(ssid_val, LV_ALIGN_TOP_LEFT, 10, UI_HEADER_HEIGHT + 32);

    /* ── "Change Wi-Fi" button ───────────────────────────────────── */
    s_setup_btn = lv_btn_create(scr);
    lv_obj_remove_style_all(s_setup_btn);
    lv_obj_set_size(s_setup_btn, 220, 48);
    lv_obj_align(s_setup_btn, LV_ALIGN_TOP_LEFT, 10, UI_HEADER_HEIGHT + 66);
    lv_obj_set_style_bg_color(s_setup_btn, lv_color_hex(0xCC0000), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_setup_btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(s_setup_btn, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(s_setup_btn, 0, LV_PART_MAIN);
    lv_obj_set_style_outline_width(s_setup_btn, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(s_setup_btn, 10, LV_PART_MAIN);
    lv_obj_set_style_pad_all(s_setup_btn, 0, LV_PART_MAIN);
    lv_obj_clear_flag(s_setup_btn, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(s_setup_btn, on_start_portal, LV_EVENT_CLICKED, NULL);
    ui_mark_selectable(s_setup_btn);

    lv_obj_t *btn_lbl = lv_label_create(s_setup_btn);
    lv_label_set_text(btn_lbl, "Change Wi-Fi");
    lv_obj_set_style_text_color(btn_lbl, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_set_style_text_font(btn_lbl, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_center(btn_lbl);

    return scr;
}
