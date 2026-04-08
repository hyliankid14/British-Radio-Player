idf_component_register(
    SRCS
        "bsp_i2c.c"
        "bsp_display.c"
        "bsp_power_manager.c"
        "bsp_touch.c"
        "bsp_imu.c"
        "bsp_codec.c"
    INCLUDE_DIRS "."
    REQUIRES
        esp_lcd
        esp_lcd_ili9341
        esp_lcd_touch
        esp_adc
        driver
        esp_timer
        log
)
