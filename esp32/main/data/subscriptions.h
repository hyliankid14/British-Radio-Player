#pragma once

#include "esp_err.h"
#include "podcast_index.h"
#include <stddef.h>

/*
 * TF-card subscriptions.
 *
 * Preferred simple format: /sdcard/subscriptions.txt
 * One BBC podcast ID per line, for example:
 *   b006qnmr
 *   p02nq0lx
 * Blank lines and lines starting with # are ignored.
 */

#define SUBSCRIPTIONS_MAX  50

typedef struct {
    char id[16];
    char title[96];
    char rss_url[192];
} subscribed_podcast_t;

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Load subscriptions from the TF card.  Must be called after the card
 * is mounted.  Returns ESP_OK (with count = 0) if the file is absent.
 */
esp_err_t subscriptions_load(void);

/** Number of subscribed podcasts currently loaded. */
size_t subscriptions_count(void);

/** Return pointer to subscription i (0-based). */
const subscribed_podcast_t *subscriptions_get(size_t i);

/**
 * Return a mutable podcast view for subscription i.
 * Uses the canonical podcast index entry when available, otherwise creates
 * a lightweight podcast object from the subscription metadata.
 */
podcast_t *subscriptions_get_podcast(size_t i);

#ifdef __cplusplus
}
#endif
