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

- **v1.9.0** (Aug 2026): **Offline Mode:** Full offline mode support with network connectivity detection, app-wide offline warning banner, dedicated Downloaded Files section in Playlists, and offline-filtered podcast episode feeds. **Audio Service:** Auto-resume playback after transient audio focus loss and improved transient detection. **UI & Search:** Search suggestions dropdown with RecyclerView and adaptive artwork sizing across multiple screen form factors.

- **v1.8.5–v1.8.6** (Jul–Aug 2026): Added BBC Radio 5 Sports Extra 2 & 3 stations on Phone and Wear OS; updated compileSdk and targetSdk to 36; streamlined geo-block detection and asynchronous UK geo-probe; updated popular podcast rankings.

- **v1.8.4** (Jul 2026): **Startup & Navigation:** Redesigned startup page preferences with improved UI for subscribed podcasts and playlists. **Performance:** Optimised new podcasts loading and prefetching for faster browsing. **Streaming:** Prioritised worldwide streams over UK-only streams for better global accessibility.

- **v1.8.3** (Jun 2026): **Podcast Display:** Fixed release order in "New Podcasts" section to show episodes chronologically. **Language Support:** Added common non-English language codes to improve detection accuracy. **Playback:** Removed redundant podcast autoplay logic for cleaner state management.

- **v1.8.2** (Jun 2026): **UI Redesign:** Redesigned player control buttons in full-screen player for improved usability. **Playback Fixes:** Corrected podcast seeking to use metadata duration, and improved live radio pause behavior. **UI Feedback:** "Loading stream…" text now only appears when playback is actually active.

- **v1.8.1** (Jun 2026): **Deep Links & Android Auto:** Added deep link support for direct content access, and new option to select default station for Android Auto. **Podcast Management:** Improved podcast deduplication, implemented catalogue snapshots to prevent stale feeds being marked as new, and updated sorting logic for downloaded episodes. **Infrastructure:** Added system health monitoring with email alerts, and admin token authorization for sensitive endpoints. **Stability:** Fixed race condition during podcast autoplay transitions.

- **v1.8.0** (May 2026): **Independent Infrastructure:** Moved podcast index and search services off GCP to own infrastructure. **Hardware Integration:** Added ESP32 microcontroller firmware install script. **Performance & UI:** Faster startup (delayed background check by 5s), asynchronous metadata fixes to prevent blank episode descriptions/streams. **Downloads & Navigation:** Quieter notifications (removed intrusive success alerts), correct episode ordering for downloads, and under-the-hood stability improvements.

### Earlier Releases

- **v1.7.0–v1.7.1** (May 2026): Podcast rating system, voice commands, tagging system, multi-select toolbar, app shortcuts, improved Android Auto/Wear OS integration, smarter autoplay logic, and UI refinements.

- **v1.6.3–v1.6.5** (Apr 2026): Enhanced 7-day radio schedules, drag-to-reorder podcasts, dedicated HLS fallbacks for radio, secure stream URLs, faster "New Podcasts" loading, and seek bar overhaul.

- **v1.6.0–v1.6.2** (Mar–Apr 2026): Wear OS companion app, Media3 ExoPlayer migration, advanced podcast search with genre browsing, autoplay settings, and VPN warning banner.

- **v1.5.0–v1.5.6**: Shake-to-shuffle; edge-to-edge display; stations reorganised into national/regional/local; Podcast index migrated to GCS; cloud-search replaces local indexing; iOS app core; Recently Played Songs tab; Wear OS companion; VPN warning; audio quality switching; GCS popularity snapshot; BBC-branding-free artwork; rebrand to **British Radio Player** for Google Play.

- **v1.0.1–v1.4.0**: Podcast features, Android Auto enhancements, widget support, alarm features, alternative stream links, auto updater, new icon, and stability improvements.

- **v0.9–v0.12.0**: Episode sharing, history, notifications, next-show info, intelligent colour theming, saved searches, and playback enhancements.

- **Earlier releases**: Added podcasts, sharing, history, notifications, and Android Auto support.

## Contributing

Issues and pull requests are welcome. 

## License

This project is licensed under the GNU General Public License v3.0.
See [LICENSE](LICENSE).

Unofficial third‑party app. BBC and station trademarks are owned by the British
Broadcasting Corporation. Streams use public BBC APIs. No affiliation or
endorsement intended.

