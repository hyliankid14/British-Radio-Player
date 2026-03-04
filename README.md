# BBC Radio Player

An unofficial Android client for BBC Radio and podcasts. It focuses on
reliable streaming on phones and Android Auto, offering a clean Material 3
interface with useful features for listeners.
## 📥 Download

**[Get the latest release](https://github.com/hyliankid14/bbc-radio-player/releases)** - Download APK for your device

## 📸 Screenshots

<p align="center">
  <img src="docs/screenshots/Screenshot_20260301_221020_BBC Radio Player.jpg" width="150" alt="Favorites - Dark Mode" />
  <img src="docs/screenshots/Screenshot_20260301_221037_BBC Radio Player.jpg" width="150" alt="All Stations - Light Mode" />
  <img src="docs/screenshots/Screenshot_20260301_221048_BBC Radio Player.jpg" width="150" alt="Podcasts Browser" />
  <img src="docs/screenshots/Screenshot_20260301_225106_BBC Radio Player.jpg" width="150" alt="Podcast Search" />
</p>

<p align="center">
  <img src="docs/screenshots/Screenshot_20260301_225120_BBC Radio Player.jpg" width="150" alt="Settings" />
  <img src="docs/screenshots/Screenshot_20260301_225144_BBC Radio Player.jpg" width="150" alt="Favorite Episodes" />
  <img src="docs/screenshots/Screenshot_20260301_225421_BBC Radio Player.jpg" width="150" alt="Podcast Subscriptions - Light Mode" />
  <img src="docs/screenshots/Screenshot_20260301_230842_BBC Radio Player.jpg" width="150" alt="Screen 8" />
</p>

<p align="center">
  <img src="docs/screenshots/Screenshot_20260301_230901_BBC Radio Player.jpg" width="150" alt="Screen 9" />
  <img src="docs/screenshots/Screenshot_20260301_232642_BBC Radio Player.jpg" width="150" alt="Screen 10" />
  <img src="docs/screenshots/Screenshot_20260301_232649_BBC Radio Player.jpg" width="150" alt="Screen 11" />
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
git clone https://github.com/yourname/bbc-radio-player.git
cd "BBC Radio Player"

# build a debug APK
./gradlew assembleDebug
```

Open the project in Android Studio (2023.2+), or use the CI deploy script
`./scripts/deploy.sh` to build and sideload via `adb`.

## Requirements

- Android API 21+ (Lollipop) with API 33+ recommended
- Kotlin 1.9 or later
- ExoPlayer 2.18+, Material 3 Components, WorkManager for background tasks

## Changelog
- **v1.2.0** (Mar 2026): dual GitHub APK variants (Android Auto + No-Google), release automation, and metadata sync improvements
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

## F-Droid build notes

- Android Auto discovery requires this manifest metadata entry:

```xml
<meta-data
    android:name="com.google.android.gms.car.application"
    android:resource="@xml/automotive_app_desc" />
```

- If this metadata is removed, the app may not appear in Android Auto app lists even though playback service code is present.
- For user choice, publish two install variants:
  - **Standard/Android Auto build:** includes the metadata above (recommended for users who want Android Auto visibility).
  - **F-Droid-compatible build:** excludes Google car metadata for strict FOSS packaging.
- The app builds without proprietary language-detection dependencies.
- Example build command:

```bash
./gradlew assembleRelease
```

