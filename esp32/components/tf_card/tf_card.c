#include "tf_card.h"
#include "driver/sdmmc_host.h"
#include "driver/sdspi_host.h"
#include "driver/spi_master.h"
#include "sdmmc_cmd.h"
#include "esp_vfs_fat.h"
#include "esp_log.h"

static const char *TAG    = "tf_card";
static bool        s_mounted = false;
static bool        s_spi_bus_inited = false;
static int         s_spi_bus_host = -1;

static esp_err_t mount_via_sdspi_host(const esp_vfs_fat_sdmmc_mount_config_t *mount_cfg, int host_id)
{
    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    host.slot = host_id;

    ESP_LOGI(TAG, "Trying SDSPI fallback on host %d (MOSI=%d MISO=%d SCK=%d CS=%d)",
             host_id,
             BSP_SD_SPI_MOSI, BSP_SD_SPI_MISO, BSP_SD_SPI_SCK, BSP_SD_SPI_CS);

    spi_bus_config_t bus_cfg = {
        .mosi_io_num = BSP_SD_SPI_MOSI,
        .miso_io_num = BSP_SD_SPI_MISO,
        .sclk_io_num = BSP_SD_SPI_SCK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 4000,
    };

    if (s_spi_bus_inited && s_spi_bus_host != host.slot) {
        spi_bus_free(s_spi_bus_host);
        s_spi_bus_inited = false;
        s_spi_bus_host = -1;
    }

    if (!s_spi_bus_inited) {
        esp_err_t bus_ret = spi_bus_initialize(host.slot, &bus_cfg, SDSPI_DEFAULT_DMA);
        if (bus_ret != ESP_OK && bus_ret != ESP_ERR_INVALID_STATE) {
            ESP_LOGW(TAG, "SDSPI bus init failed (0x%x)", bus_ret);
            return bus_ret;
        }
        s_spi_bus_inited = true;
        s_spi_bus_host = host.slot;
    }

    sdspi_device_config_t slot_cfg = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot_cfg.gpio_cs = BSP_SD_SPI_CS;
    slot_cfg.host_id = host.slot;

    sdmmc_card_t *card = NULL;
    esp_err_t ret = esp_vfs_fat_sdspi_mount(BSP_SD_MOUNT_POINT, &host, &slot_cfg,
                                            mount_cfg, &card);
    if (ret != ESP_OK) {
        return ret;
    }

    s_mounted = true;
    ESP_LOGI(TAG, "TF card mounted via SDSPI at %s (%.1f MB)",
             BSP_SD_MOUNT_POINT,
             (float)((uint64_t)card->csd.capacity * card->csd.sector_size) / (1024 * 1024));
    return ESP_OK;
}

static esp_err_t mount_via_sdspi(const esp_vfs_fat_sdmmc_mount_config_t *mount_cfg)
{
    esp_err_t ret_spi2 = mount_via_sdspi_host(mount_cfg, SPI2_HOST);
    if (ret_spi2 == ESP_OK) {
        return ESP_OK;
    }

    esp_err_t ret_spi3 = mount_via_sdspi_host(mount_cfg, SPI3_HOST);
    if (ret_spi3 == ESP_OK) {
        return ESP_OK;
    }

    ESP_LOGW(TAG, "SDSPI mount failed on SPI2 (0x%x) and SPI3 (0x%x)", ret_spi2, ret_spi3);
    return ret_spi2 != ESP_OK ? ret_spi2 : ret_spi3;
}

esp_err_t tf_card_mount(void)
{
    esp_vfs_fat_sdmmc_mount_config_t mount_cfg = {
        .format_if_mount_failed = false,
        .max_files              = 8,
        .allocation_unit_size   = 16 * 1024,
    };

    sdmmc_host_t host = SDMMC_HOST_DEFAULT();
    host.max_freq_khz = SDMMC_FREQ_DEFAULT;

    sdmmc_slot_config_t slot_cfg = SDMMC_SLOT_CONFIG_DEFAULT();
    slot_cfg.clk  = BSP_SD_CLK;
    slot_cfg.cmd  = BSP_SD_CMD;
    slot_cfg.d0   = BSP_SD_D0;
    slot_cfg.d1   = BSP_SD_D1;
    slot_cfg.d2   = BSP_SD_D2;
    slot_cfg.d3   = BSP_SD_D3;
    slot_cfg.width = 4;
    slot_cfg.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;

    sdmmc_card_t *card;
    esp_err_t ret = esp_vfs_fat_sdmmc_mount(BSP_SD_MOUNT_POINT, &host, &slot_cfg,
                                             &mount_cfg, &card);
    if (ret == ESP_OK) {
        s_mounted = true;
        ESP_LOGI(TAG, "TF card mounted via SDMMC at %s (%.1f MB)",
                 BSP_SD_MOUNT_POINT,
                 (float)((uint64_t)card->csd.capacity * card->csd.sector_size) / (1024 * 1024));
        return ESP_OK;
    }

    ESP_LOGW(TAG, "SDMMC mount failed (0x%x), trying SDSPI fallback", ret);
    esp_err_t spi_ret = mount_via_sdspi(&mount_cfg);
    if (spi_ret != ESP_OK) {
        ESP_LOGW(TAG, "TF card mount failed (SDMMC=0x%x, SDSPI=0x%x) — continuing without card",
                 ret, spi_ret);
        return ESP_OK;   /* non-fatal */
    }

    return ESP_OK;
}

esp_err_t tf_card_unmount(void)
{
    if (!s_mounted) return ESP_OK;
    esp_err_t ret = esp_vfs_fat_sdcard_unmount(BSP_SD_MOUNT_POINT, NULL);
    if (ret == ESP_OK) s_mounted = false;
    return ret;
}

bool tf_card_is_mounted(void)
{
    return s_mounted;
}
