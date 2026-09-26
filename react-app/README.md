# React Native app

This is the app. The React app uses Track Player for phone playback and includes
native Android Auto, alarm, widget and Wear OS sync bridges. The Android Auto
media browser exposes the BBC stations through the car launcher and the bridge
starts playback independently of the React activity.

The legacy Kotlin app (`../app`) is kept in the repository but is no longer the
default build target; the Wear OS companion (`../wear`) is still built from Kotlin.

## Project layout

`android/` and `ios/` are **generated** — they are gitignored and recreated by
`npx expo prebuild`. Never hand-edit them: every native change belongs in a config
plugin under `plugins/` (or in `app.json`), which runs on every prebuild.

| Plugin | Responsibility |
|---|---|
| `plugins/withAndroidCleartextTraffic.js` | network security config, automotive app descriptor, copies the shared debug keystore, bundles JS into debug builds |
| `plugins/withAndroidReleaseChannels.js` | `github` / `play` build flavours, release signing, `.debug` application id suffix, channel-aware JS bundling |
| `plugins/withIosNative.js` | the phone scene and `SceneDelegate.swift`, the DEBUG Metro fallback in `AppDelegate.swift`, `DEVELOPMENT_TEAM`, `EXPO_USE_PRECOMPILED_MODULES`, and the CarPlay entitlement gate |

`SceneDelegate.swift` is not part of the Expo bare template, so it is versioned at
`plugins/ios-native/SceneDelegate.swift` and copied into the project on every prebuild.
Do not add Swift files directly under `ios/`: `prebuild --clean` deletes the directory and
its `project.pbxproj` file references with it. Entitlements and privacy manifests go in
`app.json` (`ios.entitlements`, `ios.privacyManifests`), not into the generated files.

## Versioning

`app.json` is the **single source of truth** for the phone app version:

```jsonc
"version": "2.0.0",                     // expo.version
"android": { "versionCode": 100 }       // expo.android.versionCode
```

The Wear OS version code is derived as `phone versionCode * 10 + 1`. The
`APP_VERSION_*` keys in the root `gradle.properties` apply only to the legacy
Kotlin phone app and are not used for releases.

Because the React app reuses the Kotlin application ID (`com.hyliankid14.bbcradioplayer`),
installing it over an existing install is an in-place upgrade. `LegacyMigration.kt` converts
the old `SharedPreferences` into the React MMKV store on first launch.

## Distribution channels

The channel is selected at bundle time with `EXPO_PUBLIC_DISTRIBUTION_CHANNEL`:

| Channel | `EXPO_PUBLIC_DISTRIBUTION_CHANNEL` | Signing | In-app updater | About page |
|---|---|---|---|---|
| GitHub | `github` (default) | shared debug keystore | shown | "GitHub" |
| Google Play | `play` | `RELEASE_*` upload key | hidden | "Google Play" |

The Gradle build fails if the `play` flavour is requested without a real release key, so a
Play bundle can never be signed with the debug keystore.

## Build commands

The native project must be generated before any Gradle build:

```sh
npx expo prebuild --platform android --no-install
```

| Goal | Command (from `react-app/android/`) |
|---|---|
| GitHub release APK | `EXPO_PUBLIC_DISTRIBUTION_CHANNEL=github ./gradlew :app:assembleGithubRelease` |
| Google Play AAB | `EXPO_PUBLIC_DISTRIBUTION_CHANNEL=play ./gradlew :app:bundlePlayRelease` |
| Sideloadable debug APK | `EXPO_PUBLIC_DISTRIBUTION_CHANNEL=github ./gradlew :app:assembleGithubDebug` |

Release signing (`RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`,
`RELEASE_KEY_PASSWORD`) resolves from a `-P` gradle property, then the environment, then
`~/.gradle/gradle.properties`.

### Release APK size

GitHub release APKs are minified with R8, have resources shrunk, and ship `arm64-v8a` only —
roughly 22 MB instead of 42 MB for an unminified universal build. The `architectures` input on
`build-release.yml`, or `REACT_RELEASE_ARCHITECTURES` locally, restores 32-bit support:

```sh
REACT_RELEASE_ARCHITECTURES=arm64-v8a,armeabi-v7a ./scripts/github-release.sh
```

Google Play is unaffected: Play delivers per-ABI itself, so the app bundle keeps all four.

`EXPO_PUBLIC_LASTFM_API_KEY` and `EXPO_PUBLIC_LASTFM_API_SECRET` must be present in the
environment at bundle time. Locally they come from `.env.local`; in CI they come from
repository secrets. Do not put `EXPO_PUBLIC_DISTRIBUTION_CHANNEL` in `.env.local` — a dotenv
value there can silently override the channel a release was built for.

### Build a standalone Android debug APK

```sh
npm run build:android:debug
```

Writes `~/Downloads/british-radio-player-react-debug.apk`; set `DOWNLOADS_DIR` to override the
destination. The default build targets modern 64-bit devices (`arm64-v8a`); set
`REACT_NATIVE_ARCHITECTURES=armeabi-v7a,arm64-v8a` for a universal ARM APK. Debug builds use the
`com.hyliankid14.bbcradioplayer.debug` application id, so they install alongside the release app.

## Releasing

CI owns the release flow; both workflows regenerate the native project from scratch.

| Workflow | Trigger | Output |
|---|---|---|
| `build-release.yml` | push a `v*` tag | `british-radio-player.apk` (GitHub flavour) + `wear-british-radio-player.apk`, published to the GitHub release |
| `build-play-aab.yml` | manual | signed `british-radio-player.aab` + Wear AAB for manual Play Console upload |
| `build-debug-apk.yml` | manual | rolling `debug-apk-latest` pre-release |

Local equivalents (untracked by design):

```sh
./scripts/github-release.sh       # bump the version, build, tag and publish the GitHub release
./scripts/build-release-aab.sh    # build and verify the signed Play AAB
```

A tag `vX.Y.Z` must match `expo.version`; the release workflow fails otherwise. Set the
repository variable `EXPECTED_PLAY_UPLOAD_SHA1` to guard the Play upload key.

## Releasing to the App Store

The iOS build is produced locally with `xcodebuild`; there is no iOS CI workflow yet.

```sh
./scripts/ios/build-ipa.sh            # prompts for version & auto-incremented build number, archives, exports
./scripts/ios/build-ipa.sh --clean    # also wipe ios/ first (recreates it from scratch)
# Non-interactive overrides:
./scripts/ios/build-ipa.sh -v 2.0.0 -b 2
```

The script writes `~/Downloads/british-radio-player-ios.ipa` (override with `DOWNLOADS_DIR`),
which is then uploaded with Transporter or Organizer ▸ Distribute App ▸ App Store Connect.

Identity and signing are all in `app.json`, so `prebuild --clean` cannot lose them:

```jsonc
"ios": {
  "bundleIdentifier": "com.hyliankid14.bbcradioplayer",  // same ID as Android
  "appleTeamId": "8ZAZCKQ9LV",                          // sets DEVELOPMENT_TEAM
  "buildNumber": "1",                                   // sets CFBundleVersion
  "supportsTablet": false                                // iPhone-only
}
```

`expo.version` sets `CFBundleShortVersionString`, so Transporter pulls the marketing version
from there and **not** from `ios.buildNumber`. `build-ipa.sh` automatically prompts for the
version and suggests `current_build + 1` by default on each run, updating `react-app/app.json`
before regenerating the native project. Re-uploading the same build number to App Store Connect
is rejected.

First-time account setup, which no script can do:

1. An App Store Connect app record for `com.hyliankid14.bbcradioplayer` (name, primary
   category **Music**, SKU `british-radio-player-ios`). No demo account is needed — the app
   has no sign-in.
2. An **Apple Distribution** certificate. `build-ipa.sh` passes `-allowProvisioningUpdates`,
   so Xcode creates the certificate and App Store profile on the first export, as long as the
   Apple account is signed in under Xcode ▸ Settings ▸ Accounts.
3. A publicly reachable **privacy policy URL**. `docs/privacy.html` exists but is only in the
   repository.

### Before archiving

ATS is enforced (`NSAllowsArbitraryLoads` is `false`; only the BBC/stream hosts in
`NSExceptionDomains` and local networking are exempt), so re-test playback on a real device
with a Release build before submitting:

```sh
npx expo run:ios --configuration Release --device "<iPhone UDID>"
```

Play a national and a local station, play and download a podcast episode, run a search, and
round-trip Last.fm auth. If a cleartext host is blocked, add it to `NSExceptionDomains` in
`app.json`.

### App Review notes

The app is an unofficial BBC client and BBC live radio is geo-restricted to the UK, while App
Review runs from the US. State both explicitly in the review notes and point reviewers at the
podcast browser, search and downloads, which work globally. Also expect a question about
`UIBackgroundModes` (`audio` for playback, `processing`/`fetch` for the podcast index sync).

### CarPlay

CarPlay approval has been granted by Apple for `com.hyliankid14.bbcradioplayer` (`com.apple.developer.carplay-audio`).

CarPlay support is enabled and built directly into the iOS target via `plugins/withIosNative.js` and `plugins/ios-native/`:
- **Scene configuration**: `CPTemplateApplicationSceneSessionRoleApplication` registered in `Info.plist` with `CarPlaySceneDelegate`.
- **Interface**: `CPTabBarTemplate` with Favourites (`CPListTemplate`), Stations categorized into National, Nations & Regions, and Local Radio (`CPListTemplate`), and Now Playing (`CPNowPlayingTemplate.shared`).
- **Audio & Controls**: Direct live stream playback via `AVPlayer` with `AVAudioSession` `.playback`, integrated with `MPNowPlayingInfoCenter` (displaying station title, "BBC Radio", live stream indicator, and station logo artwork) and `MPRemoteCommandCenter` (steering wheel play, pause, toggle).
- **Favourites sync**: Automatically syncs favourite station IDs with the main app via `UserDefaults.standard` (`favorite_station_ids`).

## Run on the iOS simulator

```sh
npm install
npm run ios:simulator
```

This opens the Simulator, builds and installs the Debug app, and starts Metro on port 8081.
Pass normal Expo iOS options, for example:

```sh
npm run ios:simulator -- --device "iPhone 17 Pro"
```

If the app is launched directly from Xcode, start Metro separately:

```sh
npm run ios:dev
```

Leave that running while using the Debug app. For a build that does not require Metro, select
the `Release` configuration in Xcode or run:

```sh
npx expo run:ios --configuration Release
```

To build and install on a connected iPhone: `npm run install:ios`.

The earlier native Swift port is archived at `../archive/ios-native-legacy`.
