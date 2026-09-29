# Archived: legacy Kotlin Android app

**Status: frozen and superseded. Not built, not shipped, not maintained.**

This is the original native Android app (`com.hyliankid14.bbcradioplayer`), the one that shipped
as v1.x. Since the React Native / Expo rewrite (v2.0.0) it is superseded: the phone app is built
from `react-app/`, which serves Android and iOS from one codebase.

It is **not** a Gradle module any more — `settings.gradle` only includes `:wear`, and the release
workflows have no Kotlin build target — so nothing here compiles in CI or locally by default.

## Do not make product changes here

The archive exists for reference and history. If you need to change phone-app behaviour, change
`react-app/` instead. Behaviour here is often already mirrored there; look for the equivalent
component or feature before assuming a gap exists.

Changes in this directory will not reach users, will not be built, and will silently rot against
the live app.

## What it contained

- Kotlin/ViewBinding activities and fragments, including `MainActivity` and its own
  `BottomNavigationView` (the main tab bar)
- `RadioService` foreground playback, Android Auto media browser, alarm service, home screen widget
- SharedPreferences-backed settings, favourites, subscriptions, playlists, history and progress
- A `wear/`-facing Wearable Data Layer bridge for the Wear OS companion, which is still live

## Still-relevant sibling

`wear/` at the repository root is **not** archived. The Wear OS companion is still a Kotlin
Gradle module, is still built, and is still released with the phone app.

## Preserved history

The last state in which this was the live Android app is preserved at the git tag
`archive/android-native-v1.9.2`.
