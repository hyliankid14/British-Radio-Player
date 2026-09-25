#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/react-app"
APK_PATH="$APP_DIR/android/app/build/outputs/apk/github/release/app-github-release.apk"
APPLICATION_ID="com.hyliankid14.bbcradioplayer"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not installed or not on PATH"
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
  echo "Android SDK not found; set ANDROID_HOME or ANDROID_SDK_ROOT"
  exit 1
fi
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

REQUESTED_DEVICE="${1:-${ANDROID_SERIAL:-}}"

CONNECTED_DEVICES=()
while IFS= read -r device_serial; do
  CONNECTED_DEVICES+=("$device_serial")
done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

if [[ ${#CONNECTED_DEVICES[@]} -eq 0 ]]; then
  echo "No Android devices connected via ADB"
  exit 1
fi

is_watch_device() {
  local serial="$1"
  local characteristics
  characteristics="$(adb -s "$serial" shell getprop ro.build.characteristics 2>/dev/null | tr -d '\r')"
  [[ "$characteristics" == *watch* ]]
}

TARGET_DEVICE=""
if [[ -n "$REQUESTED_DEVICE" ]]; then
  for serial in "${CONNECTED_DEVICES[@]}"; do
    if [[ "$serial" == "$REQUESTED_DEVICE" ]]; then
      TARGET_DEVICE="$serial"
      break
    fi
  done
  if [[ -z "$TARGET_DEVICE" ]]; then
    echo "Requested device is not connected: $REQUESTED_DEVICE"
    printf 'Connected devices:\n  %s\n' "${CONNECTED_DEVICES[@]}"
    exit 1
  fi
elif [[ ${#CONNECTED_DEVICES[@]} -eq 1 ]]; then
  TARGET_DEVICE="${CONNECTED_DEVICES[0]}"
else
  for serial in "${CONNECTED_DEVICES[@]}"; do
    if ! is_watch_device "$serial"; then
      TARGET_DEVICE="$serial"
      break
    fi
  done
  if [[ -z "$TARGET_DEVICE" ]]; then
    echo "No phone or tablet found amongst connected ADB devices"
    printf 'Connected devices:\n  %s\n' "${CONNECTED_DEVICES[@]}"
    exit 1
  fi
fi

echo "Building React Native Android app..."
(
  cd "$APP_DIR"
  npx expo prebuild --platform android --no-install
  "$ROOT_DIR/scripts/ensure-android-sdk.sh"
  (
    cd android
    EXPO_PUBLIC_DISTRIBUTION_CHANNEL=github \
    ./gradlew --no-daemon :app:assembleGithubRelease
  )
)

if [[ ! -f "$APK_PATH" ]]; then
  echo "React release APK not found at: $APK_PATH"
  exit 1
fi

echo "Installing React app on: $TARGET_DEVICE"
if ! adb -s "$TARGET_DEVICE" install -r -d "$APK_PATH"; then
  echo "Update in place failed; removing the previous app and retrying..."
  adb -s "$TARGET_DEVICE" uninstall "$APPLICATION_ID" >/dev/null 2>&1 || true
  adb -s "$TARGET_DEVICE" install "$APK_PATH"
fi

echo "React app installed successfully on $TARGET_DEVICE"
