#include "screen_stations.h"
#include "screen_now_playing.h"
#include "ui_manager.h"
#include "stations.h"
#include "playback_state.h"
#include "esp_log.h"

static const char *TAG = "screen_stations";

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

lv_obj_t *screen_stations_create(void)
{
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_pad_all(scr, 0, LV_PART_MAIN);

    ui_create_header(scr, "BBC Radio", true);

    lv_obj_t *list = lv_list_create(scr);
    lv_obj_set_size(list, 240, 204);
    lv_obj_align(list, LV_ALIGN_TOP_MID, 0, 36);
    lv_obj_set_style_bg_color(list, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_border_width(list, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_top(list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_row(list, 2, LV_PART_MAIN);

    size_t count = stations_count();
    const station_t *stations = stations_get_all();

    for (size_t i = 0; i < count; i++) {
        lv_obj_t *btn = lv_list_add_btn(list, LV_SYMBOL_AUDIO, stations[i].title);
        lv_obj_set_style_bg_color(btn, UI_COLOR_CARD_BG, LV_PART_MAIN);
        lv_obj_set_style_text_color(btn, UI_COLOR_TEXT, LV_PART_MAIN);
        ui_mark_selectable(btn);
        lv_obj_add_event_cb(btn, on_station_clicked, LV_EVENT_CLICKED,
                             (void *)&stations[i]);
    }

    lv_obj_scroll_to_y(list, 0, LV_ANIM_OFF);

    return scr;
}
