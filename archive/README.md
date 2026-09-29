# Archived native apps

**Nothing in this directory is built, shipped or maintained.**

Two superseded native phone apps are kept here for reference and history only:

| Path | What it was |
|---|---|
| `android-native-legacy/` | The original native Kotlin Android app (v1.x), superseded by the React Native rewrite in v2.0.0 |
| `ios-native-legacy/` | An unfinished native Swift iOS port, superseded by the same React Native rewrite |

The phone app is `react-app/` (React Native / Expo), which serves Android and iOS from one
codebase.

## Rules

- **Make product changes in `react-app/`, never in `archive/`.** A change here cannot reach users.
- `archive/android-native-legacy/` is not a Gradle module; `settings.gradle` includes only `:wear`.
- CI has no build target for these apps.
- These apps are useful as a behavioural reference: when porting, check what the legacy code did
  before inventing new behaviour, and port the *behaviour*, not the code.

## Not archived

`wear/` at the repository root is a live Kotlin Gradle module — the Wear OS companion is still
built and released alongside the phone app, and still takes changes.
