#pragma once

#include "esp_err.h"
#include "driver/i2c_master.h"
#include <stdbool.h>

/* ── ES8311 output codec + ES7210 input codec ────────────────────── */
/* I2S pins shared with both chips                                     */
#define BSP_I2S_NUM      I2S_NUM_0
#define BSP_I2S_MCLK     GPIO_NUM_8
#define BSP_I2S_BCLK     GPIO_NUM_9
#define BSP_I2S_LRCK     GPIO_NUM_10
#define BSP_I2S_DOUT     GPIO_NUM_12   /* ESP → ES8311 DAC */
#define BSP_I2S_DIN      GPIO_NUM_11   /* ES7210 ADC → ESP */
#define BSP_PA_CTRL      GPIO_NUM_7    /* NS4150B PA enable, active-HIGH */

#define BSP_AUDIO_SAMPLE_RATE  44100
#define BSP_AUDIO_BITS         16
#define BSP_AUDIO_CHANNELS     2

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialise I2S + ES8311 output codec.
 * Returns ESP_OK even if the codec IC is absent (Wokwi).
 */
esp_err_t bsp_codec_init(i2c_master_bus_handle_t bus_handle);

/** Set output volume 0–100 %. */
esp_err_t bsp_codec_set_volume(int percent);

/** Returns true when the ES8311 output path is ready for PCM playback. */
bool bsp_codec_is_ready(void);

/**
 * Write a chunk of 16-bit PCM audio to the I2S TX channel.
 * No-op if the codec is absent.
 */
esp_err_t bsp_codec_write(const void *data, size_t bytes, size_t *written);

/**
 * Reconfigure I2S clock when the decoded stream's sample rate / channel count
 * differs from the default (44100 Hz stereo 16-bit).
 * Safe to call multiple times; no-op if settings are unchanged.
 */
esp_err_t bsp_codec_set_sample_info(uint32_t sample_rate, uint8_t channels, uint8_t bits_per_sample);

#ifdef __cplusplus
}
#endif
