#include "screen_home.h"
#include "screen_settings.h"
#include "screen_stations.h"
#include "ui_manager.h"

static void open_radio(lv_event_t *e)
{
    LV_UNUSED(e);
    lv_obj_t *scr = screen_stations_create();
    ui_push_screen(scr, LV_SCR_LOAD_ANIM_MOVE_LEFT);
}

static void open_settings(lv_event_t *e)
{
    LV_UNUSED(e);
    lv_obj_t *scr = screen_settings_create();
    ui_push_screen(scr, LV_SCR_LOAD_ANIM_MOVE_LEFT);
}

static lv_obj_t *screen_podcasts_placeholder_create(void)
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
    return scr;
}

static void open_podcasts(lv_event_t *e)
{
    LV_UNUSED(e);
    lv_obj_t *scr = screen_podcasts_placeholder_create();
    ui_push_screen(scr, LV_SCR_LOAD_ANIM_MOVE_LEFT);
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
    /* Use LVGL built-in symbol font (no large Montserrat needed) */
    lv_obj_set_style_text_color(ico, lv_color_white(), LV_PART_MAIN);
    lv_obj_align(ico, LV_ALIGN_CENTER, 0, -10);

    lv_obj_t *lbl = lv_label_create(card);
    lv_label_set_text(lbl, label);
    lv_obj_set_style_text_color(lbl, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_text_font(lbl, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(lbl, LV_ALIGN_BOTTOM_MID, 0, 0);

    return card;
}

lv_obj_t *screen_home_create(void)
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

    ui_create_header(scr, "BBC Radio Player", false);

    lv_obj_t *settings_btn = lv_btn_create(scr);
    lv_obj_remove_style_all(settings_btn);
    lv_obj_set_size(settings_btn, 44, UI_HEADER_HEIGHT);
    lv_obj_align(settings_btn, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_set_style_bg_opa(settings_btn, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(settings_btn, LV_OPA_TRANSP, LV_PART_MAIN | LV_STATE_PRESSED);
    lv_obj_set_style_border_width(settings_btn, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(settings_btn, 0, LV_PART_MAIN);
    lv_obj_set_style_outline_width(settings_btn, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(settings_btn, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(settings_btn, 0, LV_PART_MAIN);
    lv_obj_clear_flag(settings_btn, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_ext_click_area(settings_btn, 14);
    ui_mark_selectable(settings_btn);
    lv_obj_add_event_cb(settings_btn, open_settings, LV_EVENT_CLICKED, NULL);

    lv_obj_t *settings_icon = lv_label_create(settings_btn);
    lv_label_set_text(settings_icon, LV_SYMBOL_SETTINGS);
    lv_obj_set_style_text_color(settings_icon, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_align(settings_icon, LV_ALIGN_CENTER, 0, 1);

    /* Two tiles side by side */
    lv_obj_t *row = lv_obj_create(scr);
    lv_obj_remove_style_all(row);
    lv_obj_set_size(row, LV_PCT(100), LV_SIZE_CONTENT);
    lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_width(row, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(row, 0, LV_PART_MAIN);
    lv_obj_set_style_outline_width(row, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(row, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(row, 0, LV_PART_MAIN);
    lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(row, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(row, 8, LV_PART_MAIN);  /* LVGL v8 gap API */
    lv_obj_align(row, LV_ALIGN_CENTER, 0, 26);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);

    make_tile(row, LV_SYMBOL_AUDIO,    "Radio",    UI_COLOR_BBC_RED,              open_radio);
    make_tile(row, LV_SYMBOL_LIST,     "Podcasts", lv_color_make(0x1A, 0x73, 0xE8), open_podcasts);

    return scr;
}
