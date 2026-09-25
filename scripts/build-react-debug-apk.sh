#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/react-app"
DOWNLOADS_DIR="${DOWNLOADS_DIR:-$HOME/Downloads}"
OUTPUT_APK="$DOWNLOADS_DIR/british-radio-player-react-debug.apk"
ANDROID_ARCHITECTURES="${REACT_NATIVE_ARCHITECTURES:-arm64-v8a}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed or not on PATH" >&2
  exit 1
fi

resolve_android_home() {
  local candidate
  for candidate in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk" "$HOME/android-sdk"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

ANDROID_HOME="$(resolve_android_home || true)"
if [[ -z "$ANDROID_HOME" ]]; then
  echo "Android SDK not found; set ANDROID_HOME or ANDROID_SDK_ROOT" >&2
  exit 1
fi
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if [[ ! -x "$APP_DIR/node_modules/.bin/expo" ]]; then
  echo "React app dependencies are missing; run 'npm install' in react-app first" >&2
  exit 1
fi

mkdir -p "$DOWNLOADS_DIR"

echo "Generating the Android project..."
(
  cd "$APP_DIR"
  npx expo prebuild --platform android --no-install
)

echo "Building the self-contained debug APK..."
(
  cd "$APP_DIR/android"
  EXPO_PUBLIC_DISTRIBUTION_CHANNEL=github \
  ./gradlew --no-daemon :app:assembleGithubDebug \
    -PreactNativeDebuggableVariants= \
    -PreactNativeArchitectures="$ANDROID_ARCHITECTURES" \
    -Pexpo.useLegacyPackaging=true \
    -Pandroid.enableMinifyInDebugBuilds=true
)

APK_PATH="$(find "$APP_DIR/android/app/build/outputs/apk/github/debug" -maxdepth 1 -type f -name '*.apk' -print -quit)"
if [[ -z "$APK_PATH" || ! -f "$APK_PATH" ]]; then
  echo "Debug APK was not produced" >&2
  exit 1
fi

cp "$APK_PATH" "$OUTPUT_APK"
echo "Debug APK written to: $OUTPUT_APK"
