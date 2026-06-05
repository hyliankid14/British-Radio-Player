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

- **v1.8.0** (May 2026): **Independent Infrastructure:** Moved podcast index and search services off GCP to own infrastructure. **Hardware Integration:** Added ESP32 microcontroller firmware install script. **Performance & UI:** Faster startup (delayed background check by 5s), asynchronous metadata fixes to prevent blank episode descriptions/streams. **Downloads & Navigation:** Quieter notifications (removed intrusive success alerts), correct episode ordering for downloads, and under-the-hood stability improvements.

- **v1.7.1** (May 2026): **New Feedback & Discovery:** Podcast rating system and voice command support. **Android Auto & Bluetooth:** Opt-in stop playback on Bluetooth disconnect, playlist state restoration after car reconnection, and improved `onGetRoot` handling. **Playback & Queue:** Fixed end-of-queue behavior to stop playback correctly, and prevented just-ended episodes from replaying in Android Auto.

- **v1.7.0** (May 2026): **Organisation & Customisation:** Podcast tagging system, multi-select toolbar for episodes, and app shortcuts (long-press home screen). **Android Auto & Wear OS:** Improved audio focus handling (stops on permanent loss), and simplified Wear OS episode date displays. **Playback & Downloads:** Smarter autoplay logic, WiFi download queuing, and direct notification access to specific episodes. **UI Refinements:** Fixed description text ellipsising, flickering tag chips, and playlist header behavior.

- **v1.6.5** (Apr 2026): **Enhanced Radio Schedules:** Expanded to 7-day history and future with date tabs. **Podcast Playback & Subscriptions:** Drag-to-reorder subscribed podcasts, fixed Android Auto autoplay restart bug, refined "Popular Podcasts" tab to show only cloud-indexed ranked shows, and smart indexing to prevent false "new podcast" notifications. **Visual & UI:** Seek bar overhaul and consistent sorting with radio buttons.

- **v1.6.4** (Apr 2026): **Performance & Speed:** "New Podcasts" section loads faster using cloud snapshots. **UI & Feedback:** Mini-player shows "Loading stream…" while buffering, and added step-by-step progress bars for "Popular" and "New" podcast sections.

- **v1.6.3** (Apr 2026): **Radio Streaming Reliability:** Added dedicated high-quality HLS fallbacks for radio stations. **Security & Connection:** Resolved issues with insecure (HTTP) stream URLs by updating to modern, secure standards.

### Earlier Releases

- **v1.6.2** (Apr 2026): Migrated to AndroidX Media3 ExoPlayer. Added autoplay next episode setting, swipe-to-stop playback, and fixed Android Auto podcast resume. Expanded recent search history to 30, fixed new podcast catalogue update notifications, and improved analytics accuracy (10-second listen threshold).

- **v1.6.1** (Mar 2026): Advanced podcast search with genre browsing, exact match counts in headers, and sort spinners. Migrated to Media3 ExoPlayer, implemented real-time "Now Playing" fetching, and fixed back navigation and stale download icon UI glitches.

- **v1.6.0** (Mar 2026): Added Wear OS companion app support. Improved 5 Live stream URLs with reliable fallbacks, added dismissible VPN warning banner, fixed Android Auto generic station logo display, and improved web player analytics accuracy.

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

