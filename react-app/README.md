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
plugin under `plugins/`, which runs on every prebuild.

| Plugin | Responsibility |
|---|---|
| `plugins/withAndroidCleartextTraffic.js` | network security config, automotive app descriptor, copies the shared debug keystore, bundles JS into debug builds |
| `plugins/withAndroidReleaseChannels.js` | `github` / `play` build flavours, release signing, `.debug` application id suffix, channel-aware JS bundling |

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
