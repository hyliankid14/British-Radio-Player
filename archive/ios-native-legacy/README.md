# Archived: native Swift iOS port

**Status: frozen and superseded. Not built, not shipped, not maintained.**

This directory is an early native Swift port of British Radio Player (bundle id
`com.hyliankid14.bbcradioplayer.ios`, marketing version `0.1.0`). It was never completed and is
no longer part of the build. iOS is served by the React Native / Expo app in `react-app/`, which
shares one codebase with Android.

The last state in which this was the live iOS port is preserved at the git tag
`archive/ios-native-v0.1.0`.

## What was implemented

- SwiftUI app shell with tabs for Radio and Podcasts
- AVPlayer-based playback service with lock screen command wiring (play/pause)
- Shared domain models (`Station`, `Podcast`, `Episode`)
- Station repository with seed BBC stations and HQ/LQ stream URL logic
- Podcast repository scaffold with OPML and RSS parsing baseline
- Remote index metadata client for `podcast-index-meta.json`

## What was never implemented

- Full station catalogue parity with Android
- Podcast index sync and local SQLite FTS search parity
- Download/offline queue, retry rules and limits
- Notification and background refresh parity
- Settings parity (including import/export and advanced preferences)
- Widgets, alarms and deep-link parity

The React app implements all of the above (see `react-app/`); this port is kept only for reference.

## Reviving it

Nothing here builds as part of CI or the release workflows. To look at it again:

1. Install Xcode (App Store, ADAM ID `497799835`) and open it once to accept the licence.
2. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen) and generate the project:

   ```sh
   cd archive/ios-native-legacy
   xcodegen generate
   ```

3. Open `BBCRadioPlayer.xcodeproj`, set your development team in Signing & Capabilities, and enable
   Background Modes → Audio, AirPlay and Picture in Picture.

`scripts/ios/setup-ios-build.sh` in the repository root still points here, but it is deprecated —
use the React app's iOS scripts instead:

```sh
cd react-app
npm run ios:simulator      # build and run on the iOS Simulator
npm run install:ios        # build and install on a connected iPhone
```
