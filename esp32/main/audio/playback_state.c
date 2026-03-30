#include "playback_state.h"
#include "bbc_audio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <string.h>

static const char *TAG = "playback_state";

static playback_state_t s_state;
static SemaphoreHandle_t s_mutex;

/* Episode position tracking — all access under s_mutex */
static int32_t s_episode_offset_secs = 0;  /* position (secs) at last start/resume */
static int64_t s_episode_start_us    = 0;  /* wall-clock (µs) at last start/resume  */
static bool    s_episode_is_paused   = false;

void playback_state_init(void)
{
    memset(&s_state, 0, sizeof(s_state));
    s_state.type = PLAYBACK_IDLE;
    s_mutex = xSemaphoreCreateMutex();
}

esp_err_t playback_play_station(const station_t *station)
{
    esp_err_t ret = bbc_audio_play_url(station->stream_url, /*is_live=*/true);
    if (ret != ESP_OK) return ret;

    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_state.type       = PLAYBACK_STATION;
    s_state.is_playing = true;
    s_state.is_live    = true;
    s_state.station    = station;
    xSemaphoreGive(s_mutex);

    ESP_LOGI(TAG, "Playing station: %s", station->title);
    return ESP_OK;
}

esp_err_t playback_play_episode(const podcast_t *podcast, const episode_t *episode)
{
    esp_err_t ret = bbc_audio_play_url(episode->audio_url, /*is_live=*/false);
    if (ret != ESP_OK) return ret;

    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_state.type                  = PLAYBACK_EPISODE;
    s_state.is_playing            = true;
    s_state.is_live               = false;
    s_state.station               = NULL;
    s_state.episode_duration_secs = episode->duration_secs;
    strncpy(s_state.podcast_title, podcast->title,    sizeof(s_state.podcast_title) - 1);
    strncpy(s_state.episode_title, episode->title,    sizeof(s_state.episode_title) - 1);
    strncpy(s_state.audio_url,     episode->audio_url, sizeof(s_state.audio_url) - 1);
    s_episode_offset_secs = 0;
    s_episode_start_us    = esp_timer_get_time();
    s_episode_is_paused   = false;
    xSemaphoreGive(s_mutex);

    ESP_LOGI(TAG, "Playing episode: %s — %s", podcast->title, episode->title);
    return ESP_OK;
}

esp_err_t playback_stop(void)
{
    bbc_audio_stop();
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_state.type          = PLAYBACK_IDLE;
    s_state.is_playing    = false;
    s_episode_offset_secs = 0;
    s_episode_start_us    = 0;
    s_episode_is_paused   = false;
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t playback_toggle(void)
{
    bbc_audio_toggle();
    bool now_playing = bbc_audio_is_playing();
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_state.is_playing = now_playing;
    if (s_state.type == PLAYBACK_EPISODE) {
        int64_t now_us = esp_timer_get_time();
        if (!now_playing) {
            /* Just paused: capture elapsed time into offset */
            s_episode_offset_secs += (int32_t)((now_us - s_episode_start_us) / 1000000LL);
            s_episode_is_paused    = true;
        } else {
            /* Just resumed: restart the clock from current offset */
            s_episode_start_us  = now_us;
            s_episode_is_paused = false;
        }
    }
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

playback_state_t playback_get_state(void)
{
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    playback_state_t copy = s_state;
    xSemaphoreGive(s_mutex);
    return copy;
}

int32_t playback_get_position_secs(void)
{
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    int32_t pos = 0;
    if (s_state.type == PLAYBACK_EPISODE && s_episode_start_us != 0) {
        if (s_episode_is_paused) {
            pos = s_episode_offset_secs;
        } else {
            pos = s_episode_offset_secs +
                  (int32_t)((esp_timer_get_time() - s_episode_start_us) / 1000000LL);
        }
    }
    xSemaphoreGive(s_mutex);
    return pos;
}

esp_err_t playback_seek_relative(int delta_secs)
{
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    if (s_state.type != PLAYBACK_EPISODE) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_STATE;
    }
    int64_t now_us = esp_timer_get_time();
    int32_t pos    = s_episode_is_paused
                     ? s_episode_offset_secs
                     : s_episode_offset_secs + (int32_t)((now_us - s_episode_start_us) / 1000000LL);
    pos += delta_secs;
    if (pos < 0) pos = 0;
    if (s_state.episode_duration_secs > 0 && pos > s_state.episode_duration_secs)
        pos = s_state.episode_duration_secs;
    s_episode_offset_secs = pos;
    s_episode_start_us    = now_us;
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

static int find_station_index(const station_t *station)
{
    const station_t *all = stations_get_all();
    size_t count = stations_count();
    for (size_t i = 0; i < count; i++) {
        if (&all[i] == station) return (int)i;
    }
    return 0;
}

esp_err_t playback_next_station(void)
{
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    if (s_state.type != PLAYBACK_STATION || !s_state.station) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_STATE;
    }
    int    idx   = find_station_index(s_state.station);
    size_t count = stations_count();
    xSemaphoreGive(s_mutex);
    return playback_play_station(&stations_get_all()[(idx + 1) % count]);
}

esp_err_t playback_prev_station(void)
{
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    if (s_state.type != PLAYBACK_STATION || !s_state.station) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_STATE;
    }
    int    idx   = find_station_index(s_state.station);
    size_t count = stations_count();
    xSemaphoreGive(s_mutex);
    size_t prev_idx = (idx == 0) ? (count - 1) : (size_t)(idx - 1);
    return playback_play_station(&stations_get_all()[prev_idx]);
}
