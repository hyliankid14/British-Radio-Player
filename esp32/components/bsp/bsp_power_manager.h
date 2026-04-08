#pragma once

#include "esp_err.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Assert the board's battery hold pin so battery-powered operation stays latched on. */
esp_err_t bsp_power_manager_init(void);

/* Returns battery voltage in volts, or negative on read failure. */
float bsp_get_battery_voltage(void);

/* Returns battery level 1-100, or -1 when unavailable. */
int bsp_get_battery_level(void);

/* Returns true while battery charging is detected. */
bool bsp_is_charging(void);

/* Release the board's battery hold pin. */
void bsp_power_off(void);

#ifdef __cplusplus
}
#endif