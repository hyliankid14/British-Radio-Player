#include "subscriptions.h"
#include "tf_card.h"
#include "config.h"
#include "esp_log.h"
#include <stdio.h>
#include <ctype.h>
#include <string.h>
#include <stdlib.h>
#include <dirent.h>
#include <sys/stat.h>

static const char *TAG = "subscriptions";

#define SUBS_IDS_FILE BSP_SD_MOUNT_POINT "/subscriptions.txt"
#define SUBS_IDS_FILE_ALT BSP_SD_MOUNT_POINT "/esp32/subscriptions.txt"
#define SUBS_IDS_FILE_MAIN BSP_SD_MOUNT_POINT "/main/subscriptions.txt"
#define SUBS_IDS_FILE_ESP32_MAIN BSP_SD_MOUNT_POINT "/esp32/main/subscriptions.txt"

#define SUBS_DISCOVERY_MAX_DEPTH 4

static subscribed_podcast_t s_subs[SUBSCRIPTIONS_MAX];
static podcast_t            s_sub_podcasts[SUBSCRIPTIONS_MAX];
static size_t               s_count = 0;

static bool add_subscription(const char *pid, const char *title, const char *rss_url);
static void trim_line(char *line);

extern const char _binary_subscriptions_txt_start[];
extern const char _binary_subscriptions_txt_end[];

static bool is_wokwi_environment(void)
{
    return strcmp(WIFI_SSID, "Wokwi-GUEST") == 0;
}

static bool sd_card_root_is_empty(void)
{
    DIR *dir = opendir(BSP_SD_MOUNT_POINT);
    if (!dir) {
        return false;
    }

    struct dirent *entry = NULL;
    while ((entry = readdir(dir)) != NULL) {
        if (strcmp(entry->d_name, ".") != 0 && strcmp(entry->d_name, "..") != 0) {
            closedir(dir);
            return false;
        }
    }

    closedir(dir);
    return true;
}

static esp_err_t load_subscriptions_from_embedded(void)
{
    const char *start = _binary_subscriptions_txt_start;
    const char *end = _binary_subscriptions_txt_end;
    if (!start || !end || end <= start) {
        return ESP_ERR_NOT_FOUND;
    }

    ESP_LOGI(TAG, "Loading subscriptions from embedded simulator fallback");

    size_t len = (size_t)(end - start);
    char *buf = malloc(len + 1);
    if (!buf) {
        return ESP_ERR_NO_MEM;
    }

    memcpy(buf, start, len);
    buf[len] = '\0';

    char *saveptr = NULL;
    char *line = strtok_r(buf, "\r\n", &saveptr);
    while (line) {
        char local[128];
        strncpy(local, line, sizeof(local) - 1);
        local[sizeof(local) - 1] = '\0';

        char *comment = strchr(local, '#');
        if (comment) {
            *comment = '\0';
        }

        trim_line(local);
        if (local[0] != '\0') {
            add_subscription(local, NULL, NULL);
        }

        line = strtok_r(NULL, "\r\n", &saveptr);
    }

    free(buf);
    return ESP_OK;
}

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

static bool find_subscriptions_file_recursive(const char *dir_path, char *out_path, size_t out_len, int depth)
{
    if (!dir_path || !out_path || out_len == 0 || depth > SUBS_DISCOVERY_MAX_DEPTH) {
        return false;
    }

    DIR *dir = opendir(dir_path);
    if (!dir) {
        return false;
    }

    struct dirent *entry = NULL;
    while ((entry = readdir(dir)) != NULL) {
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
            continue;
        }

        char full_path[256];
        int n = snprintf(full_path, sizeof(full_path), "%s/%s", dir_path, entry->d_name);
        if (n <= 0 || (size_t)n >= sizeof(full_path)) {
            continue;
        }

        struct stat st;
        if (stat(full_path, &st) != 0) {
            continue;
        }

        if (S_ISREG(st.st_mode) && strcmp(entry->d_name, "subscriptions.txt") == 0) {
            strncpy(out_path, full_path, out_len - 1);
            out_path[out_len - 1] = '\0';
            closedir(dir);
            return true;
        }

        if (S_ISDIR(st.st_mode)) {
            if (find_subscriptions_file_recursive(full_path, out_path, out_len, depth + 1)) {
                closedir(dir);
                return true;
            }
        }
    }

    closedir(dir);
    return false;
}

static esp_err_t load_subscriptions_from_ids_path(const char *path)
{
    FILE *f = fopen(path, "r");
    if (!f) {
        return ESP_ERR_NOT_FOUND;
    }

    ESP_LOGI(TAG, "Loading subscriptions from %s", path);

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

static esp_err_t load_subscriptions_from_known_paths(const char *const *paths, size_t path_count)
{
    esp_err_t first_error = ESP_ERR_NOT_FOUND;
    for (size_t i = 0; i < path_count; i++) {
        esp_err_t ret = load_subscriptions_from_ids_path(paths[i]);
        if (ret == ESP_OK) {
            return ESP_OK;
        }
        if (ret != ESP_ERR_NOT_FOUND && first_error == ESP_ERR_NOT_FOUND) {
            first_error = ret;
        }
    }

    return first_error;
}

static esp_err_t load_subscriptions_from_ids(void)
{
    static const char *sd_paths[] = {
        SUBS_IDS_FILE,
        SUBS_IDS_FILE_MAIN,
        SUBS_IDS_FILE_ALT,
        SUBS_IDS_FILE_ESP32_MAIN,
    };

    esp_err_t ret = load_subscriptions_from_known_paths(sd_paths, sizeof(sd_paths) / sizeof(sd_paths[0]));
    if (ret == ESP_OK) {
        return ESP_OK;
    }

    if (tf_card_is_mounted()) {
        char discovered_path[256] = {0};
        if (find_subscriptions_file_recursive(BSP_SD_MOUNT_POINT, discovered_path, sizeof(discovered_path), 0)) {
            ESP_LOGI(TAG, "Discovered subscriptions file at %s", discovered_path);
            return load_subscriptions_from_ids_path(discovered_path);
        }
    }

    if (is_wokwi_environment() && tf_card_is_mounted() && sd_card_root_is_empty()) {
        ESP_LOGI(TAG, "Wokwi empty SD card detected; trying embedded simulator subscriptions.txt");
        return load_subscriptions_from_embedded();
    }

    return ret;
}

esp_err_t subscriptions_load(void)
{
    s_count = 0;
    memset(s_subs, 0, sizeof(s_subs));
    memset(s_sub_podcasts, 0, sizeof(s_sub_podcasts));

    if (!tf_card_is_mounted()) {
        ESP_LOGW(TAG, "TF card not mounted at subscriptions load; retrying mount");
        tf_card_mount();
        if (!tf_card_is_mounted()) {
            ESP_LOGW(TAG, "TF card still not mounted — no subscriptions loaded");
            return ESP_OK;
        }
    }

    esp_err_t ids_ret = load_subscriptions_from_ids();
    if (ids_ret == ESP_OK) {
        ESP_LOGI(TAG, "Loaded subscriptions from text file");
    } else if (ids_ret == ESP_ERR_NOT_FOUND) {
        ESP_LOGI(TAG, "No subscriptions.txt found on TF card (checked known paths and recursive discovery)");
        return ESP_OK;
    } else {
        return ids_ret;
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
