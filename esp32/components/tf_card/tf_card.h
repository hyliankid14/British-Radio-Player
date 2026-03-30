#pragma once

#include "esp_err.h"
#include <stdbool.h>

/* SDMMC 4-bit mode pins */
#define BSP_SD_CLK   GPIO_NUM_16
#define BSP_SD_CMD   GPIO_NUM_15
#define BSP_SD_D0    GPIO_NUM_17
#define BSP_SD_D1    GPIO_NUM_18
#define BSP_SD_D2    GPIO_NUM_13
#define BSP_SD_D3    GPIO_NUM_14

/* SDSPI fallback pins (used in Wokwi simulation) */
#define BSP_SD_SPI_MOSI BSP_SD_CMD
#define BSP_SD_SPI_MISO BSP_SD_D0
#define BSP_SD_SPI_SCK  BSP_SD_CLK
#define BSP_SD_SPI_CS   BSP_SD_D3

#define BSP_SD_MOUNT_POINT  "/sdcard"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Mount the TF card at BSP_SD_MOUNT_POINT using SDMMC (4-bit mode).
 * Returns ESP_OK even if no card is inserted — subsequent file operations
 * will simply fail.  Non-fatal so the app continues without a card.
 */
esp_err_t tf_card_mount(void);

/** Unmount the TF card. */
esp_err_t tf_card_unmount(void);

/** Returns true if a card is currently mounted. */
bool tf_card_is_mounted(void);

#ifdef __cplusplus
}
#endif
