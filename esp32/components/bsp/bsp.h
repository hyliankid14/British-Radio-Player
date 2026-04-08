#pragma once

/**
 * Master BSP header for Waveshare ESP32-S3-Touch-LCD-1.54.
 *
 * Include this single header to access all board support functions.
 */

#include "bsp_display.h"
#include "bsp_touch.h"
#include "bsp_imu.h"
#include "bsp_codec.h"
#include "bsp_power_manager.h"

/* ── Shared I2C bus ─────────────────────────────────────────────── */
#include "driver/i2c_master.h"

#define BSP_I2C_PORT      I2C_NUM_0
#define BSP_I2C_SDA_GPIO  GPIO_NUM_42
#define BSP_I2C_SCL_GPIO  GPIO_NUM_41
#define BSP_I2C_FREQ_HZ   400000

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialise the shared I2C master bus used by touch, IMU and codec.
 * Returns the bus handle used by all I2C peripherals.
 */
i2c_master_bus_handle_t bsp_i2c_init(void);

#ifdef __cplusplus
}
#endif
