#include "bsp_codec.h"
#include "driver/i2s_std.h"
#include "driver/gpio.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG    = "bsp_codec";
static i2s_chan_handle_t      s_tx_chan   = NULL;
static esp_codec_dev_handle_t s_codec_dev = NULL;
static bool                   s_ready     = false;

static esp_codec_dev_handle_t create_es8311_dev(const audio_codec_ctrl_if_t *ctrl_if,
                                                const audio_codec_data_if_t *data_if,
                                                const audio_codec_gpio_if_t *gpio_if,
                                                bool master_mode,
                                                bool use_mclk,
                                                int mclk_div)
{
    es8311_codec_cfg_t es8311_cfg = {
        .codec_mode = ESP_CODEC_DEV_WORK_MODE_DAC,
        .ctrl_if = ctrl_if,
        .gpio_if = gpio_if,
        .pa_pin = BSP_PA_CTRL,
        .pa_reverted = false,
        .master_mode = master_mode,
        .use_mclk = use_mclk,
        .digital_mic = false,
        .invert_mclk = false,
        .invert_sclk = false,
        .mclk_div = mclk_div,
    };

    const audio_codec_if_t *codec_if = es8311_codec_new(&es8311_cfg);
    if (codec_if == NULL) {
        return NULL;
    }

    esp_codec_dev_cfg_t dev_cfg = {
        .dev_type = ESP_CODEC_DEV_TYPE_OUT,
        .codec_if = codec_if,
        .data_if = data_if,
    };
    return esp_codec_dev_new(&dev_cfg);
}

static bool probe_codec_addr(i2c_master_bus_handle_t bus_handle, uint8_t *addr_out)
{
    /* i2c_master_probe uses 7-bit addresses. ES8311 is commonly 0x18 (8-bit 0x30). */
    const uint8_t candidates[] = {
        0x18,
        0x19,
    };

    for (size_t i = 0; i < (sizeof(candidates) / sizeof(candidates[0])); i++) {
        esp_err_t probe = i2c_master_probe(bus_handle, candidates[i], 1000);
        if (probe == ESP_OK) {
            *addr_out = candidates[i];
            return true;
        }
    }
    return false;
}

esp_err_t bsp_codec_init(i2c_master_bus_handle_t bus_handle)
{
    uint8_t codec_addr = ES8311_CODEC_DEFAULT_ADDR;

    /* In Wokwi there is no ES8311 on I2C, so skip codec and I2S bring-up early. */
    if (!probe_codec_addr(bus_handle, &codec_addr)) {
        ESP_LOGW(TAG, "ES8311 not detected on I2C (tried 7-bit 0x18/0x19) — audio codec disabled");
        return ESP_OK;
    }
    ESP_LOGI(TAG, "ES8311 detected at I2C addr 0x%02x (8-bit 0x%02x)",
             codec_addr, (codec_addr << 1));

    /* PA enable pin — drive low during init to avoid pop noise */
    gpio_config_t pa_cfg = {
        .pin_bit_mask = (1ULL << BSP_PA_CTRL),
        .mode         = GPIO_MODE_OUTPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    gpio_config(&pa_cfg);
    gpio_set_level(BSP_PA_CTRL, 0);

    /* I2S TX channel (output to DAC) */
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(BSP_I2S_NUM, I2S_ROLE_MASTER);
    chan_cfg.auto_clear_after_cb = true;

    esp_err_t ret = i2s_new_channel(&chan_cfg, &s_tx_chan, NULL);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "I2S channel create failed — audio disabled");
        return ESP_OK;   /* non-fatal */
    }

    i2s_std_config_t std_cfg = {
        .clk_cfg  = I2S_STD_CLK_DEFAULT_CONFIG(BSP_AUDIO_SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,
                                                        I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = BSP_I2S_MCLK,
            .bclk = BSP_I2S_BCLK,
            .ws   = BSP_I2S_LRCK,
            .dout = BSP_I2S_DOUT,
            .din  = I2S_GPIO_UNUSED,
        },
    };
    std_cfg.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;

    ret = i2s_channel_init_std_mode(s_tx_chan, &std_cfg);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "I2S std mode init failed — audio disabled");
        i2s_del_channel(s_tx_chan);
        s_tx_chan = NULL;
        return ESP_OK;
    }

    i2s_channel_enable(s_tx_chan);

    audio_codec_i2s_cfg_t i2s_cfg = {
        .port = BSP_I2S_NUM,
        .tx_handle = s_tx_chan,
    };
    const audio_codec_data_if_t *data_if = audio_codec_new_i2s_data(&i2s_cfg);
    if (data_if == NULL) {
        ESP_LOGW(TAG, "I2S data interface create failed — codec output disabled");
        return ESP_OK;
    }

    audio_codec_i2c_cfg_t i2c_cfg = {
        .port = 0,
        .addr = (codec_addr << 1),
        .bus_handle = bus_handle,
    };
    const audio_codec_ctrl_if_t *ctrl_if = audio_codec_new_i2c_ctrl(&i2c_cfg);
    if (ctrl_if == NULL) {
        ESP_LOGW(TAG, "I2C codec control create failed — codec output disabled");
        return ESP_OK;
    }

    const audio_codec_gpio_if_t *gpio_if = audio_codec_new_gpio();
    if (gpio_if == NULL) {
        ESP_LOGW(TAG, "Codec GPIO interface create failed — codec output disabled");
        return ESP_OK;
    }

    esp_codec_dev_sample_info_t fs = {
        .sample_rate = BSP_AUDIO_SAMPLE_RATE,
        .channel = BSP_AUDIO_CHANNELS,
        .channel_mask = 0x03,
        .bits_per_sample = BSP_AUDIO_BITS,
    };

    static const struct {
        bool master_mode;
        bool use_mclk;
        int mclk_div;
    } modes[] = {
        {false, true,  256},
        {false, false, 0},
        {true,  true,  256},
        {true,  false, 0},
    };

    bool opened = false;
    for (size_t i = 0; i < (sizeof(modes) / sizeof(modes[0])); i++) {
        s_codec_dev = create_es8311_dev(ctrl_if, data_if, gpio_if,
                                        modes[i].master_mode,
                                        modes[i].use_mclk,
                                        modes[i].mclk_div);
        if (s_codec_dev == NULL) {
            ESP_LOGW(TAG, "ES8311 device create failed (mode %u)", (unsigned)i);
            vTaskDelay(pdMS_TO_TICKS(50));   /* Brief delay before retry */
            continue;
        }

        int codec_ret = esp_codec_dev_open(s_codec_dev, &fs);
        if (codec_ret == ESP_CODEC_DEV_OK) {
            ESP_LOGI(TAG, "ES8311 opened (mode=%u master=%d mclk=%d)",
                     (unsigned)i,
                     modes[i].master_mode,
                     modes[i].use_mclk);
            opened = true;
            break;
        }

        ESP_LOGW(TAG, "ES8311 open failed (%d) mode=%u master=%d mclk=%d",
                 codec_ret,
                 (unsigned)i,
                 modes[i].master_mode,
                 modes[i].use_mclk);
        esp_codec_dev_delete(s_codec_dev);
        s_codec_dev = NULL;
        vTaskDelay(pdMS_TO_TICKS(50));   /* Brief delay before next mode attempt */
    }

    if (!opened) {
        ESP_LOGW(TAG, "ES8311 open failed in all modes — codec output disabled");
        return ESP_OK;
    }

    gpio_set_level(BSP_PA_CTRL, 1);   /* PA active-HIGH: enable after codec opens */
    esp_codec_dev_set_out_vol(s_codec_dev, 70);
    s_ready = true;
    ESP_LOGI(TAG, "ES8311 codec ready (%d Hz, %d-bit, %d ch)",
             BSP_AUDIO_SAMPLE_RATE, BSP_AUDIO_BITS, BSP_AUDIO_CHANNELS);
    return ESP_OK;
}

esp_err_t bsp_codec_set_volume(int percent)
{
    if (!s_ready || s_codec_dev == NULL) {
        return ESP_OK;
    }
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    esp_codec_dev_set_out_vol(s_codec_dev, percent);
    return ESP_OK;
}

bool bsp_codec_is_ready(void)
{
    return s_ready && s_codec_dev != NULL;
}

esp_err_t bsp_codec_write(const void *data, size_t bytes, size_t *written)
{
    if (!s_ready || s_codec_dev == NULL) {
        if (written) *written = bytes;   /* pretend it worked */
        return ESP_OK;
    }
    int ret = esp_codec_dev_write(s_codec_dev, (void *)data, (int)bytes);
    size_t w = ret == ESP_CODEC_DEV_OK ? bytes : 0;
    if (written) *written = w;
    if (ret != ESP_CODEC_DEV_OK) {
        ESP_LOGW(TAG, "esp_codec_dev_write failed: %d", ret);
    }
    return ret == ESP_CODEC_DEV_OK ? ESP_OK : ESP_FAIL;
}

static uint32_t s_current_sample_rate = BSP_AUDIO_SAMPLE_RATE;
static uint8_t  s_current_channels    = BSP_AUDIO_CHANNELS;
static uint8_t  s_current_bits        = BSP_AUDIO_BITS;

esp_err_t bsp_codec_set_sample_info(uint32_t sample_rate, uint8_t channels, uint8_t bits_per_sample)
{
    if (!s_ready || s_codec_dev == NULL || s_tx_chan == NULL) {
        return ESP_OK;
    }
    if (sample_rate == s_current_sample_rate &&
        channels    == s_current_channels    &&
        bits_per_sample == s_current_bits) {
        return ESP_OK;   /* already configured */
    }

    ESP_LOGI(TAG, "Reconfiguring I2S: %"PRIu32" Hz, %d ch, %d bit",
             sample_rate, channels, bits_per_sample);

    i2s_channel_disable(s_tx_chan);

    i2s_std_clk_config_t clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(sample_rate);
    clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
    i2s_channel_reconfig_std_clock(s_tx_chan, &clk_cfg);

    i2s_data_bit_width_t bit_width = (bits_per_sample == 32)
        ? I2S_DATA_BIT_WIDTH_32BIT : I2S_DATA_BIT_WIDTH_16BIT;
    i2s_slot_mode_t slot_mode = (channels == 1)
        ? I2S_SLOT_MODE_MONO : I2S_SLOT_MODE_STEREO;
    i2s_std_slot_config_t slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(bit_width, slot_mode);
    i2s_channel_reconfig_std_slot(s_tx_chan, &slot_cfg);

    i2s_channel_enable(s_tx_chan);

    /* Update codec device with new PCM format */
    esp_codec_dev_sample_info_t fs = {
        .sample_rate    = sample_rate,
        .channel        = channels,
        .bits_per_sample = bits_per_sample,
        .channel_mask   = (channels == 1) ? 0x01 : 0x03,
    };
    esp_codec_dev_close(s_codec_dev);
    esp_codec_dev_open(s_codec_dev, &fs);
    /* Restore PA and volume after reopen */
    gpio_set_level(BSP_PA_CTRL, 1);
    esp_codec_dev_set_out_vol(s_codec_dev, 70);

    s_current_sample_rate = sample_rate;
    s_current_channels    = channels;
    s_current_bits        = bits_per_sample;
    return ESP_OK;
}
