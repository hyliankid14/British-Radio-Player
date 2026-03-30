#include "screen_pod_detail.h"
#include "screen_now_playing.h"
#include "ui_manager.h"
#include "playback_state.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>
#include <stdlib.h>

static const char *TAG = "screen_pod_detail";

/* Forward declaration */
static void on_episode_clicked(lv_event_t *e);

typedef struct {
    podcast_t *podcast;
    lv_obj_t  *list;
    lv_obj_t  *spinner;
} detail_ctx_t;

/* Called from podcast_fetch_episodes() background task via lv_async_call. */
static void on_episodes_ready(void *arg)
{
    detail_ctx_t *ctx = (detail_ctx_t *)arg;
    if (!ctx) return;

    if (ctx->spinner) lv_obj_add_flag(ctx->spinner, LV_OBJ_FLAG_HIDDEN);

    size_t    count;
    episode_t *eps = podcast_get_episodes(ctx->podcast, &count);
    if (!eps || count == 0) {
        lv_obj_t *lbl = lv_label_create(ctx->list);
        lv_label_set_text(lbl, "No episodes found");
        lv_obj_set_style_text_color(lbl, UI_COLOR_SUBTEXT, LV_PART_MAIN);
        free(ctx);
        return;
    }

    for (size_t i = 0; i < count; i++) {
        lv_obj_t *btn = lv_list_add_btn(ctx->list, LV_SYMBOL_PLAY, eps[i].title);
        lv_obj_set_style_bg_color(btn, UI_COLOR_CARD_BG, LV_PART_MAIN);
        lv_obj_set_style_text_color(btn, UI_COLOR_TEXT,    LV_PART_MAIN);
        ui_mark_selectable(btn);
        lv_obj_set_user_data(btn, (void *)(uintptr_t)i);
        lv_obj_add_event_cb(btn, on_episode_clicked, LV_EVENT_CLICKED, ctx->podcast);
    }
    ui_refresh_navigation();
    free(ctx);
}

static void on_episode_clicked(lv_event_t *e)
{
    lv_obj_t     *btn = lv_event_get_target(e);
    podcast_t *podcast = (podcast_t *)lv_event_get_user_data(e);
    if (!podcast) return;

    size_t    count;
    episode_t *eps = podcast_get_episodes(podcast, &count);
    if (!eps) return;

    uintptr_t idx = (uintptr_t)lv_obj_get_user_data(btn);
    if (idx >= count) return;

    esp_err_t err = playback_play_episode(podcast, &eps[idx]);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Could not play episode %s", eps[idx].title);
        return;
    }
    lv_obj_t *np = screen_now_playing_create();
    ui_push_screen(np, LV_SCR_LOAD_ANIM_MOVE_LEFT);
}

/* FreeRTOS task that fetches episodes then posts lv_async_call. */
static void fetch_task(void *arg)
{
    detail_ctx_t *ctx = (detail_ctx_t *)arg;
    esp_err_t err = podcast_fetch_episodes(ctx->podcast);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "podcast_fetch_episodes failed for %s: %s",
                 ctx->podcast->id, esp_err_to_name(err));
    } else {
        ESP_LOGI(TAG, "podcast_fetch_episodes succeeded for %s", ctx->podcast->id);
    }
    lv_async_call(on_episodes_ready, ctx);
    vTaskDelete(NULL);
}

lv_obj_t *screen_pod_detail_create(podcast_t *podcast)
{
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, UI_COLOR_DARK_BG, LV_PART_MAIN);
    lv_obj_set_style_pad_all(scr, 0, LV_PART_MAIN);

    char hdr_title[72];
    snprintf(hdr_title, sizeof(hdr_title), "%.68s", podcast->title);
    ui_create_header(scr, hdr_title, true);

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

    detail_ctx_t *ctx = malloc(sizeof(detail_ctx_t));
    if (ctx) {
        ctx->podcast = podcast;
        ctx->list    = list;
        ctx->spinner = spinner;

        if (podcast_episodes_cached(podcast)) {
            lv_async_call(on_episodes_ready, ctx);
        } else {
            xTaskCreatePinnedToCore(fetch_task, "ep_fetch", 10240, ctx, 3, NULL, 0);
        }
    }

    return scr;
}
