#pragma once

#include "esp_err.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "driver/gpio.h"
#include "driver/ledc.h"

/* ── Waveshare LCD (ST7789, 4-wire SPI) ─────────────────────────── */
#define BSP_LCD_SPI_HOST        SPI2_HOST
#define BSP_LCD_PIXEL_CLK_HZ    (40 * 1000 * 1000)

#define BSP_LCD_MOSI            GPIO_NUM_39
#define BSP_LCD_SCLK            GPIO_NUM_38
#define BSP_LCD_CS              GPIO_NUM_21
#define BSP_LCD_DC              GPIO_NUM_45
#define BSP_LCD_RST             GPIO_NUM_40
#define BSP_LCD_BL              GPIO_NUM_46

#define BSP_LCD_H_RES           240
#define BSP_LCD_V_RES           240
#define BSP_LCD_DRAW_BUF_LINES  50      /* lines per DMA draw buffer */
/* Exact panel origin (safe bounds; no artefacts). */
#define BSP_LCD_X_GAP          (0)
#define BSP_LCD_Y_GAP          (0)

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialise SPI bus, ILI9341 panel and backlight PWM.
 * On success, *panel_handle and *io_handle are populated.
 */
esp_err_t bsp_display_init(esp_lcd_panel_handle_t    *panel_handle,
                            esp_lcd_panel_io_handle_t *io_handle);

/** Initialise LEDC backlight PWM. */
esp_err_t bsp_display_brightness_init(void);

/** Set backlight brightness 0–100 %. */
esp_err_t bsp_display_brightness_set(int percent);

#ifdef __cplusplus
}
#endif
