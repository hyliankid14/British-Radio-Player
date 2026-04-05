# British Radio Player

An unofficial Android client for BBC Radio and podcasts. It focuses on
reliable streaming on phones and Android Auto, offering a clean Material 3
interface with useful features for listeners.
## 📥 Download

**[Get the latest release](https://github.com/hyliankid14/British-Radio-Player/releases)** - Download APK for your device

## 📸 Screenshots

<p align="center">
  <img src="docs/screenshots/Screenshot_20260301_221020_British Radio Player.jpg" width="150" alt="Favorites - Dark Mode" />
  <img src="docs/screenshots/Screenshot_20260301_221037_British Radio Player.jpg" width="150" alt="All Stations - Light Mode" />
  <img src="docs/screenshots/Screenshot_20260301_221048_British Radio Player.jpg" width="150" alt="Podcasts Browser" />
  <img src="docs/screenshots/Screenshot_20260301_225106_British Radio Player.jpg" width="150" alt="Podcast Search" />
</p>

<p align="center">
  <img src="docs/screenshots/Screenshot_20260301_225120_British Radio Player.jpg" width="150" alt="Settings" />
  <img src="docs/screenshots/Screenshot_20260301_225144_British Radio Player.jpg" width="150" alt="Favorite Episodes" />
  <img src="docs/screenshots/Screenshot_20260301_225421_British Radio Player.jpg" width="150" alt="Podcast Subscriptions - Light Mode" />
  <img src="docs/screenshots/Screenshot_20260301_230842_British Radio Player.jpg" width="150" alt="Screen 8" />
</p>

<p align="center">
  <img src="docs/screenshots/Screenshot_20260301_230901_British Radio Player.jpg" width="150" alt="Screen 9" />
  <img src="docs/screenshots/Screenshot_20260301_232642_British Radio Player.jpg" width="150" alt="Screen 10" />
  <img src="docs/screenshots/Screenshot_20260301_232649_British Radio Player.jpg" width="150" alt="Screen 11" />
</p>


## Features

### Radio & Android Auto
- Browse the full BBC station catalogue (national, regional, local) and
  podcast collections with BBC-branding-free generic station artwork.
- Rich metadata includes show name, current track and artwork on phone and in
  your car.
- Favourite stations/episodes, resume playback automatically when you connect
  to Android Auto, and control playback from your head unit.
- Stops playback cleanly when the app is swiped away from recents.

### Podcasts
- Search and subscribe to BBC podcasts; save or download individual episodes.
- Per-podcast new-episode notifications, configurable refresh intervals, and
  background cloud-index sync (Google Cloud Storage) to keep the list
  current without draining data.
- Analytics-powered “Most Popular” sort using a GCS snapshot updated every
  6 hours; “New Podcasts” sort tracks podcasts added since your first install.
- Progress is tracked; episodes resume where you left off and the next one
  can autoplay. Downloaded episodes play offline and can auto‑delete.
- Hide played episodes toggle; collapsible played-episodes section.

### Downloads & History
- Automatic downloads with Wi‑Fi‑only and per‑podcast limits (1‑10 episodes).
- Batch management and a 20‑item playback history that shows progress and
  supports replaying episodes.
- Recently Played Songs tab with streaming service deep-links.

### Wear OS
- Companion Wear OS app bundled in every release as a separate APK.
- Playback controls and episode metadata on your watch.

### Interface & Settings
- Material 3 light/dark theme with purple accent, edge-to-edge display, and
  adaptive layouts for phones and tablets.
- Drag‑and‑drop favourites, persistent mini player and a full Now Playing
  screen with artwork, share button and seekbar.
- Audio quality switching (with network-based recommendations),
  export/import of preferences, and flexible podcast/Android Auto options.
- VPN-detected warning banner; shake-to-shuffle gesture.
- Powered by AndroidX Media3 for rock-solid HLS streaming.

## Quick start

```bash
git clone https://github.com/yourname/British-Radio-Player.git
cd British-Radio-Player

# build a debug APK
./gradlew assembleDebug
```

Open the project in Android Studio (2023.2+), or use the CI deploy script
`./scripts/deploy.sh` to build and sideload via `adb`.

## Local USB Debug Deploy (macOS/Linux)

Run the local environment setup once:

```bash
./scripts/setup-local-build.sh
```

Then build and install a debug APK to a USB-connected Android device:

```bash
./scripts/local-deploy.sh
```

## Google Cloud Index Migration

To migrate podcast index hosting/search from GitHub Pages to Google Cloud
(GCS + Cloud Function + Cloud Run Scheduler), run:

```bash
./scripts/setup-google-cloud-index.sh \
  --project british-radio-player \
  --bucket YOUR_GLOBALLY_UNIQUE_BUCKET \
  --region europe-west2 \
  --mode cloud-run \
  --write-local-properties
```

Full manual and troubleshooting steps are in `api/GOOGLE_CLOUD_SETUP.md`.

Notes:
- On macOS, the script uses Homebrew and the default SDK path `~/Library/Android/sdk`.
- If the device is visible in `adb devices`, the script installs in place with `adb install -r -d`.
- If an install fails due to signing mismatch, it falls back to uninstall + clean install.

## Requirements

- Android API 21+ (Lollipop) with API 33+ recommended; Wear OS requires API 30+
- Kotlin 1.9 or later
- AndroidX Media3 1.4+ (replaces legacy ExoPlayer), Material 3 Components, WorkManager for background tasks

## Changelog
- **v1.6.2** (Apr 2026): Migrate to AndroidX Media3 ExoPlayer; fix duplicate analytics events; add option to exclude debug builds from analytics; enforce 10-second listen threshold before counting podcast plays; stop playback on swipe-to-dismiss; fix Android Auto podcast resume; extend recent searches limit to 30.
- **v1.6.1**: Search overhaul — result counts in section headers, podcast genre search, loading indicator, improved back navigation, and stale download-icon fix. New-podcast catalogue notifications fixed. TF card subscription fallback and SDSPI mount support (ESP32 companion).
- **v1.6.0**: Wear OS companion app added (separate APK bundled in every release); improved build and signing pipeline for phone + Wear simultaneous releases.
- **v1.5.6**: Shake-to-shuffle detection; Radio 5 Live stream URL updated to prioritised lsn.lv UK streams; VPN warning banner (dismissible); artwork fallback improvements; auto-update check for GitHub releases; per-podcast new-episode notifications.
- **v1.5.5**: Edge-to-edge display on all activities; stations reorganised into national / regional / local categories; popular podcasts cache TTL aligned with 6-hour GCS snapshot cadence; BBC-branding-free generic station artwork; fixed “Most popular” sort not reflecting updated analytics.
- **v1.5.4**: Podcast index summary caching for fast “New Podcasts” and “Most Popular” sorts; GCS popularity snapshot (uploaded every 6 hours); improved artwork loading across all screens.
- **v1.5.3**: Stuck-download recovery on startup; BBC Radio 5 Sports Extra added; audio-quality dropdown with network-based recommendations.
- **v1.5.0–v1.5.2**: Rebrand to **British Radio Player** for Google Play; podcast index migrated to Google Cloud Storage + Cloud Function; cloud-search replaces local indexing; iOS app core added; Recently Played Songs tab with streaming service deep-links; word-boundary search matching; schedule viewer with podcast link; saved-search back-navigation fixes.
- **v1.4.0** (Mar 2026): Podcast improvements, playback and station updates, and interface refinements.
- **v1.3.0**: Improved indexing system, faster performance, Android Auto enhancements, widget support and various fixes.
- **v1.2.2**: Podcast improvements, playback and station updates, and interface refinements.
- **v1.2.0**: Added alarm feature and various UI improvements.
- **v1.1.0**: Added alternative BBC Radio 5 Live and Sports Extra links (credit u/Cool-Bus2696), auto updater and various fixes.
- **v1.0.12** (Mar 2026): New icon (credit u/mrnedryerson), added BBC Radio 1 Anthems, Radio 3 Unwind, UI tweaks.
- **v1.0.7**: Dual GitHub APK variants (Android Auto + No-Google), release automation, and metadata sync improvements.
- **v1.0.1** (Feb 2026): Major release with stability improvements and bug fixes.
- **v0.12.0**: Next-show info, intelligent colour theming, refactored date handling and indexing, improved playback options, UI tweaks.
- **v0.11.0**: Saved searches, full podcast descriptions, playback enhancements.
- **v0.10.0**: Episode download system, backup/restore.
- **v0.9–v0.9.7**: Episode sharing with URL shortening and web player integration; GitHub release automation; JDK 21 requirement; audio focus fixes.
- Earlier releases added podcasts, sharing, history, notifications, and Android Auto support.

## Contributing

Issues and pull requests are welcome. See the repo for ideas such as sleep
timers, widgets, CarPlay ports, or support for other radio networks.

## License

This project is licensed under the GNU General Public License v3.0.
See [LICENSE](LICENSE).

Unofficial third‑party app. BBC and station trademarks are owned by the British
Broadcasting Corporation. Streams use public BBC APIs. No affiliation or
endorsement intended.

