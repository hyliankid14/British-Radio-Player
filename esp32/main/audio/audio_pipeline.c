#include "bbc_audio.h"
#include "bsp_codec.h"
#include "driver/gpio.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_crt_bundle.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <ctype.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#if BBC_HAS_ADF
#include "esp_http_client.h"
#include "freertos/ringbuf.h"
#endif
#if BBC_HAS_ADF
#include "esp_audio_simple_dec.h"
#include "impl/esp_ts_dec.h"
#include "impl/esp_aac_dec.h"
#include "impl/esp_mp3_dec.h"
#endif

static const char *TAG = "audio_pipeline";

static volatile bool s_playing = false;
static volatile bool s_is_live = false;
static char s_current_url[256];
static TaskHandle_t s_hw_tone_task = NULL;
static volatile uint32_t s_hw_tone_freq = 0;
static bool s_use_adf = false;

#ifdef BBC_FORCE_TONE_PLAYBACK
#undef BBC_FORCE_TONE_PLAYBACK
#endif
#define BBC_FORCE_TONE_PLAYBACK 0

#define AUDIO_TONE_FRAME_SAMPLES 256
#define AUDIO_TONE_AMPLITUDE     10000
#define HTTP_CHUNK_BYTES         8192
#define HTTP_HEADER_BYTES        65536
#define HTTP_HEADER_TX_BYTES     8192
#define HTTP_URL_BYTES           4096
#define PLAYLIST_BUF_BYTES       4096
#define PCM_BUF_BYTES            16384
#define PENDING_BUF_BYTES        196608
#define PENDING_BUF_BYTES_FALLBACK 32768
/* 512 KiB PCM ring buffer in PSRAM — ~2.67 s at 48 kHz stereo 16-bit.
 * Bridges the ~300 ms gap between HLS segments (playlist fetch + HTTP connect). */
#define PCM_RING_BUF_BYTES       (512UL * 1024UL)

#if BBC_HAS_ADF
typedef struct {
    TaskHandle_t pcm_task;
    int64_t last_seq;
    uint32_t task_gen_id;
} adf_state_t;

static adf_state_t s_adf = {0};

/* PCM ring buffer — decoder writes here, codec_drainer_task reads to I2S. */
static RingbufHandle_t   s_pcm_ringbuf        = NULL;
static TaskHandle_t      s_codec_drainer_task = NULL;
static volatile bool     s_drainer_active     = false;

static void *alloc_pref_psram(size_t size)
{
    void *p = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!p) {
        p = malloc(size);
    }
    return p;
}

static bool url_is_absolute(const char *url)
{
    return url && (strncmp(url, "http://", 7) == 0 || strncmp(url, "https://", 8) == 0);
}

static void make_absolute_url(const char *base_url, const char *ref, char *out, size_t out_len)
{
    if (!out || out_len == 0) {
        return;
    }
    out[0] = '\0';
    if (!ref || ref[0] == '\0') {
        return;
    }
    if (url_is_absolute(ref)) {
        strlcpy(out, ref, out_len);
        return;
    }

    /* Handle root-relative references: "/path/file.ts" */
    if (base_url && ref[0] == '/') {
        const char *scheme = strstr(base_url, "://");
        if (scheme) {
            const char *host_start = scheme + 3;
            const char *host_end = strchr(host_start, '/');
            size_t origin_len = host_end ? (size_t)(host_end - base_url) : strlen(base_url);
            if (origin_len >= out_len) {
                origin_len = out_len - 1;
            }
            memcpy(out, base_url, origin_len);
            out[origin_len] = '\0';
            strlcat(out, ref, out_len);
            return;
        }
    }

    const char *slash = base_url ? strrchr(base_url, '/') : NULL;
    if (!slash) {
        strlcpy(out, ref, out_len);
        return;
    }

    size_t base_len = (size_t)(slash - base_url + 1);
    if (base_len >= out_len) {
        base_len = out_len - 1;
    }
    memcpy(out, base_url, base_len);
    out[base_len] = '\0';
    strlcat(out, ref, out_len);
}

typedef struct {
    char   *buf;
    size_t  buf_len;
    size_t  total;
} http_text_ctx_t;

static bool http_read_text(const char *url, char *buf, size_t buf_len)
{
    static esp_http_client_handle_t s_playlist_client = NULL;
    if (!url || !buf || buf_len < 16) {
        return false;
    }

    if (!s_playlist_client) {
        esp_http_client_config_t cfg = {
            .url = url,
            .method = HTTP_METHOD_GET,
            .timeout_ms = 5000,
            .crt_bundle_attach = esp_crt_bundle_attach,
            .buffer_size = HTTP_CHUNK_BYTES,
            .max_redirection_count = 5,
            .keep_alive_enable = true,
        };
        s_playlist_client = esp_http_client_init(&cfg);
        if (!s_playlist_client) {
            ESP_LOGE(TAG, "Playlist client init failed");
            return false;
        }
    }

    http_text_ctx_t ctx = { .buf = buf, .buf_len = buf_len, .total = 0 };
    buf[0] = '\0';
    /* Ensure m3u8 text is returned uncompressed for line parser simplicity. */
    esp_http_client_set_url(s_playlist_client, url);
    esp_http_client_set_method(s_playlist_client, HTTP_METHOD_GET);
    esp_http_client_set_header(s_playlist_client, "Accept-Encoding", "identity");
    esp_http_client_set_header(s_playlist_client, "User-Agent", "BBC-Radio-Player/esp32");

    esp_err_t err = esp_http_client_open(s_playlist_client, 0);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Playlist open err=%d", (int)err);
        esp_http_client_cleanup(s_playlist_client);
        s_playlist_client = NULL;
        return false;
    }

    if (esp_http_client_fetch_headers(s_playlist_client) < 0) {
        ESP_LOGW(TAG, "Playlist fetch headers failed");
        esp_http_client_close(s_playlist_client);
        esp_http_client_cleanup(s_playlist_client);
        s_playlist_client = NULL;
        return false;
    }

    while (ctx.total + 1 < ctx.buf_len) {
        int n = esp_http_client_read(s_playlist_client, ctx.buf + ctx.total,
                                     (int)(ctx.buf_len - ctx.total - 1));
        if (n <= 0) {
            break;
        }
        ctx.total += (size_t)n;
    }

    int status = esp_http_client_get_status_code(s_playlist_client);
    esp_http_client_close(s_playlist_client);
    buf[ctx.total] = '\0';

    if (status < 200 || status >= 300) {
        ESP_LOGW(TAG, "Playlist HTTP status=%d", status);
        esp_http_client_cleanup(s_playlist_client);
        s_playlist_client = NULL;
        return false;
    }
    if (ctx.total < 8 || strstr(buf, "#EXTM3U") == NULL) {
        ESP_LOGW(TAG, "Playlist text invalid (%u bytes): %.64s", (unsigned)ctx.total, buf);
        esp_http_client_cleanup(s_playlist_client);
        s_playlist_client = NULL;
        return false;
    }
    return ctx.total > 0;
}

static int parse_media_sequence(const char *playlist)
{
    const char *p = strstr(playlist, "#EXT-X-MEDIA-SEQUENCE:");
    if (!p) {
        return 0;
    }
    p += strlen("#EXT-X-MEDIA-SEQUENCE:");
    return atoi(p);
}

static int parse_playlist_entries(const char *playlist, char entries[][256], int max_entries)
{
    int count = 0;
    const char *p = playlist;
    bool expect_uri = false;
    while (p && *p && count < max_entries) {
        const char *line_end = strchr(p, '\n');
        size_t len = line_end ? (size_t)(line_end - p) : strlen(p);

        while (len > 0 && (p[len - 1] == '\r' || p[len - 1] == '\n')) {
            len--;
        }

        const char *line = p;
        while (len > 0 && isspace((unsigned char)*line)) {
            line++;
            len--;
        }

        bool is_comment = (len > 0 && line[0] == '#');
        if (is_comment) {
            if (strncmp(line, "#EXTINF", 7) == 0 || strncmp(line, "#EXT-X-STREAM-INF", 17) == 0) {
                expect_uri = true;
            }
        }

        if (len > 0 && !is_comment && (expect_uri || strstr(line, ".ts") || strstr(line, ".m3u8") || strstr(line, ".aac"))) {
            size_t copy_len = len < 255 ? len : 255;
            memcpy(entries[count], line, copy_len);
            entries[count][copy_len] = '\0';
            count++;
            expect_uri = false;
        }

        if (!line_end) {
            break;
        }
        p = line_end + 1;
    }
    return count;
}

static char s_redirect_location[HTTP_URL_BYTES];
static esp_err_t segment_http_event_handler(esp_http_client_event_t *evt)
{
    if (evt->event_id == HTTP_EVENT_ON_HEADER &&
        evt->header_key && evt->header_value &&
        strcasecmp(evt->header_key, "Location") == 0) {
        strlcpy(s_redirect_location, evt->header_value, sizeof(s_redirect_location));
    }
    return ESP_OK;
}

static size_t decode_pending_bytes(esp_audio_simple_dec_handle_t dec,
                                   uint8_t *pending,
                                   size_t *pending_len,
                                   bool eos,
                                   uint8_t **pcm_buf,
                                   uint32_t *pcm_size,
                                   bool *sample_info_logged,
                                   size_t *bytes_written_out)
{
    size_t decoded_total = 0;
    size_t written_total = 0;
    static int s_decode_error_logs = 0;
    esp_audio_simple_dec_raw_t raw = {
        .buffer = pending,
        .len = (uint32_t)*pending_len,
        .eos = eos,
        .consumed = 0,
    };

    while (raw.len) {
        esp_audio_simple_dec_out_t out = {
            .buffer = *pcm_buf,
            .len = *pcm_size,
            .decoded_size = 0,
            .needed_size = 0,
        };

        esp_audio_err_t ret = esp_audio_simple_dec_process(dec, &raw, &out);
        if (ret == ESP_AUDIO_ERR_BUFF_NOT_ENOUGH) {
            uint32_t need = out.needed_size ? out.needed_size : (*pcm_size * 2);
            uint8_t *new_buf = realloc(*pcm_buf, need);
            if (!new_buf) {
                break;
            }
            *pcm_buf = new_buf;
            *pcm_size = need;
            continue;
        }
        if (ret != ESP_AUDIO_ERR_OK) {
            if (s_decode_error_logs < 12) {
                ESP_LOGW(TAG, "Decoder process ret=%d len=%"PRIu32" consumed=%"PRIu32,
                         (int)ret, raw.len, raw.consumed);
                s_decode_error_logs++;
            }
            break;
        }

        if (!*sample_info_logged && out.decoded_size > 0) {
            esp_audio_simple_dec_info_t info = {0};
            if (esp_audio_simple_dec_get_info(dec, &info) == ESP_AUDIO_ERR_OK) {
                int bits = info.bits_per_sample ? info.bits_per_sample : 16;
                bsp_codec_set_sample_info((int)info.sample_rate, info.channel, bits);
                ESP_LOGI(TAG, "Decoded stream: %"PRIu32" Hz, %d ch, %d bit",
                         info.sample_rate, info.channel, bits);
                *sample_info_logged = true;
            }
        }
        if (out.decoded_size > 0) {
            decoded_total += out.decoded_size;
            if (s_pcm_ringbuf) {
                /* Write PCM to ring buffer in 4 KiB slices so the stream task
                 * can observe s_playing=false within ~20 ms on stop. */
                const uint8_t *ptr  = *pcm_buf;
                size_t         left = out.decoded_size;
                while (left > 0) {
                    size_t chunk = left < 4096u ? left : 4096u;
                    BaseType_t sent = pdFALSE;
                    for (int retry = 0; retry < 6 && s_playing && s_use_adf; retry++) {
                        sent = xRingbufferSend(s_pcm_ringbuf, ptr, chunk, pdMS_TO_TICKS(60));
                        if (sent == pdTRUE) {
                            break;
                        }
                    }
                    if (sent != pdTRUE) {
                        ESP_LOGW(TAG, "PCM ring buffer congested; dropping %u bytes", (unsigned)chunk);
                    }
                    ptr  += chunk;
                    left -= chunk;
                }
            } else {
                size_t written = 0;
                bsp_codec_write(*pcm_buf, out.decoded_size, &written);
            }
            written_total += out.decoded_size;
        }
        if (raw.consumed == 0 && out.decoded_size == 0) {
            break;
        }
        if (raw.consumed > raw.len) {
            raw.len = 0;
        } else {
            raw.len -= raw.consumed;
            raw.buffer += raw.consumed;
        }
    }

    if (raw.len && raw.buffer != pending) {
        memmove(pending, raw.buffer, raw.len);
    }
    *pending_len = raw.len;
    if (bytes_written_out) {
        *bytes_written_out += written_total;
    }
    return decoded_total;
}

static size_t stream_segment_encoded(const char *segment_url,
                                   esp_audio_simple_dec_handle_t dec,
                                   uint8_t *chunk_buf,
                                   uint8_t **pcm_buf,
                                   uint32_t *pcm_size,
                                   bool *sample_info_logged,
                                   uint8_t *pending,
                                   size_t pending_cap,
                                   size_t *pending_len_io,
                                   bool flush_eos)
{
    static esp_http_client_handle_t s_segment_client = NULL;
    char current_url[HTTP_URL_BYTES];
    strlcpy(current_url, segment_url, sizeof(current_url));
    int seg_status = 0;

    for (int hop = 0; hop < 8; hop++) {
        if (s_segment_client) {
            esp_http_client_cleanup(s_segment_client);
            s_segment_client = NULL;
        }
        s_redirect_location[0] = '\0';

        esp_http_client_config_t cfg = {
            .url               = current_url,
            .method            = HTTP_METHOD_GET,
            .timeout_ms        = 30000,
            .crt_bundle_attach = esp_crt_bundle_attach,
            .buffer_size       = HTTP_HEADER_BYTES,
            .buffer_size_tx    = HTTP_HEADER_TX_BYTES,
            .keep_alive_enable = false,
            .event_handler     = segment_http_event_handler,
        };
        s_segment_client = esp_http_client_init(&cfg);
        if (!s_segment_client) {
            ESP_LOGW(TAG, "Segment client init failed hop=%d: %.96s", hop, current_url);
            return 0;
        }
        esp_http_client_set_header(s_segment_client, "User-Agent", "BBC-Radio-Player/esp32");
        esp_http_client_set_header(s_segment_client, "Accept-Encoding", "identity");

        if (esp_http_client_open(s_segment_client, 0) != ESP_OK) {
            ESP_LOGW(TAG, "Segment open failed hop=%d: %.96s", hop, current_url);
            esp_http_client_cleanup(s_segment_client);
            s_segment_client = NULL;
            return 0;
        }
        if (esp_http_client_fetch_headers(s_segment_client) < 0) {
            ESP_LOGW(TAG, "Segment fetch_headers failed hop=%d: %.80s", hop, current_url);
            esp_http_client_close(s_segment_client);
            esp_http_client_cleanup(s_segment_client);
            s_segment_client = NULL;
            return 0;
        }

        seg_status = esp_http_client_get_status_code(s_segment_client);
        if (seg_status >= 200 && seg_status < 300) {
            ESP_LOGI(TAG, "Segment connected hop=%d status=%d: %.96s", hop, seg_status, current_url);
            break;
        }

        if (seg_status >= 300 && seg_status < 400 && s_redirect_location[0] != '\0') {
            ESP_LOGI(TAG, "Redirect hop=%d status=%d -> %.120s", hop, seg_status, s_redirect_location);
            esp_http_client_close(s_segment_client);
            strlcpy(current_url, s_redirect_location, sizeof(current_url));
            continue;
        }

        ESP_LOGW(TAG, "Segment HTTP status %d hop=%d loc=%s url=%.80s",
                 seg_status, hop, s_redirect_location[0] ? s_redirect_location : "(none)", current_url);
        esp_http_client_close(s_segment_client);
        esp_http_client_cleanup(s_segment_client);
        s_segment_client = NULL;
        return 0;
    }

    if (!s_segment_client || seg_status < 200 || seg_status >= 300) {
        ESP_LOGW(TAG, "Segment redirect chain exhausted: %.80s", segment_url);
        if (s_segment_client) {
            esp_http_client_close(s_segment_client);
            esp_http_client_cleanup(s_segment_client);
            s_segment_client = NULL;
        }
        return 0;
    }

    if (!pending || pending_cap < 2048) {
        ESP_LOGW(TAG, "Pending decode buffer unavailable");
        esp_http_client_close(s_segment_client);
        return 0;
    }
    size_t pending_len = pending_len_io ? *pending_len_io : 0;

    size_t read_total = 0;
    size_t decoded_total = 0;
    size_t written_total = 0;
    uint32_t current_gen = s_adf.task_gen_id;
    while (s_playing && s_use_adf && current_gen == s_adf.task_gen_id) {
        int n = esp_http_client_read(s_segment_client, (char *)chunk_buf, HTTP_CHUNK_BYTES);
        if (n <= 0) {
            if (n < 0) {
                ESP_LOGW(TAG, "Segment read err=%d url=%.80s", n, segment_url);
                esp_http_client_cleanup(s_segment_client);
                s_segment_client = NULL;
            }
            break;
        }
        read_total += (size_t)n;
        if (pending_len + (size_t)n > pending_cap) {
            /* Drain decoder first to avoid dropping compressed data unnecessarily. */
            decoded_total += decode_pending_bytes(dec, pending, &pending_len, false,
                                                  pcm_buf, pcm_size, sample_info_logged,
                                                  &written_total);
        }
        if (pending_len + (size_t)n > pending_cap) {
            /* Keep recent tail and trim only what cannot fit. */
            size_t keep = pending_cap / 2;
            if (pending_len > keep) {
                memmove(pending, pending + (pending_len - keep), keep);
                pending_len = keep;
            }
        }
        if (pending_len + (size_t)n > pending_cap) {
            size_t room = pending_cap - pending_len;
            if (room == 0) {
                ESP_LOGW(TAG, "Pending decode buffer saturated (%u bytes), skipping chunk", (unsigned)pending_cap);
                continue;
            }
            ESP_LOGW(TAG, "Pending decode buffer nearly full (%u), clipping chunk %u->%u",
                     (unsigned)pending_cap, (unsigned)n, (unsigned)room);
            n = (int)room;
        }
        memcpy(pending + pending_len, chunk_buf, (size_t)n);
        pending_len += (size_t)n;
        decoded_total += decode_pending_bytes(dec, pending, &pending_len, false,
                                              pcm_buf, pcm_size, sample_info_logged,
                                              &written_total);
    }

    esp_http_client_close(s_segment_client);

    if (flush_eos) {
        /* Flush decoder at final end-of-stream. */
        decoded_total += decode_pending_bytes(dec, pending, &pending_len, true,
                                              pcm_buf, pcm_size, sample_info_logged,
                                              &written_total);
    }
    if (pending_len_io) {
        *pending_len_io = pending_len;
    }
    if (decoded_total == 0) {
        ESP_LOGW(TAG, "Segment silent read=%u pending=%u written=%u url=%.96s",
                 (unsigned)read_total, (unsigned)pending_len, (unsigned)written_total,
                 segment_url);
    } else {
        ESP_LOGD(TAG, "Segment ok read=%u decoded=%u written=%u",
                 (unsigned)read_total, (unsigned)decoded_total, (unsigned)written_total);
    }
    return decoded_total;
}

static bool url_looks_like_m3u8(const char *url)
{
    if (!url) {
        return false;
    }
    return strstr(url, ".m3u8") != NULL || strstr(url, "lsn.lv/bbcradio.m3u8") != NULL;
}

static esp_audio_simple_dec_type_t pick_decoder_type(const char *url)
{
    if (url_looks_like_m3u8(url)) {
        return ESP_AUDIO_SIMPLE_DEC_TYPE_TS;
    }
    if (url && (strstr(url, ".mp3") || strstr(url, "-mp3") || strstr(url, "mp3") || strstr(url, "audio/mpeg"))) {
        return ESP_AUDIO_SIMPLE_DEC_TYPE_MP3;
    }
    return ESP_AUDIO_SIMPLE_DEC_TYPE_AAC;
}

static void adf_pcm_task(void *arg)
{
    (void)arg;
    uint32_t my_gen_id = s_adf.task_gen_id;
    ESP_LOGI(TAG, "Stream task started with gen_id=%"PRIu32, my_gen_id);

    static bool decoders_registered = false;
    if (!decoders_registered) {
        esp_ts_dec_register();
        esp_aac_dec_register();
        esp_mp3_dec_register();
        decoders_registered = true;
    }

    /* Exit if this task is stale (new stream already started). */
    if (my_gen_id != s_adf.task_gen_id) {
        ESP_LOGW(TAG, "Stream task gen_id mismatch (mine=%"PRIu32" current=%"PRIu32"), exiting", my_gen_id, s_adf.task_gen_id);
        s_adf.pcm_task = NULL;
        vTaskDelete(NULL);
        return;
    }

    esp_audio_simple_dec_type_t dec_type = pick_decoder_type(s_current_url);
    /* Enable HE-AAC/AAC+ support for lower-bitrate BBC HLS variants. */
    esp_ts_dec_cfg_t ts_cfg = { .aac_plus_enable = true };
    esp_audio_simple_dec_cfg_t dec_cfg = {
        .dec_type = dec_type,
        .dec_cfg  = (dec_type == ESP_AUDIO_SIMPLE_DEC_TYPE_TS) ? &ts_cfg : NULL,
        .cfg_size = (dec_type == ESP_AUDIO_SIMPLE_DEC_TYPE_TS) ? sizeof(ts_cfg) : 0,
    };
    esp_audio_simple_dec_handle_t dec = NULL;
    if (esp_audio_simple_dec_open(&dec_cfg, &dec) != ESP_AUDIO_ERR_OK) {
        ESP_LOGE(TAG, "Simple decoder open failed (type=%d)", (int)dec_type);
        s_adf.pcm_task = NULL;
        vTaskDelete(NULL);
        return;
    }

    uint8_t *in_buf = alloc_pref_psram(HTTP_CHUNK_BYTES);
    uint32_t pcm_size = PCM_BUF_BYTES;
    uint8_t *pcm_buf = alloc_pref_psram(pcm_size);
    size_t pending_cap = PENDING_BUF_BYTES;
    uint8_t *pending_buf = NULL;
    if (heap_caps_get_free_size(MALLOC_CAP_SPIRAM) >= pending_cap) {
        pending_buf = heap_caps_malloc(pending_cap, MALLOC_CAP_SPIRAM);
    }
    if (!pending_buf) {
        pending_cap = 32768;
        if (heap_caps_get_free_size(MALLOC_CAP_SPIRAM) >= pending_cap) {
            pending_buf = heap_caps_malloc(pending_cap, MALLOC_CAP_SPIRAM);
        }
    }
    if (!pending_buf) {
        pending_cap = PENDING_BUF_BYTES_FALLBACK;
        pending_buf = malloc(pending_cap);
    }
    char *playlist_buf = alloc_pref_psram(PLAYLIST_BUF_BYTES);
    char *media_playlist_url = alloc_pref_psram(512);
    char last_segment_url[512] = {0};
    char (*entry_buf)[256] = alloc_pref_psram(sizeof(char[8][256]));
    if (!in_buf || !pcm_buf || !pending_buf || !playlist_buf || !media_playlist_url || !entry_buf) {
        ESP_LOGE(TAG, "Stream task alloc failed");
        free(in_buf);
        free(pcm_buf);
        free(pending_buf);
        free(playlist_buf);
        free(media_playlist_url);
        free(entry_buf);
        esp_audio_simple_dec_close(dec);
        s_adf.pcm_task = NULL;
        vTaskDelete(NULL);
        return;
    }

    bool sample_info_logged = false;
    size_t pending_len = 0;
    s_adf.last_seq = -1;
    strlcpy(media_playlist_url, s_current_url, 512);
    ESP_LOGI(TAG, "Worker buffers: in=%u pcm=%u pending=%u internal_free=%u largest_internal=%u",
             (unsigned)HTTP_CHUNK_BYTES,
             (unsigned)pcm_size,
             (unsigned)pending_cap,
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
             (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
    ESP_LOGI(TAG, "Direct stream task started (type=%d): %.120s", (int)dec_type, media_playlist_url);

    while (s_playing && s_use_adf && my_gen_id == s_adf.task_gen_id) {
        if (dec_type != ESP_AUDIO_SIMPLE_DEC_TYPE_TS) {
            /* Podcast and direct-file playback path (MP3/AAC): stream bytes directly. */
            size_t decoded = stream_segment_encoded(media_playlist_url, dec, in_buf, &pcm_buf, &pcm_size,
                                                    &sample_info_logged, pending_buf, pending_cap,
                                                    &pending_len, true);
            if (decoded == 0) {
                esp_audio_simple_dec_type_t fallback_type =
                    (dec_type == ESP_AUDIO_SIMPLE_DEC_TYPE_MP3)
                        ? ESP_AUDIO_SIMPLE_DEC_TYPE_AAC
                        : ESP_AUDIO_SIMPLE_DEC_TYPE_MP3;
                ESP_LOGW(TAG, "No PCM decoded with type=%d, retrying with fallback type=%d",
                         (int)dec_type, (int)fallback_type);
                esp_audio_simple_dec_close(dec);
                dec_cfg.dec_type = fallback_type;
                dec_cfg.dec_cfg = NULL;
                dec_cfg.cfg_size = 0;
                if (esp_audio_simple_dec_open(&dec_cfg, &dec) == ESP_AUDIO_ERR_OK) {
                    pending_len = 0;
                    sample_info_logged = false;
                    (void)stream_segment_encoded(media_playlist_url, dec, in_buf, &pcm_buf, &pcm_size,
                                                 &sample_info_logged, pending_buf, pending_cap,
                                                 &pending_len, true);
                    dec_type = fallback_type;
                } else {
                    ESP_LOGE(TAG, "Fallback decoder open failed (type=%d)", (int)fallback_type);
                }
            }
            break;
        }

        if (!http_read_text(media_playlist_url, playlist_buf, PLAYLIST_BUF_BYTES)) {
            ESP_LOGW(TAG, "Playlist fetch failed: %.120s", media_playlist_url);
            vTaskDelay(pdMS_TO_TICKS(900));
            continue;
        }

        if (strstr(playlist_buf, "#EXT-X-STREAM-INF") != NULL) {
            int n = parse_playlist_entries(playlist_buf, entry_buf, 8);
            if (n > 0) {
                char next_url[512];
                make_absolute_url(media_playlist_url, entry_buf[0], next_url, sizeof(next_url));
                ESP_LOGI(TAG, "Selected variant playlist: %.120s", next_url);
                strlcpy(media_playlist_url, next_url, 512);
            }
            vTaskDelay(pdMS_TO_TICKS(120));
            continue;
        }

        int seq = parse_media_sequence(playlist_buf);
        int seg_count = parse_playlist_entries(playlist_buf, entry_buf, 8);
        ESP_LOGD(TAG, "Playlist seq=%d entries=%d", seq, seg_count);
        if (seg_count == 0) {
            ESP_LOGW(TAG, "No playlist entries (seq=%d): %.120s", seq, playlist_buf);
            vTaskDelay(pdMS_TO_TICKS(250));
            continue;
        }

        /* Catch up through unseen segments to reduce playback gaps/stutter. */
        int newest = seg_count - 1;
        int start = newest;
        if (last_segment_url[0] == '\0') {
            /* First pass: build a slightly deeper cushion for live radio. */
            start = newest - 3;
            if (start < 0) {
                start = 0;
            }
        } else {
            int found = -1;
            for (int i = 0; i < seg_count; i++) {
                char candidate[512];
                make_absolute_url(media_playlist_url, entry_buf[i], candidate, sizeof(candidate));
                if (strcmp(candidate, last_segment_url) == 0) {
                    found = i;
                    break;
                }
            }
            start = (found >= 0) ? (found + 1) : (newest - 3);
            if (start < 0) {
                start = 0;
            }
        }

        for (int i = start; i <= newest && s_playing && s_use_adf && my_gen_id == s_adf.task_gen_id; i++) {
            char seg_url[512];
            make_absolute_url(media_playlist_url, entry_buf[i], seg_url, sizeof(seg_url));
            if (strcmp(seg_url, last_segment_url) == 0) {
                continue;
            }
            ESP_LOGD(TAG, "Fetching segment i=%d/%d url=%.96s", i, newest, seg_url);
            (void)stream_segment_encoded(seg_url, dec, in_buf, &pcm_buf, &pcm_size,
                                         &sample_info_logged, pending_buf, pending_cap,
                                         &pending_len, false);
            strlcpy(last_segment_url, seg_url, sizeof(last_segment_url));
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }

    if (pending_len > 0) {
        size_t final_written = 0;
        size_t final_decoded = decode_pending_bytes(dec, pending_buf, &pending_len, true,
                                                    &pcm_buf, &pcm_size, &sample_info_logged,
                                                    &final_written);
        ESP_LOGD(TAG, "Final decoder flush decoded=%u written=%u remain=%u",
             (unsigned)final_decoded, (unsigned)final_written, (unsigned)pending_len);
    }

    esp_audio_simple_dec_close(dec);
    ESP_LOGW(TAG, "Cleaning up stream task resources (decoding=true, gen_id match=%d)", my_gen_id == s_adf.task_gen_id);
    free(in_buf);
    free(pcm_buf);
    free(pending_buf);
    free(playlist_buf);
    free(media_playlist_url);
    free(entry_buf);
    ESP_LOGW(TAG, "Direct stream task exiting (playing=%d use_adf=%d gen_id=%"PRIu32")", s_playing, s_use_adf, my_gen_id);
    vTaskDelay(pdMS_TO_TICKS(50));
    if (my_gen_id == s_adf.task_gen_id) {
        s_adf.pcm_task = NULL;
    }
    vTaskDelete(NULL);
}

static void adf_stop_locked(void)
{
    if (s_adf.pcm_task != NULL) {
        ESP_LOGW(TAG, "Stopping stream task, waiting for decoder close...");
        for (int i = 0; i < 80 && s_adf.pcm_task != NULL; ++i) {
            vTaskDelay(pdMS_TO_TICKS(10));
        }
        if (s_adf.pcm_task != NULL) {
            ESP_LOGW(TAG, "Direct stream task did not exit in time, force deleting");
            vTaskDelete(s_adf.pcm_task);
            s_adf.pcm_task = NULL;
        }
        vTaskDelay(pdMS_TO_TICKS(200));
    }
    /* Stop drainer AFTER stream task exits so the ring buffer remains
     * drainable while the stream task is still trying to write to it. */
    if (s_codec_drainer_task) {
        s_drainer_active = false;
        for (int i = 0; i < 30 && s_codec_drainer_task != NULL; ++i) {
            vTaskDelay(pdMS_TO_TICKS(10));
        }
        if (s_codec_drainer_task) {
            vTaskDelete(s_codec_drainer_task);
            s_codec_drainer_task = NULL;
        }
    }
    if (s_pcm_ringbuf) {
        vRingbufferDelete(s_pcm_ringbuf);
        s_pcm_ringbuf = NULL;
    }
}

/* Drains the PCM ring buffer to the I2S codec at audio rate.
 * Runs on core 0 (separate from stream_worker on core 1) so network activity
 * on core 1 never blocks the codec output path.
 * Writes silence when the ring buffer is empty to prevent I2S DMA underrun. */
static void codec_drainer_task(void *arg)
{
    /* 10 ms of silence @ 48 kHz stereo 16-bit = 48000*2*2*0.01 = 1920 bytes */
    static const uint8_t silence[1920];
    uint32_t empty_polls = 0;
    while (s_drainer_active) {
        size_t  item_size = 0;
        void   *item      = xRingbufferReceiveUpTo(s_pcm_ringbuf, &item_size,
                                                   pdMS_TO_TICKS(40), 4096);
        if (item) {
            empty_polls = 0;
            size_t wr = 0;
            bsp_codec_write(item, item_size, &wr);
            vRingbufferReturnItem(s_pcm_ringbuf, item);
        } else {
            empty_polls++;
            /* Tolerate a brief producer jitter before injecting silence. */
            if (empty_polls >= 2) {
                size_t wr = 0;
                bsp_codec_write((void *)silence, sizeof(silence), &wr);
                if ((empty_polls % 25U) == 0U) {
                    ESP_LOGW(TAG, "PCM underrun ongoing (empty_polls=%u)", (unsigned)empty_polls);
                }
            }
        }
    }
    s_codec_drainer_task = NULL;
    vTaskDelete(NULL);
}

static esp_err_t adf_start_stream(const char *url, bool is_live)
{
    adf_stop_locked();
    /* Brief settle after codec drain — caller already holds an 80ms gap. */
    vTaskDelay(pdMS_TO_TICKS(50));
    s_adf.task_gen_id++;
    ESP_LOGI(TAG, "Incremented gen_id to %"PRIu32, s_adf.task_gen_id);

    ESP_LOGI(TAG, "Starting direct stream worker: %.80s", url);
    ESP_LOGI(TAG, "Free heap: %"PRIu32, esp_get_free_heap_size());
    gpio_set_level(BSP_PA_CTRL, 1);   /* Ensure PA is enabled for real stream playback */

    /* Create PSRAM-backed PCM ring buffer and start codec drainer. */
    s_pcm_ringbuf = xRingbufferCreateWithCaps(PCM_RING_BUF_BYTES,
                                              RINGBUF_TYPE_BYTEBUF,
                                              MALLOC_CAP_SPIRAM);
    if (!s_pcm_ringbuf) {
        /* Fallback: small ring buffer in internal RAM. */
        s_pcm_ringbuf = xRingbufferCreate(32 * 1024, RINGBUF_TYPE_BYTEBUF);
        ESP_LOGW(TAG, "PCM ring buffer in internal RAM (PSRAM alloc failed)");
    }
    if (s_pcm_ringbuf) {
        s_drainer_active = true;
        xTaskCreatePinnedToCore(codec_drainer_task, "pcm_drainer", 4096,
                                NULL, 9, &s_codec_drainer_task, 0);
        ESP_LOGI(TAG, "PCM ring buffer created (%lu KiB), drainer task started",
                 (unsigned long)(PCM_RING_BUF_BYTES / 1024));
    }

    /* Mark stream mode active before creating worker so it doesn't exit early. */
    s_use_adf = true;
    BaseType_t rc = xTaskCreatePinnedToCore(adf_pcm_task, "stream_worker", 12288,
                                            NULL, 8, &s_adf.pcm_task, 1);
    if (rc != pdPASS) {
        uint32_t free_heap = esp_get_free_heap_size();
        uint32_t largest = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
        s_use_adf = false;
        ESP_LOGE(TAG, "Direct stream worker task create failed (free=%"PRIu32" largest=%"PRIu32")",
                 free_heap, largest);
        return ESP_FAIL;
    }
    return ESP_OK;
}
#endif

static uint32_t audio_tone_frequency(const char *url, bool is_live)
{
    uint32_t hash = 5381;
    for (const unsigned char *p = (const unsigned char *)url; *p != 0; ++p) {
        hash = ((hash << 5) + hash) ^ *p;
    }
    uint32_t base = is_live ? 220 : 330;
    return base + (hash % 6) * 55;
}

static void fill_square_wave_stereo(int16_t *buffer, size_t frames, uint32_t freq, uint32_t *phase)
{
    uint32_t step = (uint32_t)(((uint64_t)freq << 32) / BSP_AUDIO_SAMPLE_RATE);
    for (size_t i = 0; i < frames; ++i) {
        int16_t sample = (*phase & 0x80000000u) ? AUDIO_TONE_AMPLITUDE : -AUDIO_TONE_AMPLITUDE;
        buffer[i * 2] = sample;
        buffer[i * 2 + 1] = sample;
        *phase += step;
    }
}

static void hardware_tone_write(uint32_t freq, uint32_t duration_ms)
{
    if (!bsp_codec_is_ready()) {
        return;
    }

    int16_t buffer[AUDIO_TONE_FRAME_SAMPLES * BSP_AUDIO_CHANNELS];
    uint32_t phase = 0;
    uint32_t total_frames = (BSP_AUDIO_SAMPLE_RATE * duration_ms) / 1000;
    while (total_frames > 0) {
        size_t frames = total_frames > AUDIO_TONE_FRAME_SAMPLES ? AUDIO_TONE_FRAME_SAMPLES : total_frames;
        fill_square_wave_stereo(buffer, frames, freq, &phase);
        size_t written = 0;
        bsp_codec_write(buffer, frames * sizeof(int16_t) * BSP_AUDIO_CHANNELS, &written);
        total_frames -= (uint32_t)frames;
    }
}

static void hardware_tone_task(void *arg)
{
    int16_t buffer[AUDIO_TONE_FRAME_SAMPLES * BSP_AUDIO_CHANNELS];
    uint32_t phase = 0;
    uint32_t last_freq = 0;

    while (true) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        while (s_playing && bsp_codec_is_ready()) {
            uint32_t freq = s_hw_tone_freq ? s_hw_tone_freq : 440;
            if (freq != last_freq) {
                last_freq = freq;
                phase = 0;
            }

            fill_square_wave_stereo(buffer, AUDIO_TONE_FRAME_SAMPLES, freq, &phase);
            size_t written = 0;
            bsp_codec_write(buffer, sizeof(buffer), &written);
            if (written != sizeof(buffer)) {
                vTaskDelay(pdMS_TO_TICKS(5));
            }
        }
    }
}

static void stub_buzzer_init(void)
{
    /* Waveshare ESP32-S3-Touch-LCD-1.54 has no discrete buzzer GPIO.
     * Fallback tones on real hardware are routed through ES8311 + PA + speaker.
     */
    ESP_LOGI(TAG, "GPIO buzzer disabled for this board; using speaker tone fallback");
}

static void stub_buzzer_set(bool on, bool is_live)
{
    (void)on;
    (void)is_live;
}

static void stub_buzzer_self_test(void)
{
    /* No GPIO buzzer self-test on this hardware. */
}

static void hardware_audio_self_test(void)
{
    if (!bsp_codec_is_ready()) {
        return;
    }

    ESP_LOGI(TAG, "Hardware audio self-test start");
    bsp_codec_set_volume(35);
    vTaskDelay(pdMS_TO_TICKS(80));

    /* Brief boot tone at low volume to confirm audio path is alive. */
    gpio_set_level(BSP_PA_CTRL, 1);   /* PA active-HIGH: enable */
    hardware_tone_write(880, 120);
    vTaskDelay(pdMS_TO_TICKS(40));
    hardware_tone_write(1108, 80);

    bsp_codec_set_volume(70);
    ESP_LOGI(TAG, "Hardware audio self-test end");
}

esp_err_t bbc_audio_init(void)
{
    stub_buzzer_init();
    stub_buzzer_self_test();
    hardware_audio_self_test();
    if (s_hw_tone_task == NULL) {
        xTaskCreatePinnedToCore(hardware_tone_task, "audio_tone", 4096, NULL, 4, &s_hw_tone_task, 1);
    }
    bsp_codec_set_volume(70);
    ESP_LOGI(TAG, "Audio pipeline ready (speaker fallback, hardware codec %s, ADF %s)",
             bsp_codec_is_ready() ? "enabled" : "unavailable",
#if BBC_HAS_ADF
             "enabled");
#else
             "disabled");
#endif
    return ESP_OK;
}

esp_err_t bbc_audio_play_url(const char *url, bool is_live)
{
    /* Always tear down the current playback path cleanly before switching streams. */
    if (s_playing || s_use_adf) {
        bbc_audio_stop();
        vTaskDelay(pdMS_TO_TICKS(80));
    }

    strncpy(s_current_url, url, sizeof(s_current_url) - 1);
    s_current_url[sizeof(s_current_url) - 1] = '\0';

    /* Set requested playback state before ADF task starts.
     * adf_pcm_task checks s_playing in its run loop.
     */
    s_playing = true;
    s_is_live = is_live;
    s_hw_tone_freq = audio_tone_frequency(url, is_live);

    s_use_adf = false;
#if BBC_HAS_ADF
    if (bsp_codec_is_ready()) {
        if (adf_start_stream(url, is_live) == ESP_OK) {
            ESP_LOGI(TAG, "Using real stream audio output");
        } else {
            s_use_adf = false;
            ESP_LOGW(TAG, "ADF stream start failed");
            if (is_live) {
                s_playing = false;
                stub_buzzer_set(false, s_is_live);
                return ESP_FAIL;
            }
            ESP_LOGW(TAG, "Falling back to tone playback for non-live content");
        }
    }
#endif

    ESP_LOGI(TAG, "Playing %s: %.80s...", is_live ? "live stream" : "episode", url);

    if (!s_use_adf) {
        gpio_set_level(BSP_PA_CTRL, 1);   /* PA active-HIGH: enable for tone playback */
        stub_buzzer_set(true, is_live);
        if (s_hw_tone_task != NULL) {
            xTaskNotifyGive(s_hw_tone_task);
        }
    }

    return ESP_OK;
}

esp_err_t bbc_audio_stop(void)
{
    ESP_LOGI(TAG, "Stopped");

#if BBC_HAS_ADF
    if (s_use_adf) {
        s_use_adf = false;
        vTaskDelay(pdMS_TO_TICKS(50));
        s_playing = false;
        adf_stop_locked();
        return ESP_OK;
    }
#endif

    s_playing = false;
    stub_buzzer_set(false, s_is_live);
    if (s_hw_tone_task != NULL) {
        xTaskNotifyGive(s_hw_tone_task);
    }
    return ESP_OK;
}

esp_err_t bbc_audio_toggle(void)
{
    if (s_is_live) return ESP_OK;  /* live streams cannot be paused */

#if BBC_HAS_ADF
    if (s_use_adf) {
        if (s_playing) {
            s_playing = false;
            adf_stop_locked();
        } else {
            s_playing = true;
            s_use_adf = true;
            if (adf_start_stream(s_current_url, false) != ESP_OK) {
                s_use_adf = false;
            }
        }
        ESP_LOGI(TAG, "%s", s_playing ? "Resumed" : "Paused");
        return ESP_OK;
    }
#endif

    s_playing = !s_playing;
    ESP_LOGI(TAG, "%s", s_playing ? "Resumed" : "Paused");
    stub_buzzer_set(s_playing, s_is_live);
    if (s_playing && s_hw_tone_task != NULL) {
        xTaskNotifyGive(s_hw_tone_task);
    }
    return ESP_OK;
}

bool bbc_audio_is_playing(void) { return s_playing; }
bool bbc_audio_is_live(void)    { return s_is_live;  }

esp_err_t bbc_audio_set_volume(int percent)
{
    return bsp_codec_set_volume(percent);
}
