#include "bsp_display.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_lcd_panel_st7789.h"
#include "driver/spi_master.h"
#include "esp_log.h"
#include "esp_check.h"

static const char *TAG = "bsp_display";

esp_err_t bsp_display_brightness_init(void)
{
    ledc_timer_config_t timer = {
        .duty_resolution = LEDC_TIMER_10_BIT,
        .freq_hz         = 5000,
        .speed_mode      = LEDC_LOW_SPEED_MODE,
        .timer_num       = LEDC_TIMER_0,
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    ESP_RETURN_ON_ERROR(ledc_timer_config(&timer), TAG, "Backlight timer init failed");

    ledc_channel_config_t channel = {
        .gpio_num   = BSP_LCD_BL,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel    = LEDC_CHANNEL_0,
        .timer_sel  = LEDC_TIMER_0,
        .duty       = 1023,
        .hpoint     = 0,
    };
    ESP_RETURN_ON_ERROR(ledc_channel_config(&channel), TAG, "Backlight channel init failed");
    return ESP_OK;
}

esp_err_t bsp_display_init(esp_lcd_panel_handle_t    *panel_handle,
                            esp_lcd_panel_io_handle_t *io_handle)
{
    /* ── SPI bus ──────────────────────────────────────────────────── */
    spi_bus_config_t buscfg = {
        .mosi_io_num     = BSP_LCD_MOSI,
        .miso_io_num     = GPIO_NUM_NC,
        .sclk_io_num     = BSP_LCD_SCLK,
        .quadwp_io_num   = GPIO_NUM_NC,
        .quadhd_io_num   = GPIO_NUM_NC,
        .max_transfer_sz = BSP_LCD_H_RES * BSP_LCD_DRAW_BUF_LINES * sizeof(uint16_t),
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(BSP_LCD_SPI_HOST, &buscfg, SPI_DMA_CH_AUTO),
                        TAG, "SPI bus init failed");

    /* ── Panel I/O (SPI) ─────────────────────────────────────────── */
    esp_lcd_panel_io_spi_config_t io_cfg = {
        .dc_gpio_num       = BSP_LCD_DC,
        .cs_gpio_num       = BSP_LCD_CS,
        .pclk_hz           = BSP_LCD_PIXEL_CLK_HZ,
        .lcd_cmd_bits      = 8,
        .lcd_param_bits    = 8,
        .spi_mode          = 3,
        .trans_queue_depth = 10,
    };
    ESP_RETURN_ON_ERROR(
        esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)BSP_LCD_SPI_HOST, &io_cfg, io_handle),
        TAG, "Panel IO init failed");

    /* ── Waveshare panel: ST7789 over SPI. */
    esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num   = BSP_LCD_RST,
        .rgb_ele_order    = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel   = 16,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_st7789(*io_handle, &panel_cfg, panel_handle),
                        TAG, "Panel create failed");

    ESP_ERROR_CHECK(esp_lcd_panel_reset(*panel_handle));
    ESP_ERROR_CHECK(esp_lcd_panel_init(*panel_handle));
    ESP_ERROR_CHECK(esp_lcd_panel_mirror(*panel_handle, false, true));
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(*panel_handle, true));
    ESP_ERROR_CHECK(esp_lcd_panel_set_gap(*panel_handle, 0, 0));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(*panel_handle, true));

    ESP_LOGI(TAG, "Display initialised (%dx%d)", BSP_LCD_H_RES, BSP_LCD_V_RES);
    return ESP_OK;
}

esp_err_t bsp_display_brightness_set(int percent)
{
    if (percent < 0)   percent = 0;
    if (percent > 100) percent = 100;
    uint32_t duty = (1023 * percent) / 100;
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
    return ESP_OK;
}
