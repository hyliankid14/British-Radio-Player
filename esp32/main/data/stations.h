#pragma once

#include <stddef.h>

#define STATIONS_MAX  17    /* national stations + one internet test stream */

typedef struct {
    const char *id;         /* short key, e.g. "radio1" */
    const char *title;      /* display name             */
    const char *service_id; /* service identifier        */
    const char *stream_url; /* stream URL (HLS/MP3/AAC) */
    const char *logo_url;   /* station logo URL          */
} station_t;

#ifdef __cplusplus
extern "C" {
#endif

/** Return pointer to the static station array. */
const station_t *stations_get_all(void);

/** Number of entries in the station array. */
size_t stations_count(void);

#ifdef __cplusplus
}
#endif
