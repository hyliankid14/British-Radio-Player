#include "screen_now_playing.h"
#include "ui_manager.h"
#include "playback_state.h"
#include "esp_log.h"

static lv_obj_t *s_lbl_title    = NULL;
static lv_obj_t *s_lbl_subtitle = NULL;
static lv_obj_t *s_lbl_live     = NULL;
static lv_obj_t *s_btn_playpause = NULL;

static void on_playpause_clicked(lv_event_t *e)
{
    playback_state_t st = playback_get_state();
    if (st.type == PLAYBACK_STATION && st.is_playing) {
        playback_stop();
    } else {
        playback_toggle();
    }
    lv_async_call(screen_now_playing_refresh, NULL);
}

void screen_now_playing_refresh(void *arg)
{
    if (!s_lbl_title) return;

    playback_state_t st = playback_get_state();

    if (st.type == PLAYBACK_STATION && st.station) {
        lv_label_set_text(s_lbl_title,    st.station->title);
        lv_label_set_text(s_lbl_subtitle, "BBC Radio – Live");
        lv_obj_clear_flag(s_lbl_live, LV_OBJ_FLAG_HIDDEN);
    } else if (st.type == PLAYBACK_EPISODE) {
        lv_label_set_text(s_lbl_title,    st.episode_title);
        lv_label_set_text(s_lbl_subtitle, st.podcast_title);
        lv_obj_add_flag(s_lbl_live, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_label_set_text(s_lbl_title,    "Nothing playing");
        lv_label_set_text(s_lbl_subtitle, "");
        lv_obj_add_flag(s_lbl_live, LV_OBJ_FLAG_HIDDEN);
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
    lv_obj_set_style_pad_all(scr, 0, LV_PART_MAIN);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    ui_create_header(scr, "Now Playing", true);

    /* BBC-red decorative bar */
    lv_obj_t *bar = lv_obj_create(scr);
    lv_obj_set_size(bar, LV_PCT(100), 4);
    lv_obj_align(bar, LV_ALIGN_TOP_MID, 0, 36);
    lv_obj_set_style_bg_color(bar, UI_COLOR_BBC_RED, LV_PART_MAIN);
    lv_obj_set_style_border_width(bar, 0, LV_PART_MAIN);

    /* LIVE badge */
    s_lbl_live = lv_label_create(scr);
    lv_label_set_text(s_lbl_live, "  LIVE  ");
    lv_obj_set_style_bg_color(s_lbl_live, UI_COLOR_BBC_RED, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_lbl_live, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_lbl_live, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_text_font(s_lbl_live, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_radius(s_lbl_live, 4, LV_PART_MAIN);
    lv_obj_set_style_pad_all(s_lbl_live, 3, LV_PART_MAIN);
    lv_obj_align(s_lbl_live, LV_ALIGN_TOP_RIGHT, -8, 50);

    /* Station / episode title */
    s_lbl_title = lv_label_create(scr);
    lv_label_set_long_mode(s_lbl_title, LV_LABEL_LONG_SCROLL_CIRCULAR);
    lv_obj_set_width(s_lbl_title, 200);
    lv_obj_set_style_text_font(s_lbl_title, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_lbl_title, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_align(s_lbl_title, LV_ALIGN_CENTER, 0, -30);

    /* Podcast / subtitle */
    s_lbl_subtitle = lv_label_create(scr);
    lv_label_set_long_mode(s_lbl_subtitle, LV_LABEL_LONG_DOT);
    lv_obj_set_width(s_lbl_subtitle, 200);
    lv_obj_set_style_text_font(s_lbl_subtitle, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_lbl_subtitle, UI_COLOR_SUBTEXT, LV_PART_MAIN);
    lv_obj_align(s_lbl_subtitle, LV_ALIGN_CENTER, 0, 0);

    /* Play / Pause button */
    s_btn_playpause = lv_btn_create(scr);
    lv_obj_set_size(s_btn_playpause, 56, 56);
    lv_obj_set_style_bg_color(s_btn_playpause, UI_COLOR_BBC_RED, LV_PART_MAIN);
    lv_obj_set_style_radius(s_btn_playpause, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_align(s_btn_playpause, LV_ALIGN_BOTTOM_MID, 0, -24);
    ui_mark_selectable(s_btn_playpause);
    lv_obj_add_event_cb(s_btn_playpause, on_playpause_clicked, LV_EVENT_CLICKED, NULL);

    lv_obj_t *btn_lbl = lv_label_create(s_btn_playpause);
    lv_label_set_text(btn_lbl, LV_SYMBOL_PAUSE);
    lv_obj_set_style_text_color(btn_lbl, lv_color_white(), LV_PART_MAIN);
    lv_obj_center(btn_lbl);

    /* Populate from current state */
    screen_now_playing_refresh(NULL);

    return scr;
}
