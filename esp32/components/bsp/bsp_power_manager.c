#include "bsp_power_manager.h"

#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_check.h"
#include "esp_log.h"
#include <math.h>

#define BSP_BAT_POWER_GPIO GPIO_NUM_2
#define BSP_BAT_CHG_GPIO   GPIO_NUM_3
#define BSP_BAT_ADC_GPIO   GPIO_NUM_1

static const char *TAG = "bsp_power";
static adc_oneshot_unit_handle_t s_adc_handle = NULL;
static adc_cali_handle_t s_cali_handle = NULL;
static adc_channel_t s_adc_channel = ADC_CHANNEL_0;
static bool s_has_cali = false;

static bool adc_calibration_init(adc_unit_t unit, adc_channel_t channel, adc_atten_t atten, adc_cali_handle_t *out)
{
    adc_cali_curve_fitting_config_t cfg = {
        .unit_id = unit,
        .chan = channel,
        .atten = atten,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    esp_err_t ret = adc_cali_create_scheme_curve_fitting(&cfg, out);
    return ret == ESP_OK;
}

esp_err_t bsp_power_manager_init(void)
{
    gpio_config_t chg_cfg = {
        .pin_bit_mask = 1ULL << BSP_BAT_CHG_GPIO,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    gpio_config(&chg_cfg);

    gpio_config_t io_conf = {
        .pin_bit_mask = 1ULL << BSP_BAT_POWER_GPIO,
        .mode         = GPIO_MODE_OUTPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };

    ESP_RETURN_ON_ERROR(gpio_config(&io_conf), "bsp_power", "Battery hold pin init failed");
    ESP_RETURN_ON_ERROR(gpio_set_level(BSP_BAT_POWER_GPIO, 1), "bsp_power", "Battery hold pin set failed");

    adc_oneshot_unit_init_cfg_t adc_unit_cfg = {
        .unit_id = ADC_UNIT_1,
        .ulp_mode = ADC_ULP_MODE_DISABLE,
    };
    ESP_RETURN_ON_ERROR(adc_oneshot_new_unit(&adc_unit_cfg, &s_adc_handle), TAG, "ADC unit init failed");

    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ESP_RETURN_ON_ERROR(adc_oneshot_config_channel(s_adc_handle, s_adc_channel, &chan_cfg), TAG, "ADC channel config failed");
    s_has_cali = adc_calibration_init(ADC_UNIT_1, s_adc_channel, chan_cfg.atten, &s_cali_handle);

    return ESP_OK;
}

float bsp_get_battery_voltage(void)
{
    if (s_adc_handle == NULL) return -1.0f;

    int raw = 0;
    ESP_ERROR_CHECK(adc_oneshot_read(s_adc_handle, s_adc_channel, &raw));

    if (s_has_cali && s_cali_handle) {
        int mv = 0;
        ESP_ERROR_CHECK(adc_cali_raw_to_voltage(s_cali_handle, raw, &mv));
        return (mv / 1000.0f) * 3.0f;
    }

    return -1.0f;
}

int bsp_get_battery_level(void)
{
    float v = bsp_get_battery_voltage();
    if (v < 0.0f) return -1;

    if (v < 3.52f) return 1;
    if (v < 3.64f) return 20;
    if (v < 3.76f) return 40;
    if (v < 3.88f) return 60;
    if (v < 4.00f) return 80;
    return 100;
}

bool bsp_is_charging(void)
{
    int level = bsp_get_battery_level();
    if (level == 100) return false;
    return gpio_get_level(BSP_BAT_CHG_GPIO) == 0;
}

void bsp_power_off(void)
{
    gpio_set_level(BSP_BAT_POWER_GPIO, 0);
}