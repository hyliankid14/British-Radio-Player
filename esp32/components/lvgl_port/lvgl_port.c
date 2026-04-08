#include "lvgl_port.h"
#include "bsp_display.h"
#include "esp_lvgl_port.h"
#include "esp_log.h"
#include "esp_check.h"

static const char *TAG = "lvgl_port";

esp_err_t bsp_lvgl_port_init(esp_lcd_panel_handle_t    panel_handle,
                              esp_lcd_panel_io_handle_t io_handle,
                              esp_lcd_touch_handle_t    touch_handle,
                              lv_disp_t               **disp_out)
{
    /* ── Initialise esp_lvgl_port infrastructure ──────────────────── */
    const lvgl_port_cfg_t port_cfg = ESP_LVGL_PORT_INIT_CONFIG();
    ESP_RETURN_ON_ERROR(lvgl_port_init(&port_cfg), TAG, "lvgl_port_init failed");

    /* ── Register display ─────────────────────────────────────────── */
    const lvgl_port_display_cfg_t disp_cfg = {
        .io_handle     = io_handle,
        .panel_handle  = panel_handle,
        .buffer_size   = BSP_LCD_H_RES * BSP_LCD_DRAW_BUF_LINES,
        .double_buffer = true,
        .hres          = BSP_LCD_H_RES,
        .vres          = BSP_LCD_V_RES,
        .monochrome    = false,
        .rotation = {
            .swap_xy  = false,
            .mirror_x = false,
            .mirror_y = false,
        },
        .flags = {
            .buff_dma = true,
        },
    };

    lv_disp_t *disp = lvgl_port_add_disp(&disp_cfg);
    if (disp == NULL) {
        ESP_LOGE(TAG, "Failed to add display to LVGL port");
        return ESP_FAIL;
    }
    if (disp_out) *disp_out = disp;

    /* ── Register touch (optional) ────────────────────────────────── */
    if (touch_handle != NULL) {
        const lvgl_port_touch_cfg_t touch_cfg = {
            .disp   = disp,
            .handle = touch_handle,
        };
        lv_indev_t *indev = lvgl_port_add_touch(&touch_cfg);
        if (indev == NULL) {
            ESP_LOGW(TAG, "Failed to register touch input device — continuing without touch");
        } else {
            ESP_LOGI(TAG, "Touch input registered");
        }
    } else {
        ESP_LOGI(TAG, "No touch handle — touch input disabled");
    }

    ESP_LOGI(TAG, "LVGL port ready");
    return ESP_OK;
}

bool bsp_lvgl_port_lock(uint32_t timeout_ms)
{
    return lvgl_port_lock(timeout_ms);
}

void bsp_lvgl_port_unlock(void)
{
    lvgl_port_unlock();
}
