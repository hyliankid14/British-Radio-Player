# BBC Radio Player – ESP32-S3 Port

A simplified BBC Radio Player for the
[Waveshare ESP32-S3-Touch-LCD-1.54](https://www.waveshare.com/wiki/ESP32-S3-Touch-LCD-1.54)
(ESP32-S3R8, 240 × 240 ST7789 display, CST816S touch, QMI8658 IMU, ES8311 audio).

Features:
- Browse and stream all 16 national BBC Radio stations (live HLS)
- Browse Popular / Subscribed / New podcasts
- Shake to play a random podcast episode (real hardware only)
- TF card for offline subscription list (`subscriptions.txt` or `subscriptions.json`)

---

## Wokwi emulator quick-start (no hardware needed)

The fastest way to test the UI and data fetching in VS Code.

### 1. Prerequisites

| Tool | Version | Install |
|---|---|---|
| VS Code | latest | [code.visualstudio.com](https://code.visualstudio.com) |
| ESP-IDF extension | ≥ 1.9 | VS Code marketplace: `espressif.esp-idf-extension` |
| Wokwi for VS Code | latest | VS Code marketplace: `wokwi.wokwi-vscode` |
| ESP-IDF SDK | 5.5.1 | via the ESP-IDF extension installer |

### 2. Configure credentials

```bash
cp esp32/main/config.h.example esp32/main/config.h
```

The defaults already use `Wokwi-GUEST` (no password), which is correct for the
emulator.  Leave them as-is for now.

### 3. Build

Open the `esp32/` folder in the ESP-IDF terminal (or use the ESP-IDF extension
build button):

```bash
cd esp32
idf.py build
```

The first build downloads managed components from the IDF Component Registry and
may take several minutes.

### 4. Run in Wokwi

1. Open `esp32/diagram.json` in VS Code.
2. A **Start Simulation** button appears in the editor toolbar — click it.
3. The 240 × 240 display panel renders in the Wokwi panel.
4. Navigate using the three virtual buttons:
   | Button | Action |
   |---|---|
   | **PLUS** (green) | Next item in list |
   | **BOOT** (blue) | Select / confirm |
   | **PWR** (red) | Go back |

> **What works in Wokwi**
> - Display rendering (full LVGL UI)
> - WiFi connection + HTTP fetching (BBC OPML, GCS rankings)
> - Station list (all 16 stations shown; select plays an audible tone)
> - Podcast browsing (Popular / Subscribed / New tabs)
> - Button navigation
> - Audible buzzer output for playback feedback
>
> **What is stubbed**
> - Full stream audio decode — playback currently uses generated tones rather
>   than decoded BBC audio. Real HLS/AAC or MP3 playback still needs an HTTP
>   fetch + decode pipeline.
> - Touch (CST816S) — I2C device absent; use buttons instead.
> - Shake detection (QMI8658) — IMU absent; task exits gracefully.

---

## Real hardware build

### Additional setup

```bash
# Install ESP-ADF (optional, for full stream decode)
# https://docs.espressif.com/projects/esp-adf/en/latest/get-started/index.html
```

Edit `main/config.h` with your actual WiFi credentials.

### Flash

```bash
idf.py -p /dev/ttyUSB0 flash monitor
```

### SD card (subscriptions)

Format a TF card as FAT32. The simplest option is `/subscriptions.txt` with one
BBC podcast ID per line:

```text
# One BBC podcast ID per line
b006qnmr
p02nq0lx
```

Insert the card before powering on.

The older JSON format is still supported as `/subscriptions.json`:

```json
{
  "subscribed": [
    {
      "id": "p02nq0lx",
      "title": "Desert Island Discs",
      "rss_url": "https://feeds.bbci.co.uk/programmes/b006qnmr/episodes/downloads.rss"
    }
  ]
}
```

---

## Project layout

```
esp32/
├── CMakeLists.txt          Top-level ESP-IDF project
├── sdkconfig.defaults      Board-specific build config
├── partitions.csv          Flash partition table
├── wokwi.toml              Wokwi emulator config
├── diagram.json            Wokwi circuit diagram
├── components/
│   ├── bsp/                Board Support Package (GPIO, I2C, SPI, I2S)
│   ├── lvgl_port/          LVGL 8.x integration via esp_lvgl_port
│   └── tf_card/            SDMMC TF card mount
└── main/
    ├── config.h.example    Credentials template (copy → config.h)
    ├── main.c              App entry point
    ├── ui/                 LVGL screens
    ├── audio/              Playback pipeline + state
    ├── data/               Stations, podcast index, rankings, subscriptions
    └── shake/              QMI8658 shake detector
```

---

## GPIO pin reference (Waveshare ESP32-S3-Touch-LCD-1.54)

| Peripheral | Signal | GPIO |
|---|---|---|
| LCD SPI | MOSI | 39 |
| LCD SPI | SCLK | 38 |
| LCD SPI | CS | 21 |
| LCD SPI | DC | 45 |
| LCD SPI | RST | 40 |
| LCD backlight | PWM | 46 |
| I2C (touch/IMU/codec) | SDA | 42 |
| I2C (touch/IMU/codec) | SCL | 41 |
| Touch CST816S | INT | 48 |
| Touch CST816S | RST | 47 |
| Audio I2S | MCLK | 8 |
| Audio I2S | BCLK | 9 |
| Audio I2S | LRCK | 10 |
| Audio I2S | DOUT (→ DAC) | 12 |
| Audio I2S | DIN (← ADC) | 11 |
| PA enable | — | 7 |
| SDMMC | CLK | 16 |
| SDMMC | CMD | 15 |
| SDMMC | D0–D3 | 17, 18, 13, 14 |
| Button BOOT | — | 0 |
| Button PWR | — | 5 |
| Button PLUS | — | 4 |

---

## Current audio status

- Wokwi: audible playback via the virtual buzzer.
- Real hardware: audible playback via ES8311 + I2S + PA.
- Full BBC stream decoding is not implemented yet; current playback is a tone
  generator so both environments produce real sound.
