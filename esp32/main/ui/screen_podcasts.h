#pragma once

#include "lvgl.h"

/** Create and return the podcast category screen (Popular / Subscribed / New subpages). */
lv_obj_t *screen_podcasts_create(void);

/** Called from background tasks via lv_async_call to refresh the podcast lists. */
void screen_podcasts_refresh(void *arg);
