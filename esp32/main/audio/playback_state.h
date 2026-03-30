#pragma once

#include "esp_err.h"
#include "data/stations.h"
#include "data/podcast_index.h"
#include <stdbool.h>

/*
 * Singleton playback state — tracks what is currently playing and
 * exposes it to all UI screens.
 */

typedef enum {
    PLAYBACK_IDLE,
    PLAYBACK_STATION,
    PLAYBACK_EPISODE,
} playback_type_t;

typedef struct {
    playback_type_t type;
    bool            is_playing;
    bool            is_live;

    /* Populated when type == PLAYBACK_STATION */
    const station_t *station;

    /* Populated when type == PLAYBACK_EPISODE */
    char    podcast_title[96];
    char    episode_title[128];
    char    audio_url[256];
    int32_t episode_duration_secs;  /* 0 if unknown */
} playback_state_t;

#ifdef __cplusplus
extern "C" {
#endif

/** Initialise playback state (call once at startup). */
void playback_state_init(void);

/** Start playing a radio station. */
esp_err_t playback_play_station(const station_t *station);

/** Start playing a podcast episode. */
esp_err_t playback_play_episode(const podcast_t *podcast, const episode_t *episode);

/** Stop playback. */
esp_err_t playback_stop(void);

/** Toggle play/pause for non-live content. */
esp_err_t playback_toggle(void);

/** Read-only view of current state (thread-safe copy). */
playback_state_t playback_get_state(void);

/** Play the next station in the list, wrapping around. */
esp_err_t playback_next_station(void);

/** Play the previous station in the list, wrapping around. */
esp_err_t playback_prev_station(void);

/** Seek forward (positive) or backward (negative) by delta_secs within the current episode. */
esp_err_t playback_seek_relative(int delta_secs);

/** Returns current episode position in seconds, or 0 if not an episode. */
int32_t playback_get_position_secs(void);

#ifdef __cplusplus
}
#endif
