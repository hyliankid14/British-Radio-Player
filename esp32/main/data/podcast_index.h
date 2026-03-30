#pragma once

#include "esp_err.h"
#include <stddef.h>
#include <stdbool.h>

/*
 * Podcast data model.
 *
 * Fetched from the BBC OPML feed:
 *   https://www.bbc.co.uk/radio/opml/bbc_podcast_opml.xml
 *
 * Popularity / "new" flags come from GCS JSON files maintained by the
 * existing api/analytics_server.py pipeline.
 */

#define PODCAST_TITLE_MAX   96
#define PODCAST_ID_MAX      16
#define PODCAST_URL_MAX    192

typedef struct {
    char id[PODCAST_ID_MAX];       /* BBC pid extracted from RSS URL  */
    char title[PODCAST_TITLE_MAX];
    char rss_url[PODCAST_URL_MAX];
    int  popularity_rank;          /* 0 = unknown, 1 = most popular   */
    bool is_new;
    int  new_rank;                 /* 0 = not in newest set, 1 = newest */
    /* Episode cache (populated lazily by podcast_fetch_episodes) */
    void  *_episodes;             /* episode_t*, or NULL if not yet fetched */
    size_t _episode_count;
} podcast_t;

#define EPISODE_TITLE_MAX  128
#define EPISODE_URL_MAX    256

typedef struct {
    char   podcast_id[PODCAST_ID_MAX];
    char   title[EPISODE_TITLE_MAX];
    char   audio_url[EPISODE_URL_MAX];
    char   pub_date[24];           /* "2026-03-28" */
    int    duration_secs;
} episode_t;

/* ── Indices returned to the caller: no heap allocation needed ────── */

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Fetch and parse the BBC OPML feed, then apply popularity / new-flag
 * rankings from GCS.  Runs on demand from a background task.
 *
 * Must be called from a task with sufficient stack (≥ 8 KB).
 * Returns ESP_OK when the podcast list is ready.
 */
esp_err_t podcast_index_fetch(void);

/** Total number of podcasts loaded. */
size_t podcast_index_count(void);

/** Returns true once the podcast list has been loaded. */
bool podcast_index_ready(void);
#define podcast_index_is_ready() podcast_index_ready()

/** Return a pointer to podcast i (0-based). */
podcast_t *podcast_index_get(size_t i);

/** Return the full mutable array and write its count to *count_out. */
podcast_t *podcast_index_get_all(size_t *count_out);

/** Return a random podcast, or NULL if none are loaded. */
podcast_t *podcast_index_random(void);

/**
 * Download and cache episodes for @p podcast (blocking HTTP + RSS parse).
 * Safe to call again; subsequent calls return immediately if already cached.
 */
esp_err_t  podcast_fetch_episodes(podcast_t *podcast);

/**
 * Return the cached episode list for @p podcast.
 * Returns NULL and sets *count_out = 0 if not yet fetched.
 * The pointer is owned by the podcast_t; do not free it.
 */
episode_t *podcast_get_episodes(podcast_t *podcast, size_t *count_out);

/** True if episodes have already been downloaded for @p podcast. */
bool podcast_episodes_cached(const podcast_t *podcast);

#ifdef __cplusplus
}
#endif
