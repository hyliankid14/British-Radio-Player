#include "subscriptions.h"
#include "tf_card.h"
#include "cJSON.h"
#include "esp_log.h"
#include <stdio.h>
#include <ctype.h>
#include <string.h>
#include <stdlib.h>

static const char *TAG = "subscriptions";

#define SUBS_JSON_FILE BSP_SD_MOUNT_POINT "/subscriptions.json"
#define SUBS_IDS_FILE BSP_SD_MOUNT_POINT "/subscriptions.txt"

static subscribed_podcast_t s_subs[SUBSCRIPTIONS_MAX];
static podcast_t            s_sub_podcasts[SUBSCRIPTIONS_MAX];
static size_t               s_count = 0;

static bool is_valid_bbc_pid(const char *pid)
{
    if (!pid) return false;
    size_t len = strlen(pid);
    if (len != 8) return false;

    if (!isalpha((unsigned char)pid[0])) {
        return false;
    }

    for (size_t i = 1; i < len; i++) {
        if (!islower((unsigned char)pid[i]) && !isdigit((unsigned char)pid[i])) {
            return false;
        }
    }
    return true;
}

static void build_rss_url_from_id(const char *pid, char *out, size_t out_len)
{
    snprintf(out, out_len, "https://podcasts.files.bbci.co.uk/%s.rss", pid);
}

static int find_subscription_index_by_id(const char *pid)
{
    for (size_t i = 0; i < s_count; i++) {
        if (strncmp(s_subs[i].id, pid, sizeof(s_subs[i].id)) == 0) {
            return (int)i;
        }
    }
    return -1;
}

static podcast_t *find_index_podcast_by_id(const char *pid)
{
    size_t count = 0;
    podcast_t *all = podcast_index_get_all(&count);
    if (!all) {
        return NULL;
    }

    for (size_t i = 0; i < count; i++) {
        if (strncmp(all[i].id, pid, PODCAST_ID_MAX) == 0) {
            return &all[i];
        }
    }
    return NULL;
}

static bool add_subscription(const char *pid, const char *title, const char *rss_url)
{
    if (!is_valid_bbc_pid(pid)) {
        ESP_LOGW(TAG, "Ignoring invalid subscription id: %s", pid ? pid : "(null)");
        return false;
    }

    if (find_subscription_index_by_id(pid) >= 0) {
        return false;
    }

    if (s_count >= SUBSCRIPTIONS_MAX) {
        ESP_LOGW(TAG, "Subscription list full; ignoring %s", pid);
        return false;
    }

    subscribed_podcast_t *sub = &s_subs[s_count];
    memset(sub, 0, sizeof(*sub));

    strncpy(sub->id, pid, sizeof(sub->id) - 1);
    if (title && title[0]) {
        strncpy(sub->title, title, sizeof(sub->title) - 1);
    } else {
        strncpy(sub->title, pid, sizeof(sub->title) - 1);
    }

    if (rss_url && rss_url[0]) {
        strncpy(sub->rss_url, rss_url, sizeof(sub->rss_url) - 1);
    } else {
        build_rss_url_from_id(pid, sub->rss_url, sizeof(sub->rss_url));
    }

    s_count++;
    return true;
}

static void trim_line(char *line)
{
    char *start = line;
    while (*start && isspace((unsigned char)*start)) {
        start++;
    }
    if (start != line) {
        memmove(line, start, strlen(start) + 1);
    }

    size_t len = strlen(line);
    while (len > 0 && isspace((unsigned char)line[len - 1])) {
        line[--len] = '\0';
    }
}

static esp_err_t load_subscriptions_from_ids(void)
{
    FILE *f = fopen(SUBS_IDS_FILE, "r");
    if (!f) {
        return ESP_ERR_NOT_FOUND;
    }

    char line[128];
    while (fgets(line, sizeof(line), f)) {
        char *comment = strchr(line, '#');
        if (comment) {
            *comment = '\0';
        }

        trim_line(line);
        if (line[0] == '\0') {
            continue;
        }

        add_subscription(line, NULL, NULL);
    }

    fclose(f);
    return ESP_OK;
}

static esp_err_t load_subscriptions_from_json(void)
{
    FILE *f = fopen(SUBS_JSON_FILE, "r");
    if (!f) {
        return ESP_ERR_NOT_FOUND;
    }

    fseek(f, 0, SEEK_END);
    long fsize = ftell(f);
    rewind(f);

    char *buf = malloc(fsize + 1);
    if (!buf) {
        fclose(f);
        return ESP_ERR_NO_MEM;
    }

    fread(buf, 1, fsize, f);
    buf[fsize] = '\0';
    fclose(f);

    cJSON *root = cJSON_Parse(buf);
    free(buf);

    if (!root) {
        ESP_LOGE(TAG, "Invalid JSON in subscriptions.json");
        return ESP_FAIL;
    }

    cJSON *arr = cJSON_GetObjectItemCaseSensitive(root, "subscribed");
    if (!arr || !cJSON_IsArray(arr)) {
        ESP_LOGW(TAG, "subscriptions.json missing 'subscribed' array");
        cJSON_Delete(root);
        return ESP_OK;
    }

    cJSON *item;
    cJSON_ArrayForEach(item, arr) {
        cJSON *jid  = cJSON_GetObjectItemCaseSensitive(item, "id");
        cJSON *jtit = cJSON_GetObjectItemCaseSensitive(item, "title");
        cJSON *jrss = cJSON_GetObjectItemCaseSensitive(item, "rss_url");

        add_subscription(
            cJSON_IsString(jid) ? jid->valuestring : NULL,
            cJSON_IsString(jtit) ? jtit->valuestring : NULL,
            cJSON_IsString(jrss) ? jrss->valuestring : NULL
        );
    }

    cJSON_Delete(root);
    return ESP_OK;
}

esp_err_t subscriptions_load(void)
{
    s_count = 0;
    memset(s_subs, 0, sizeof(s_subs));
    memset(s_sub_podcasts, 0, sizeof(s_sub_podcasts));

    if (!tf_card_is_mounted()) {
        ESP_LOGW(TAG, "TF card not mounted — no subscriptions loaded");
        return ESP_OK;
    }

    esp_err_t ids_ret = load_subscriptions_from_ids();
    if (ids_ret == ESP_OK) {
        ESP_LOGI(TAG, "Loaded subscriptions from subscriptions.txt");
    } else if (ids_ret != ESP_ERR_NOT_FOUND) {
        return ids_ret;
    }

    esp_err_t json_ret = load_subscriptions_from_json();
    if (json_ret == ESP_OK) {
        ESP_LOGI(TAG, "Loaded subscriptions from subscriptions.json");
    } else if (json_ret != ESP_ERR_NOT_FOUND) {
        return json_ret;
    }

    if (ids_ret == ESP_ERR_NOT_FOUND && json_ret == ESP_ERR_NOT_FOUND) {
        ESP_LOGI(TAG, "No subscriptions.txt or subscriptions.json found on TF card");
        return ESP_OK;
    }

    ESP_LOGI(TAG, "Loaded %zu subscriptions", s_count);
    return ESP_OK;
}

size_t subscriptions_count(void)
{
    return s_count;
}

const subscribed_podcast_t *subscriptions_get(size_t i)
{
    if (i >= s_count) return NULL;
    return &s_subs[i];
}

podcast_t *subscriptions_get_podcast(size_t i)
{
    if (i >= s_count) return NULL;

    podcast_t *indexed = find_index_podcast_by_id(s_subs[i].id);
    if (indexed) {
        return indexed;
    }

    podcast_t *pod = &s_sub_podcasts[i];
    memset(pod, 0, sizeof(*pod));
    strncpy(pod->id, s_subs[i].id, PODCAST_ID_MAX - 1);
    strncpy(pod->title, s_subs[i].title, PODCAST_TITLE_MAX - 1);
    strncpy(pod->rss_url, s_subs[i].rss_url, PODCAST_URL_MAX - 1);
    return pod;
}
