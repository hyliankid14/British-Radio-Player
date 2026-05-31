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

## Requirements

- Android API 21+ (Lollipop) with API 33+ recommended; Wear OS requires API 30+
- Kotlin 1.9 or later
- AndroidX Media3 1.4+ (replaces legacy ExoPlayer), Material 3 Components, WorkManager for background tasks

## Changelog

### Recent Releases

- **v1.8.0** (May 2026): System health monitoring with email alerts; podcast rating system (submit/retrieve); tag-based podcast browsing in Android Auto; voice commands to play media from search; app icon long-press shortcuts (Favourites, Radio, Podcasts); ESP32 firmware install script; self-hosted deployment support with local file loading; admin token authorization for API endpoints; improved episode metadata resolution with live playback sync.

- **v1.7.1** (May 2026): Prevent automatic replay of just-ended podcast episodes in Android Auto; fix playlist autoplay when hide-played is enabled; stop playback on permanent audio focus loss in Android Auto; improve handling of Android Auto clients.

- **v1.7.0** (May 2026): Full playlist functionality with create, multi-select, and bulk actions; podcast tagging system with tag-based browsing in Android Auto; multi-select episodes in podcast detail with contextual bulk actions; collapsible played section in playlists; tap new-episode notification to open episode directly; opt-in stop-on-Bluetooth-disconnect playback behavior; improve notification colors and download notification visibility.

- **v1.6.5** (May 2026): Fix same-episode podcast restarts in Android Auto; defer auto-download trigger by 5s on startup; restore playlist context after Android Auto reconnect; fix playlist autoplay direction for SORT_NEWEST_FIRST.

- **v1.6.4** (May 2026): Replace ProgressBar with Material 3 progress indicators; add audio seeking; enhance podcast XML parsing and UI; show "Loading stream…" while buffering; speed up "New Podcasts" loading; extend schedule view to 7-day history/future with date tabs; background fetching of current show titles; RMS API replaces HTML for schedule entries; filter popular podcasts to cloud-index ranked only; replace LazyColumn with ScalingLazyColumn in Wear OS.

- **v1.6.3** (May 2026): Direct BBC HLS stream fallbacks for radio; fix insecure stream URLs; Wi-Fi settings screen and configuration portal; optimized audio pipeline and buffer sizes; 16 KB native page-size verification for AAB files.

### Earlier Releases

- **v1.6.2** (Apr 2026): Migrate to AndroidX Media3 ExoPlayer; fix duplicate analytics events; add option to exclude debug builds from analytics; enforce 10-second listen threshold before counting podcast plays; stop playback on swipe-to-dismiss; fix Android Auto podcast resume; extend recent searches limit to 30.
- **v1.6.1**: Search overhaul — result counts in section headers, podcast genre search, loading indicator, improved back navigation, and stale download-icon fix. New-podcast catalogue notifications fixed. TF card subscription fallback and SDSPI mount support (ESP32 companion).
- **v1.6.0**: Wear OS companion app added (separate APK bundled in every release); improved build and signing pipeline for phone + Wear simultaneous releases.
- **v1.5.0–v1.5.6**: Shake-to-shuffle; edge-to-edge display; stations reorganised into national/regional/local; Podcast index migrated to GCS; cloud-search replaces local indexing; iOS app core; Recently Played Songs tab; Wear OS companion; VPN warning; audio quality switching; GCS popularity snapshot; BBC-branding-free artwork; rebrand to **British Radio Player** for Google Play.
- **v1.4.0** (Mar 2026): Podcast improvements, playback and station updates, and interface refinements.
- **v1.0.1–v1.3.0**: Podcast features, Android Auto enhancements, widget support, alarm features, alternative stream links, auto updater, new icon, dual GitHub APK variants, stability improvements.
- **v0.9–v0.12.0**: Episode sharing, history, notifications, next-show info, intelligent colour theming, saved searches, playback enhancements, full podcast descriptions.
- **Earlier releases**: Added podcasts, sharing, history, notifications, and Android Auto support.

## Contributing

Issues and pull requests are welcome. 

## License

This project is licensed under the GNU General Public License v3.0.
See [LICENSE](LICENSE).

Unofficial third‑party app. BBC and station trademarks are owned by the British
Broadcasting Corporation. Streams use public BBC APIs. No affiliation or
endorsement intended.

