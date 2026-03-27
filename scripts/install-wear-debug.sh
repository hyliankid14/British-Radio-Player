#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK_PATH="$ROOT_DIR/wear/build/outputs/apk/debug/wear-debug.apk"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not installed or not on PATH"
  exit 1
fi

if [[ ! -f "$APK_PATH" ]]; then
  echo "Wear debug APK not found at: $APK_PATH"
  echo "Build it first with: ./gradlew :wear:assembleDebug"
  exit 1
fi

DEVICE="${1:-}"

CONNECTED_DEVICES=()
while IFS= read -r device_serial; do
  CONNECTED_DEVICES+=("$device_serial")
done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

if [[ ${#CONNECTED_DEVICES[@]} -eq 0 ]]; then
  echo "No ADB devices connected"
  exit 1
fi

is_watch_device() {
  local serial="$1"
  local characteristics
  characteristics="$(adb -s "$serial" shell getprop ro.build.characteristics 2>/dev/null | tr -d '\r')"
  [[ "$characteristics" == *watch* ]]
}

if [[ -n "$DEVICE" ]]; then
  adb -s "$DEVICE" install -r "$APK_PATH"
  echo "Installed on: $DEVICE"
  echo "Installed: $APK_PATH"
  exit 0
fi

WATCH_DEVICE=""
for serial in "${CONNECTED_DEVICES[@]}"; do
  if is_watch_device "$serial"; then
    WATCH_DEVICE="$serial"
    break
  fi
done

if [[ -z "$WATCH_DEVICE" ]]; then
  echo "No Wear OS device found amongst connected ADB targets"
  printf 'Connected devices:\n'
  printf '  %s\n' "${CONNECTED_DEVICES[@]}"
  exit 1
fi

adb -s "$WATCH_DEVICE" install -r "$APK_PATH"

# Clean up the old standalone package ID used by earlier drafts.
adb -s "$WATCH_DEVICE" uninstall com.hyliankid14.bbcradioplayer.wear.debug >/dev/null 2>&1 || true

echo "Installed on: $WATCH_DEVICE"

echo "Installed: $APK_PATH"
