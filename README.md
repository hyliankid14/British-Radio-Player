# BBC Radio Player

An unofficial Android client for BBC Radio and podcasts. It focuses on
reliable streaming on phones and Android Auto, offering a clean Material 3
interface with useful features for listeners.

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
- **v1.0.3** (Feb 2026): further improvements and bug fixes
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
- The app builds without proprietary ML Kit dependencies.
- Example build command:

```bash
./gradlew assembleRelease
```

