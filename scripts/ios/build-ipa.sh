#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT_DIR/react-app"
IOS_DIR="$APP_DIR/ios"
DOWNLOADS_DIR="${DOWNLOADS_DIR:-$HOME/Downloads}"
OUTPUT_IPA="$DOWNLOADS_DIR/british-radio-player-ios.ipa"
WORKSPACE="$IOS_DIR/BritishRadioPlayer.xcworkspace"
SCHEME="BritishRadioPlayer"
ARCHIVE_PATH="$IOS_DIR/build/BritishRadioPlayer.xcarchive"
EXPORT_DIR="$IOS_DIR/build/export"
EXPORT_OPTIONS_PATH="$IOS_DIR/build/ExportOptions.plist"
TEAM_ID="8ZAZCKQ9LV"
ENTITLEMENTS="$IOS_DIR/BritishRadioPlayer/BritishRadioPlayer.entitlements"

# CarPlay (com.apple.developer.carplay-audio) is a managed capability that Apple must
# grant for this bundle ID before it can appear in any provisioning profile. Set
# EXPECT_CARPLAY=1 only once the grant has landed and plugins/withIosNative.js has
# ENABLE_CARPLAY = true, otherwise the export fails with an entitlement mismatch.
EXPECT_CARPLAY="${EXPECT_CARPLAY:-1}"

PRECLEAN=0
REQUESTED_VERSION="${VERSION:-}"
REQUESTED_BUILD="${BUILD_NUMBER:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)
      PRECLEAN=1
      shift
      ;;
    -v|--version)
      REQUESTED_VERSION="$2"
      shift 2
      ;;
    -b|--build|--build-number)
      REQUESTED_BUILD="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--clean] [-v|--version <version>] [-b|--build <build_number>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--clean] [-v|--version <version>] [-b|--build <build_number>]" >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "iOS builds require macOS" >&2
  exit 1
fi

for tool in xcodebuild node pod; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is not installed or not on PATH" >&2
    exit 1
  fi
done

if [[ ! -x "$APP_DIR/node_modules/.bin/expo" ]]; then
  echo "React app dependencies are missing; run 'npm install' in react-app first" >&2
  exit 1
fi

# Version and build number configuration
CURRENT_VERSION="$(node -p "require('$APP_DIR/app.json').expo.version || ''")"
CURRENT_BUILD="$(node -p "require('$APP_DIR/app.json').expo.ios?.buildNumber || '1'")"

if [[ "$CURRENT_BUILD" =~ ^[0-9]+$ ]]; then
  SUGGESTED_BUILD=$((CURRENT_BUILD + 1))
else
  SUGGESTED_BUILD="1"
fi

TARGET_VERSION="$REQUESTED_VERSION"
TARGET_BUILD="$REQUESTED_BUILD"

if [[ -z "$TARGET_VERSION" || -z "$TARGET_BUILD" ]]; then
  if [[ -t 0 || -c /dev/tty ]]; then
    TTY_DEV="/dev/tty"
    if [[ ! -c /dev/tty ]]; then
      TTY_DEV="/dev/stdin"
    fi
    echo "=== Release Version Configuration ==="
    echo "Current in app.json: version $CURRENT_VERSION, build $CURRENT_BUILD"
    echo

    if [[ -z "$TARGET_VERSION" ]]; then
      read -r -p "Enter marketing version [$CURRENT_VERSION]: " input_ver < "$TTY_DEV" || true
      TARGET_VERSION="${input_ver:-$CURRENT_VERSION}"
    fi

    if [[ -z "$TARGET_BUILD" ]]; then
      read -r -p "Enter build number [$SUGGESTED_BUILD]: " input_build < "$TTY_DEV" || true
      TARGET_BUILD="${input_build:-$SUGGESTED_BUILD}"
    fi
    echo
  else
    TARGET_VERSION="${TARGET_VERSION:-$CURRENT_VERSION}"
    TARGET_BUILD="${TARGET_BUILD:-$SUGGESTED_BUILD}"
  fi
fi

if [[ -z "$TARGET_VERSION" ]]; then
  echo "Error: Version cannot be empty." >&2
  exit 1
fi

if [[ ! "$TARGET_BUILD" =~ ^[0-9]+$ ]]; then
  echo "Error: Build number must be a positive integer, got: '$TARGET_BUILD'" >&2
  exit 1
fi

if [[ "$TARGET_VERSION" != "$CURRENT_VERSION" || "$TARGET_BUILD" != "$CURRENT_BUILD" ]]; then
  echo "Updating react-app/app.json to version ${TARGET_VERSION} (build ${TARGET_BUILD})..."
  node -e '
    const fs = require("fs");
    const appJsonPath = process.argv[1];
    const version = process.argv[2];
    const buildNumber = process.argv[3];
    const json = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    json.expo.version = version;
    if (!json.expo.ios) json.expo.ios = {};
    json.expo.ios.buildNumber = String(buildNumber);
    fs.writeFileSync(appJsonPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  ' "$APP_DIR/app.json" "$TARGET_VERSION" "$TARGET_BUILD"
fi

if [[ "$PRECLEAN" == "1" ]]; then
  echo "Regenerating the iOS project from scratch..."
  (
    cd "$APP_DIR"
    npx expo prebuild --platform ios --clean
  )
else
  echo "Regenerating the iOS project..."
  (
    cd "$APP_DIR"
    npx expo prebuild --platform ios
  )
fi

echo "Installing CocoaPods..."
(
  cd "$IOS_DIR"
  pod install
)

if [[ ! -f "$ENTITLEMENTS" ]]; then
  echo "Missing entitlements file at $ENTITLEMENTS" >&2
  exit 1
fi

if grep -q "com.apple.developer.carplay-audio" "$ENTITLEMENTS" && [[ "$EXPECT_CARPLAY" != "1" ]]; then
  echo "com.apple.developer.carplay-audio is present in the entitlements, but Apple has not" >&2
  echo "granted that capability for this bundle ID yet, so signing will fail." >&2
  echo "Set ENABLE_CARPLAY = true in react-app/plugins/withIosNative.js only after the grant." >&2
  exit 1
fi

# The app schedules local notifications only, so it must not request APNs. The
# expo-notifications config plugin adds aps-environment unconditionally, and
# withIosNative removes it; if the plugin order in app.json is ever changed that
# removal silently stops applying, so fail here rather than at signing time.
if grep -q "aps-environment" "$ENTITLEMENTS"; then
  echo "aps-environment is present in the entitlements, but this app only uses local" >&2
  echo "notifications and no provisioning profile needs APNs." >&2
  echo "Keep ./plugins/withIosNative listed before expo-notifications in app.json." >&2
  exit 1
fi

mkdir -p "$DOWNLOADS_DIR"
mkdir -p "$EXPORT_DIR"

# Signature metadata is read back out of Info.plist after packaging so the printed
# reminder matches what was actually built.
APP_PLIST="$IOS_DIR/BritishRadioPlayer/Info.plist"
BUILD_NUMBER="$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$APP_PLIST" 2>/dev/null || echo "?")"
MARKETING_VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP_PLIST" 2>/dev/null || echo "?")"

echo "Archiving ${SCHEME} ${MARKETING_VERSION} (${BUILD_NUMBER}) for generic iOS device..."
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  archive

if [[ ! -d "$ARCHIVE_PATH" ]]; then
  echo "Archive was not produced at $ARCHIVE_PATH" >&2
  exit 1
fi

# app-store is deprecated; app-store-connect is the current method name.
cat > "$EXPORT_OPTIONS_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>teamID</key>
	<string>${TEAM_ID}</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>uploadSymbols</key>
	<true/>
	<key>destination</key>
	<string>export</string>
</dict>
</plist>
PLIST

echo "Exporting the App Store .ipa (Xcode may create the distribution certificate and profile on first run)..."
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS_PATH" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates

IPA_PATH="$(find "$EXPORT_DIR" -maxdepth 1 -type f -name '*.ipa' -print -quit)"
if [[ -z "$IPA_PATH" || ! -f "$IPA_PATH" ]]; then
  echo "No .ipa was produced in $EXPORT_DIR" >&2
  exit 1
fi

cp "$IPA_PATH" "$OUTPUT_IPA"

echo "App Store .ipa written to: $OUTPUT_IPA"
echo
echo "Next steps:"
echo "  1. Upload it with Transporter (or Organizer > Distribute App > App Store Connect > Upload)."
echo "  2. Wait for processing, then install the TestFlight build and re-run the device smoke test."
echo "  3. Built version: ${MARKETING_VERSION} (build ${BUILD_NUMBER}). Re-running this script will automatically prompt with build $((BUILD_NUMBER + 1)) as the default."
