#include "screen_now_playing.h"
#include "ui_manager.h"
#include "playback_state.h"
#include "esp_log.h"
#include <stdio.h>

static lv_obj_t   *s_lbl_title     = NULL;
static lv_obj_t   *s_lbl_subtitle  = NULL;
static lv_obj_t   *s_lbl_live      = NULL;
static lv_obj_t   *s_btn_playpause = NULL;
static lv_obj_t   *s_btn_prev      = NULL;
static lv_obj_t   *s_btn_next      = NULL;
static lv_obj_t   *s_bar_progress  = NULL;
static lv_obj_t   *s_lbl_elapsed   = NULL;
static lv_obj_t   *s_lbl_remaining = NULL;
static lv_timer_t *s_timer         = NULL;

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

static void on_prev_clicked(lv_event_t *e)
{
    playback_state_t st = playback_get_state();
    if (st.type == PLAYBACK_STATION) {
        playback_prev_station();
    } else if (st.type == PLAYBACK_EPISODE) {
        playback_seek_relative(-10);
    }
    lv_async_call(screen_now_playing_refresh, NULL);
}

static void on_next_clicked(lv_event_t *e)
{
    playback_state_t st = playback_get_state();
    if (st.type == PLAYBACK_STATION) {
        playback_next_station();
    } else if (st.type == PLAYBACK_EPISODE) {
        playback_seek_relative(30);
    }
    lv_async_call(screen_now_playing_refresh, NULL);
}

static void on_screen_delete(lv_event_t *e)
{
    s_lbl_title     = NULL;
    s_lbl_subtitle  = NULL;
    s_lbl_live      = NULL;
    s_btn_playpause = NULL;
    s_btn_prev      = NULL;
    s_btn_next      = NULL;
    s_bar_progress  = NULL;
    s_lbl_elapsed   = NULL;
    s_lbl_remaining = NULL;
    if (s_timer) { lv_timer_del(s_timer); s_timer = NULL; }
}

static void on_progress_timer(lv_timer_t *t)
{
    (void)t;
    lv_async_call(screen_now_playing_refresh, NULL);
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
        lv_label_set_text(s_lbl_title,    st.station->title);
        lv_label_set_text(s_lbl_subtitle, "BBC Radio \xe2\x80\x93 Live");
        lv_obj_clear_flag(s_lbl_live, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(s_bar_progress,  LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(s_lbl_elapsed,   LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(s_lbl_remaining, LV_OBJ_FLAG_HIDDEN);
    } else if (st.type == PLAYBACK_EPISODE) {
        lv_label_set_text(s_lbl_title,    st.episode_title);
        lv_label_set_text(s_lbl_subtitle, st.podcast_title);
        lv_obj_add_flag(s_lbl_live, LV_OBJ_FLAG_HIDDEN);
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
        lv_label_set_text(s_lbl_title,    "Nothing playing");
        lv_label_set_text(s_lbl_subtitle, "");
        lv_obj_add_flag(s_lbl_live, LV_OBJ_FLAG_HIDDEN);
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
    lv_obj_set_style_pad_all(scr, 0, LV_PART_MAIN);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_add_event_cb(scr, on_screen_delete, LV_EVENT_DELETE, NULL);

    ui_create_header(scr, "Now Playing", true);

    /* BBC-red decorative bar */
    lv_obj_t *deco_bar = lv_obj_create(scr);
    lv_obj_set_size(deco_bar, LV_PCT(100), 4);
    lv_obj_align(deco_bar, LV_ALIGN_TOP_MID, 0, UI_HEADER_HEIGHT);
    lv_obj_set_style_bg_color(deco_bar, UI_COLOR_BBC_RED, LV_PART_MAIN);
    lv_obj_set_style_border_width(deco_bar, 0, LV_PART_MAIN);

    /* LIVE badge */
    s_lbl_live = lv_label_create(scr);
    lv_label_set_text(s_lbl_live, "  LIVE  ");
    lv_obj_set_style_bg_color(s_lbl_live, UI_COLOR_BBC_RED, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_lbl_live, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_lbl_live, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_text_font(s_lbl_live, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_radius(s_lbl_live, 4, LV_PART_MAIN);
    lv_obj_set_style_pad_all(s_lbl_live, 3, LV_PART_MAIN);
    lv_obj_align(s_lbl_live, LV_ALIGN_TOP_RIGHT, -8, UI_HEADER_HEIGHT + 14);

    /* Station / episode title */
    s_lbl_title = lv_label_create(scr);
    lv_label_set_long_mode(s_lbl_title, LV_LABEL_LONG_SCROLL_CIRCULAR);
    lv_obj_set_width(s_lbl_title, 200);
    lv_obj_set_style_text_font(s_lbl_title, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_lbl_title, UI_COLOR_TEXT, LV_PART_MAIN);
    lv_obj_align(s_lbl_title, LV_ALIGN_CENTER, 0, -50);

    /* Podcast / subtitle */
    s_lbl_subtitle = lv_label_create(scr);
    lv_label_set_long_mode(s_lbl_subtitle, LV_LABEL_LONG_DOT);
    lv_obj_set_width(s_lbl_subtitle, 200);
    lv_obj_set_style_text_font(s_lbl_subtitle, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_lbl_subtitle, UI_COLOR_SUBTEXT, LV_PART_MAIN);
    lv_obj_align(s_lbl_subtitle, LV_ALIGN_CENTER, 0, -30);

    /* Progress bar (episode mode only, hidden for live radio) */
    s_bar_progress = lv_bar_create(scr);
    lv_obj_set_size(s_bar_progress, 190, 6);
    lv_obj_align(s_bar_progress, LV_ALIGN_CENTER, 0, -8);
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
    lv_obj_align(s_lbl_elapsed, LV_ALIGN_CENTER, -70, 8);
    lv_obj_add_flag(s_lbl_elapsed, LV_OBJ_FLAG_HIDDEN);

    /* Remaining time label (right of bar) */
    s_lbl_remaining = lv_label_create(scr);
    lv_label_set_text(s_lbl_remaining, "");
    lv_obj_set_style_text_color(s_lbl_remaining, UI_COLOR_SUBTEXT, LV_PART_MAIN);
    lv_obj_set_style_text_font(s_lbl_remaining, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(s_lbl_remaining, LV_ALIGN_CENTER, 70, 8);
    lv_obj_add_flag(s_lbl_remaining, LV_OBJ_FLAG_HIDDEN);

    /* Previous button */
    s_btn_prev = lv_btn_create(scr);
    lv_obj_set_size(s_btn_prev, 40, 40);
    lv_obj_set_style_bg_color(s_btn_prev, UI_COLOR_CARD_BG, LV_PART_MAIN);
    lv_obj_set_style_radius(s_btn_prev, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_align(s_btn_prev, LV_ALIGN_BOTTOM_MID, -62, -16);
    ui_mark_selectable(s_btn_prev);
    lv_obj_add_event_cb(s_btn_prev, on_prev_clicked, LV_EVENT_CLICKED, NULL);
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
    ui_mark_selectable(s_btn_next);
    lv_obj_add_event_cb(s_btn_next, on_next_clicked, LV_EVENT_CLICKED, NULL);
    lv_obj_t *next_lbl = lv_label_create(s_btn_next);
    lv_label_set_text(next_lbl, LV_SYMBOL_NEXT);
    lv_obj_set_style_text_color(next_lbl, lv_color_white(), LV_PART_MAIN);
    lv_obj_center(next_lbl);

    /* 1-second timer to keep progress bar live */
    s_timer = lv_timer_create(on_progress_timer, 1000, NULL);

    /* Populate from current state */
    screen_now_playing_refresh(NULL);

    return scr;
}
