#include "podcast_index.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_err.h"
#include "cJSON.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

static void *podcast_malloc(size_t bytes)
{
    void *p = heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM);
    if (!p) {
        p = malloc(bytes);
    }
    return p;
}

static void *podcast_realloc(void *ptr, size_t bytes)
{
    void *p = heap_caps_realloc(ptr, bytes, MALLOC_CAP_SPIRAM);
    if (!p) {
        p = realloc(ptr, bytes);
    }
    return p;
}

/* Extract attr_name="..." from a bounded tag range. */
static const char *attr_find(const char *tag_start, const char *tag_end,
                             const char *attr_name, char *out, size_t out_len)
{
    size_t name_len = strlen(attr_name);
    const char *p = tag_start;
    while (p < tag_end) {
        const char *m = strstr(p, attr_name);
        if (!m || m >= tag_end) return NULL;
        p = m + name_len;
        if (p >= tag_end || *p != '=') {
            p = m + 1;
            continue;
        }
        p++;
        char quote = *p++;
        if (quote != '"' && quote != '\'') continue;
        const char *val_start = p;
        const char *val_end = memchr(p, quote, (size_t)(tag_end - p));
        if (!val_end) return NULL;
        size_t val_len = (size_t)(val_end - val_start);
        if (val_len >= out_len) val_len = out_len - 1;
        memcpy(out, val_start, val_len);
        out[val_len] = '\0';
        return out;
    }
    return NULL;
}

static const char *TAG = "podcast_index";

/* ── Cloud snapshots (small payloads) ─────────────────────────────── */
#define GCS_POPULAR_URL \
    "https://storage.googleapis.com/bbc-radio-player-index-20260317-bc149e38/popular-podcasts.json"
#define GCS_NEW_URL \
    "https://storage.googleapis.com/bbc-radio-player-index-20260317-bc149e38/new-podcasts.json"
#define GCS_POPULAR_MAX_JSON 8192
#define GCS_NEW_MAX_JSON 8192

/* ── Podcast storage in PSRAM ─────────────────────────────────────── */
#define MAX_PODCASTS  80
#define MAX_NEW_PODCASTS 20

static podcast_t *s_podcasts  = NULL;
static size_t     s_count     = 0;
static bool       s_ready     = false;

static bool is_valid_bbc_pid(const char *pid)
{
    if (!pid) return false;
    size_t len = strlen(pid);
    if (len != 8) return false;

    if (!((pid[0] >= 'a' && pid[0] <= 'z') || (pid[0] >= 'A' && pid[0] <= 'Z'))) {
        return false;
    }

    for (size_t i = 1; i < len; i++) {
        char c = pid[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) {
            return false;
        }
    }
    return true;
}

static int find_podcast_index_by_id(const char *pid)
{
    for (size_t i = 0; i < s_count; i++) {
        if (strncmp(s_podcasts[i].id, pid, PODCAST_ID_MAX) == 0) {
            return (int)i;
        }
    }
    return -1;
}

/* ── HTTP buffer used by bounded fetch helpers ────────────────────── */

typedef struct {
    char  *buf;
    size_t len;
    size_t cap;
} http_buf_t;

/* ── Minimal OPML parser ──────────────────────────────────────────── */
/*
 * Parses attributes from an <outline> tag in the BBC OPML.
 * Looks for: text="..." xmlUrl="..."
 * BBC feeds use lowercase `xmlUrl` and `text`.
 *
 * BBC podcast IDs (pXXXXXXXX) are embedded in the RSS URL:
 *   https://feeds.bbci.co.uk/podcasts/p01234567/rss.xml
 */

static char *fetch_small_json_once(const char *url, size_t max_len)
{
    char *buf = podcast_malloc(max_len + 1);
    if (!buf) {
        ESP_LOGW(TAG, "OOM allocating %zu bytes for %s", max_len + 1, url);
        return NULL;
    }

    esp_http_client_config_t cfg = {
        .url = url,
        .timeout_ms = 10000,
        .buffer_size = 1024,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) {
        ESP_LOGW(TAG, "HTTP client init failed for %s", url);
        free(buf);
        return NULL;
    }

    esp_http_client_set_header(c, "Accept-Encoding", "identity");

    esp_err_t open_err = esp_http_client_open(c, 0);
    if (open_err != ESP_OK) {
        ESP_LOGW(TAG, "HTTP open failed for %s: %s", url, esp_err_to_name(open_err));
        esp_http_client_cleanup(c);
        free(buf);
        return NULL;
    }
    (void)esp_http_client_fetch_headers(c);

    int status = esp_http_client_get_status_code(c);
    if (status != 200) {
        ESP_LOGW(TAG, "HTTP status %d for %s", status, url);
        esp_http_client_close(c);
        esp_http_client_cleanup(c);
        free(buf);
        return NULL;
    }

    size_t len = 0;
    int r;
    while ((r = esp_http_client_read(c, buf + len, (int)(max_len - len))) > 0) {
        len += (size_t)r;
        if (len >= max_len) {
            ESP_LOGE(TAG, "JSON response too large for %s", url);
            esp_http_client_close(c);
            esp_http_client_cleanup(c);
            free(buf);
            return NULL;
        }
    }
    if (r < 0) {
        ESP_LOGW(TAG, "HTTP read failed for %s", url);
        esp_http_client_close(c);
        esp_http_client_cleanup(c);
        free(buf);
        return NULL;
    }
    buf[len] = '\0';

    esp_http_client_close(c);
    esp_http_client_cleanup(c);
    return buf;
}

static bool gcs_https_to_http(const char *url, char *out, size_t out_len)
{
    static const char *prefix = "https://storage.googleapis.com/";
    if (strncmp(url, prefix, strlen(prefix)) != 0) {
        return false;
    }

    snprintf(out, out_len, "http://storage.googleapis.com/%s", url + strlen(prefix));
    return true;
}

static char *fetch_small_json(const char *url, size_t max_len)
{
    char http_url[320];
    bool has_http_fallback = gcs_https_to_http(url, http_url, sizeof(http_url));

    const char *candidates[2] = { url, http_url };
    size_t candidate_count = has_http_fallback ? 2 : 1;

    for (size_t c = 0; c < candidate_count; c++) {
        const char *candidate = candidates[c];
        for (int attempt = 1; attempt <= 3; attempt++) {
            char *buf = fetch_small_json_once(candidate, max_len);
            if (buf) {
                return buf;
            }

            if (attempt < 3) {
                ESP_LOGW(TAG, "Retrying %s (attempt %d/3)", candidate, attempt + 1);
                vTaskDelay(pdMS_TO_TICKS(300));
            }
        }

        if (c == 0 && has_http_fallback) {
            ESP_LOGW(TAG, "HTTPS fetch failed for %s, retrying over HTTP", url);
        }
    }

    return NULL;
}

static void build_rss_url_from_id(const char *pid, char *out, size_t out_len)
{
    snprintf(out, out_len, "https://podcasts.files.bbci.co.uk/%s.rss", pid);
}

static void build_downloads_rss_url_from_id(const char *pid, char *out, size_t out_len)
{
    snprintf(out, out_len, "https://www.bbc.co.uk/programmes/%s/episodes/downloads.rss", pid);
}

static bool podcasts_files_https_to_http(const char *url, char *out, size_t out_len)
{
    static const char *prefix = "https://podcasts.files.bbci.co.uk/";
    if (strncmp(url, prefix, strlen(prefix)) != 0) {
        return false;
    }
    snprintf(out, out_len, "http://podcasts.files.bbci.co.uk/%s", url + strlen(prefix));
    return true;
}

static esp_err_t load_top_podcasts_from_cloud(void)
{
    if (!s_podcasts) {
        s_podcasts = podcast_malloc(MAX_PODCASTS * sizeof(podcast_t));
        if (!s_podcasts) {
            ESP_LOGE(TAG, "OOM allocating podcast array");
            return ESP_ERR_NO_MEM;
        }
    }
    s_count = 0;

    ESP_LOGI(TAG, "Fetching popular-podcasts snapshot...");
    char *pop_json = fetch_small_json(GCS_POPULAR_URL, GCS_POPULAR_MAX_JSON);
    if (!pop_json) {
        ESP_LOGE(TAG, "Could not fetch popular-podcasts.json");
        return ESP_FAIL;
    }

    cJSON *pop_root = cJSON_Parse(pop_json);
    free(pop_json);
    if (!pop_root) {
        ESP_LOGE(TAG, "Could not parse popular-podcasts JSON");
        return ESP_FAIL;
    }

    cJSON *popular = cJSON_GetObjectItemCaseSensitive(pop_root, "popular_podcasts");
    if (!popular) {
        popular = cJSON_GetObjectItemCaseSensitive(pop_root, "ranks");
    }
    if (!popular && cJSON_IsArray(pop_root)) {
        popular = pop_root;
    }

    cJSON *item;
    cJSON_ArrayForEach(item, popular) {
        if (s_count >= MAX_PODCASTS) break;

        const char *pid = NULL;
        const char *title = NULL;

        if (cJSON_IsObject(item)) {
            cJSON *jid = cJSON_GetObjectItemCaseSensitive(item, "id");
            cJSON *jname = cJSON_GetObjectItemCaseSensitive(item, "name");
            cJSON *jtitle = cJSON_GetObjectItemCaseSensitive(item, "title");
            if (cJSON_IsString(jid) && jid->valuestring) {
                pid = jid->valuestring;
            }
            if (cJSON_IsString(jname) && jname->valuestring) {
                title = jname->valuestring;
            } else if (cJSON_IsString(jtitle) && jtitle->valuestring) {
                title = jtitle->valuestring;
            }
        } else if (cJSON_IsString(item) && item->valuestring) {
            pid = item->valuestring;
        }

        if (!is_valid_bbc_pid(pid)) continue;

        podcast_t *pod = &s_podcasts[s_count];
        memset(pod, 0, sizeof(*pod));

        strncpy(pod->id, pid, PODCAST_ID_MAX - 1);
        strncpy(pod->title, (title && title[0]) ? title : pid, PODCAST_TITLE_MAX - 1);
        build_rss_url_from_id(pod->id, pod->rss_url, PODCAST_URL_MAX);
        pod->popularity_rank = (int)(s_count + 1);
        pod->is_new = false;
        pod->new_rank = 0;
        s_count++;
    }
    cJSON_Delete(pop_root);

    if (s_count == 0) {
        ESP_LOGW(TAG, "No podcasts in popular snapshot");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Loaded %zu popular podcasts", s_count);

    /* Load the newest 20 podcasts from cloud index (newest first). */
    char *new_json = fetch_small_json(GCS_NEW_URL, GCS_NEW_MAX_JSON);
    if (new_json) {
        cJSON *new_root = cJSON_Parse(new_json);
        free(new_json);
        if (new_root) {
            cJSON *new_items = cJSON_GetObjectItemCaseSensitive(new_root, "new_podcasts");
            if (!new_items) {
                new_items = cJSON_GetObjectItemCaseSensitive(new_root, "ids");
            }
            if (!new_items && cJSON_IsArray(new_root)) {
                new_items = new_root;
            }

            int new_rank = 0;
            cJSON *entry;
            cJSON_ArrayForEach(entry, new_items) {
                if (new_rank >= MAX_NEW_PODCASTS) {
                    break;
                }

                const char *pid = NULL;
                const char *title = NULL;

                if (cJSON_IsObject(entry)) {
                    cJSON *jid = cJSON_GetObjectItemCaseSensitive(entry, "id");
                    cJSON *jtitle = cJSON_GetObjectItemCaseSensitive(entry, "title");
                    if (cJSON_IsString(jid) && jid->valuestring) {
                        pid = jid->valuestring;
                    }
                    if (cJSON_IsString(jtitle) && jtitle->valuestring) {
                        title = jtitle->valuestring;
                    }
                } else if (cJSON_IsString(entry) && entry->valuestring) {
                    pid = entry->valuestring;
                }

                if (!is_valid_bbc_pid(pid)) {
                    continue;
                }

                int idx = find_podcast_index_by_id(pid);
                if (idx >= 0) {
                    s_podcasts[idx].is_new = true;
                    s_podcasts[idx].new_rank = ++new_rank;
                    if (title && title[0]) {
                        strncpy(s_podcasts[idx].title, title, PODCAST_TITLE_MAX - 1);
                    }
                    continue;
                }

                if (s_count >= MAX_PODCASTS) {
                    break;
                }

                podcast_t *pod = &s_podcasts[s_count];
                memset(pod, 0, sizeof(*pod));
                strncpy(pod->id, pid, PODCAST_ID_MAX - 1);
                strncpy(pod->title, (title && title[0]) ? title : pid, PODCAST_TITLE_MAX - 1);
                build_rss_url_from_id(pod->id, pod->rss_url, PODCAST_URL_MAX);
                pod->is_new = true;
                pod->new_rank = ++new_rank;
                s_count++;
            }
            cJSON_Delete(new_root);
        }
    }

    return ESP_OK;
}

/* ── Public API ───────────────────────────────────────────────────── */

esp_err_t podcast_index_fetch(void)
{
    ESP_LOGI(TAG, "Fetching top podcasts from cloud index...");

    esp_err_t ret = load_top_podcasts_from_cloud();
    if (ret != ESP_OK) return ret;

    s_ready = true;
    return ESP_OK;
}

size_t podcast_index_count(void)      { return s_count; }
bool   podcast_index_ready(void)      { return s_ready; }

podcast_t *podcast_index_get(size_t i)
{
    if (i >= s_count) return NULL;
    return &s_podcasts[i];
}

podcast_t *podcast_index_get_all(size_t *count_out)
{
    if (count_out) *count_out = s_count;
    return s_podcasts;
}

podcast_t *podcast_index_random(void)
{
    if (s_count == 0) return NULL;
    return &s_podcasts[esp_random() % s_count];
}

/* ── Episode fetcher (downloads individual RSS feed) ───────────────── */

#define MAX_RECENT_EPISODES 3
#define EPISODE_FETCH_INITIAL_CAP 2048
#define EPISODE_FETCH_GROWTH 1024
#define EPISODE_FETCH_MAX_CAP 6144

static esp_err_t parse_rss_episodes(const char *xml, podcast_t *podcast)
{
#define MAX_EPS MAX_RECENT_EPISODES
    episode_t *eps = podcast_malloc(MAX_EPS * sizeof(episode_t));
    if (!eps) return ESP_ERR_NO_MEM;
    size_t n = 0;
    const char *p = xml;
    while (n < MAX_EPS) {
        const char *item = strstr(p, "<item>");
        if (!item) break;
        const char *item_end = strstr(item, "</item>");
        if (!item_end) break;

        episode_t *ep = &eps[n];
        memset(ep, 0, sizeof(*ep));
        strncpy(ep->podcast_id, podcast->id, PODCAST_ID_MAX - 1);

        /* title */
        const char *ts = strstr(item, "<title>");
        const char *te = ts ? strstr(ts, "</title>") : NULL;
        if (ts && te) {
            ts += 7;
            size_t tl = (size_t)(te - ts);
            if (tl >= EPISODE_TITLE_MAX) tl = EPISODE_TITLE_MAX - 1;
            /* Strip leading CDATA if present */
            if (strncmp(ts, "<![CDATA[", 9) == 0) { ts += 9; tl -= 9 + 3; }
            strncpy(ep->title, ts, tl);
        }

        /* enclosure url (audio) */
        const char *enc = strstr(item, "<enclosure ");
        if (enc && enc < item_end) {
            const char *enc_end = strchr(enc, '>');
            if (enc_end) {
                attr_find(enc, enc_end, "url", ep->audio_url, EPISODE_URL_MAX);
            }
        }

        /* pubDate */
        const char *ds = strstr(item, "<pubDate>");
        const char *de = ds ? strstr(ds, "</pubDate>") : NULL;
        if (ds && de) {
            ds += 9;
            size_t dl = (size_t)(de - ds);
            if (dl >= sizeof(ep->pub_date)) dl = sizeof(ep->pub_date) - 1;
            strncpy(ep->pub_date, ds, dl);
        }

        if (ep->audio_url[0] != '\0') n++;
        p = item_end + 7;
    }

    if (n == 0) {
        free(eps);
        return ESP_ERR_NOT_FOUND;
    }

    podcast->_episodes      = eps;
    podcast->_episode_count = n;
    return ESP_OK;
}

static esp_err_t ensure_http_buf_capacity(http_buf_t *buf, size_t needed, const char *url)
{
    if (needed <= buf->cap) {
        return ESP_OK;
    }

    size_t new_cap = buf->cap + EPISODE_FETCH_GROWTH;
    while (new_cap < needed) {
        new_cap += EPISODE_FETCH_GROWTH;
    }
    if (new_cap > EPISODE_FETCH_MAX_CAP) {
        new_cap = EPISODE_FETCH_MAX_CAP;
    }
    if (needed > new_cap) {
        ESP_LOGE(TAG, "OOM growing episode buffer for %s to %zu bytes", url, needed);
        return ESP_ERR_NO_MEM;
    }

    char *tmp = podcast_realloc(buf->buf, new_cap);
    if (!tmp) {
        ESP_LOGE(TAG, "OOM growing episode buffer for %s to %zu bytes", url, new_cap);
        return ESP_ERR_NO_MEM;
    }
    buf->buf = tmp;
    buf->cap = new_cap;
    return ESP_OK;
}

static esp_err_t append_compact_item_xml(const char *item_start, const char *item_end,
                                         http_buf_t *out, const char *url)
{
    char title[EPISODE_TITLE_MAX] = {0};
    char audio_url[EPISODE_URL_MAX] = {0};
    char pub_date[32] = {0};

    const char *ts = strstr(item_start, "<title>");
    const char *te = ts ? strstr(ts, "</title>") : NULL;
    if (ts && te && te < item_end) {
        ts += 7;
        size_t tl = (size_t)(te - ts);
        if (tl >= sizeof(title)) tl = sizeof(title) - 1;
        memcpy(title, ts, tl);
        title[tl] = '\0';
    }

    const char *enc = strstr(item_start, "<enclosure ");
    if (enc && enc < item_end) {
        const char *enc_end = strchr(enc, '>');
        if (enc_end && enc_end < item_end) {
            attr_find(enc, enc_end, "url", audio_url, sizeof(audio_url));
        }
    }

    const char *ds = strstr(item_start, "<pubDate>");
    const char *de = ds ? strstr(ds, "</pubDate>") : NULL;
    if (ds && de && de < item_end) {
        ds += 9;
        size_t dl = (size_t)(de - ds);
        if (dl >= sizeof(pub_date)) dl = sizeof(pub_date) - 1;
        memcpy(pub_date, ds, dl);
        pub_date[dl] = '\0';
    }

    if (audio_url[0] == '\0') {
        return ESP_ERR_NOT_FOUND;
    }

    char compact[640];
    int written = snprintf(
        compact,
        sizeof(compact),
        "<item><title>%s</title><enclosure url=\"%s\" /><pubDate>%s</pubDate></item>",
        title,
        audio_url,
        pub_date
    );
    if (written <= 0 || (size_t)written >= sizeof(compact)) {
        return ESP_FAIL;
    }

    size_t needed = out->len + (size_t)written + 1;
    esp_err_t cap_err = ensure_http_buf_capacity(out, needed, url);
    if (cap_err != ESP_OK) {
        return cap_err;
    }

    memcpy(out->buf + out->len, compact, (size_t)written);
    out->len += (size_t)written;
    out->buf[out->len] = '\0';
    return ESP_OK;
}

static esp_err_t fetch_episode_feed_prefix(const char *url, http_buf_t *buf)
{
    char chunk[1024];
    static const char *item_open_tag = "<item>";
    static const char *item_close_tag = "</item>";
    size_t item_close_tag_len = strlen(item_close_tag);
    bool started_items = false;
    char carry[8] = {0};
    size_t carry_len = 0;
    size_t extracted = 0;

    char *work = podcast_malloc(4096);
    if (!work) {
        return ESP_ERR_NO_MEM;
    }
    size_t work_len = 0;
    size_t work_cap = 4096;

    buf->len = 0;
    if (buf->cap > 0 && buf->buf) {
        buf->buf[0] = '\0';
    }

    esp_http_client_config_t cfg = {
        .url = url,
        .timeout_ms = 10000,
        .buffer_size = sizeof(chunk),
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        free(work);
        return ESP_FAIL;
    }

    esp_http_client_set_header(client, "Accept-Encoding", "identity");

    esp_err_t ret = esp_http_client_open(client, 0);
    if (ret != ESP_OK) {
        esp_http_client_cleanup(client);
        free(work);
        return ret;
    }

    (void)esp_http_client_fetch_headers(client);
    int status = esp_http_client_get_status_code(client);
    if (status != 200) {
        ESP_LOGE(TAG, "HTTP %d for %s", status, url);
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        free(work);
        return ESP_FAIL;
    }

    while (1) {
        int read_len = esp_http_client_read(client, chunk, sizeof(chunk));
        if (read_len < 0) {
            ret = ESP_FAIL;
            break;
        }
        if (read_len == 0) {
            ret = ESP_OK;
            break;
        }

        const char *write_ptr = chunk;
        size_t write_len = (size_t)read_len;

        if (!started_items) {
            char scan[sizeof(carry) + sizeof(chunk)];
            memcpy(scan, carry, carry_len);
            memcpy(scan + carry_len, chunk, (size_t)read_len);
            size_t scan_len = carry_len + (size_t)read_len;

            char *item_start = strstr(scan, item_open_tag);
            if (!item_start) {
                if (scan_len >= sizeof(carry) - 1) {
                    carry_len = sizeof(carry) - 1;
                    memcpy(carry, scan + scan_len - carry_len, carry_len);
                } else {
                    carry_len = scan_len;
                    memcpy(carry, scan, carry_len);
                }
                vTaskDelay(pdMS_TO_TICKS(2));
                continue;
            }

            started_items = true;
            write_ptr = item_start;
            write_len = scan_len - (size_t)(item_start - scan);
            carry_len = 0;
        }

        size_t work_needed = work_len + write_len + 1;
        if (work_needed > work_cap) {
            size_t new_cap = work_cap + 1024;
            while (new_cap < work_needed) {
                new_cap += 1024;
            }
            if (new_cap > 8192) {
                ret = (extracted > 0) ? ESP_OK : ESP_ERR_NO_MEM;
                break;
            }
            char *tmp = podcast_realloc(work, new_cap);
            if (!tmp) {
                ret = (extracted > 0) ? ESP_OK : ESP_ERR_NO_MEM;
                break;
            }
            work = tmp;
            work_cap = new_cap;
        }

        memcpy(work + work_len, write_ptr, write_len);
        work_len += write_len;
        work[work_len] = '\0';

        while (extracted < MAX_RECENT_EPISODES) {
            char *item_start = strstr(work, item_open_tag);
            if (!item_start) {
                break;
            }

            char *item_end = strstr(item_start, item_close_tag);
            if (!item_end) {
                break;
            }
            item_end += item_close_tag_len;

            esp_err_t app_ret = append_compact_item_xml(item_start, item_end, buf, url);
            if (app_ret == ESP_OK) {
                extracted++;
            } else if (app_ret == ESP_ERR_NO_MEM) {
                ret = (extracted > 0) ? ESP_OK : ESP_ERR_NO_MEM;
                break;
            }

            size_t consumed = (size_t)(item_end - work);
            memmove(work, work + consumed, work_len - consumed);
            work_len -= consumed;
            work[work_len] = '\0';
        }

        if (ret != ESP_OK) {
            break;
        }

        if (extracted >= MAX_RECENT_EPISODES) {
            ret = ESP_OK;
            break;
        }

        vTaskDelay(pdMS_TO_TICKS(2));
    }

    esp_http_client_close(client);
    esp_http_client_cleanup(client);

    free(work);

    if (ret == ESP_OK && extracted == 0) {
        return ESP_ERR_NOT_FOUND;
    }
    return ret;
}

esp_err_t podcast_fetch_episodes(podcast_t *podcast)
{
    if (podcast->_episodes && podcast->_episode_count > 0) return ESP_OK;  /* already cached */

    if (podcast->_episodes && podcast->_episode_count == 0) {
        free(podcast->_episodes);
        podcast->_episodes = NULL;
    }

    ESP_LOGI(TAG, "Fetching episodes for %s from %s", podcast->id, podcast->rss_url);

    http_buf_t buf = {
        .buf = podcast_malloc(EPISODE_FETCH_INITIAL_CAP),
        .len = 0,
        .cap = EPISODE_FETCH_INITIAL_CAP,
    };
    if (!buf.buf) return ESP_ERR_NO_MEM;

    esp_err_t ret = fetch_episode_feed_prefix(podcast->rss_url, &buf);
    if (ret == ESP_OK) {
        ret = parse_rss_episodes(buf.buf, podcast);
        if (ret == ESP_OK) {
            ESP_LOGI(TAG, "Loaded %zu episodes for %s", podcast->_episode_count, podcast->id);
        } else {
            ESP_LOGW(TAG, "Episode parse failed for %s (%s): %s",
                     podcast->id, podcast->rss_url, esp_err_to_name(ret));
        }
    } else {
        ESP_LOGW(TAG, "Episode fetch failed for %s (%s): %s",
                 podcast->id, podcast->rss_url, esp_err_to_name(ret));
    }

    if (ret != ESP_OK) {
        char http_url[PODCAST_URL_MAX];
        if (podcasts_files_https_to_http(podcast->rss_url, http_url, sizeof(http_url))) {
            ESP_LOGI(TAG, "Retrying episodes for %s over HTTP via %s after %s",
                     podcast->id, http_url, esp_err_to_name(ret));

            memset(buf.buf, 0, buf.cap);
            buf.len = 0;

            esp_err_t http_ret = fetch_episode_feed_prefix(http_url, &buf);
            if (http_ret == ESP_OK) {
                http_ret = parse_rss_episodes(buf.buf, podcast);
                if (http_ret == ESP_OK) {
                    ESP_LOGI(TAG, "Loaded %zu episodes for %s via HTTP", podcast->_episode_count, podcast->id);
                    ret = ESP_OK;
                } else {
                    ESP_LOGW(TAG, "HTTP episode parse failed for %s: %s",
                             podcast->id, esp_err_to_name(http_ret));
                    ret = http_ret;
                }
            } else {
                ESP_LOGW(TAG, "HTTP episode fetch failed for %s: %s",
                         podcast->id, esp_err_to_name(http_ret));
                ret = http_ret;
            }
        }
    }

    if (ret != ESP_OK && ret != ESP_ERR_HTTP_CONNECT && ret != ESP_ERR_NO_MEM) {
        char fallback_url[PODCAST_URL_MAX];
        build_downloads_rss_url_from_id(podcast->id, fallback_url, sizeof(fallback_url));
        ESP_LOGI(TAG, "Retrying episodes for %s via %s", podcast->id, fallback_url);

        memset(buf.buf, 0, buf.cap);
        buf.len = 0;

        esp_err_t fallback_ret = fetch_episode_feed_prefix(fallback_url, &buf);
        if (fallback_ret == ESP_OK) {
            fallback_ret = parse_rss_episodes(buf.buf, podcast);
            if (fallback_ret == ESP_OK) {
                ESP_LOGI(TAG, "Loaded %zu episodes for %s via fallback", podcast->_episode_count, podcast->id);
                ret = ESP_OK;
            } else {
                ESP_LOGW(TAG, "Fallback episode parse failed for %s: %s",
                         podcast->id, esp_err_to_name(fallback_ret));
                ret = fallback_ret;
            }
        } else {
            ESP_LOGW(TAG, "Fallback episode fetch failed for %s: %s",
                     podcast->id, esp_err_to_name(fallback_ret));
            ret = fallback_ret;
        }
    }

    if (ret != ESP_OK) {
        podcast->_episodes = NULL;
        podcast->_episode_count = 0;
    }

    free(buf.buf);
    return ret;
}

episode_t *podcast_get_episodes(podcast_t *podcast, size_t *count_out)
{
    if (count_out) *count_out = podcast->_episode_count;
    return (episode_t *)podcast->_episodes;
}

bool podcast_episodes_cached(const podcast_t *podcast)
{
    return podcast->_episodes != NULL;
}
