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
  podcast collections.
- Rich metadata includes show name, current track and artwork on phone and in
  your car.
- Favorite stations/episodes, resume playback automatically when you connect
  to Android Auto, and control playback from your head unit.

### Podcasts
- Search and subscribe to BBC podcasts; save or download individual episodes.
- Notifications for new episodes, configurable refresh intervals, and
  background indexing to keep the list current.
- Progress is tracked; episodes resume where you left off and the next one
  can autoplay. Downloaded episodes play offline and can auto‑delete.

### Downloads & History
- Automatic downloads with Wi‑Fi‑only and per‑podcast limits (1‑10 episodes).
- Batch management and a 20‑item playback history that shows progress and
  supports replaying episodes.

### Interface & Settings
- Material 3 light/dark theme with purple accent and adaptive layouts for
  phones/tablets.
- Drag‑and‑drop favorites, persistent mini player and a full Now Playing
  screen with artwork, share button and seekbar.
- Audio quality switching, export/import of preferences, and flexible
  podcast/Android Auto options.

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

- Android API 21+ (Lollipop) with API 33+ recommended
- Kotlin 1.9 or later
- ExoPlayer 2.18+, Material 3 Components, WorkManager for background tasks

## Changelog
- **v1.4.0** (Mar 2026): podcast improvements, playback and station updates, and interface refinements.
- **v1.3.0**: Improved indexing system, faster performance, Android Auto enhancements, Widget support and various fixes.
- **v1.2.2**: podcast improvements, playback and station updates, and interface refinements.
- **v1.2.0**: Added alarm feature and various UI improvements
- **v1.1.0**: Added alternative BBC Radio 5 Live and Sports Extra links (credit u/Cool-Bus2696), auto updater and various fixes
- **v1.0.12** (Mar 2026): New icon (credit u/mrnedryerson), added BBC Radio 1 Anthems, Radio 3 Unwind, UI tweaks
- **v1.0.7**: dual GitHub APK variants (Android Auto + No-Google), release automation, and metadata sync improvements
- **v1.0.3**: further improvements and bug fixes
- **v1.0.1** (Feb 2026): major release with stability improvements and bug fixes
- **v0.12.0**: added next-show info, intelligent color theming, refactored date handling and indexing, improved playback options, UI tweaks

- **v0.11.0**: saved searches, full podcast descriptions, playback
  enhancements
- **v0.10.0**: episode download system, backup/restore
- **v0.9.7**: APK signing & build tweaks
- **v0.9.6**: GitHub release automation, JDK 21 requirement,
  audio focus fixes
- **v0.9.5**: improved podcast search and UI responsiveness
- **v0.9**: episode sharing with URL shortening and web player integration
- earlier releases added podcasts, sharing, history, notifications, and
  Android Auto support

## Contributing

Issues and pull requests are welcome. See the repo for ideas such as sleep
timers, widgets, CarPlay ports, or support for other radio networks.

## License

This project is licensed under the GNU General Public License v3.0.
See [LICENSE](LICENSE).

Unofficial third‑party app. BBC and station trademarks are owned by the British
Broadcasting Corporation. Streams use public BBC APIs. No affiliation or
endorsement intended.

