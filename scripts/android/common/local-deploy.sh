#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/../../.." && pwd))"
PROPS_FILE="$PROJECT_ROOT/gradle.properties"

# Always execute Gradle from the repository root.
cd "$PROJECT_ROOT"

REQUESTED_DEVICE="${1:-${ANDROID_SERIAL:-}}"

read_prop() {
    local key="$1"
    awk -F'=' -v k="$key" '
        $0 !~ /^[[:space:]]*#/ {
            name=$1
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
            if (name == k) {
                val=$0
                sub(/^[^=]*=/, "", val)
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
                print val
            }
        }
    ' "$PROPS_FILE" | tail -1
}

bump_patch_version() {
    local version="$1"
    if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
        echo "❌ Error: APP_VERSION_NAME must use semantic version format x.y.z. Found: $version"
        exit 1
    fi

    local major="${BASH_REMATCH[1]}"
    local minor="${BASH_REMATCH[2]}"
    local patch="${BASH_REMATCH[3]}"
    echo "${major}.${minor}.$((patch + 1))"
}

RELEASE_VERSION_NAME="$(read_prop APP_VERSION_NAME)"
RELEASE_VERSION_CODE="$(read_prop APP_VERSION_CODE)"
if [[ -z "$RELEASE_VERSION_NAME" || -z "$RELEASE_VERSION_CODE" ]]; then
    echo "❌ Error: APP_VERSION_NAME and APP_VERSION_CODE must be set in $PROPS_FILE"
    exit 1
fi

DEBUG_VERSION_NAME="$(bump_patch_version "$RELEASE_VERSION_NAME")"
DEBUG_VERSION_CODE="$((RELEASE_VERSION_CODE + 1))"

resolve_android_home() {
    local candidates=()

    if [ -n "${ANDROID_HOME:-}" ]; then
        candidates+=("$ANDROID_HOME")
    fi
    if [ -n "${ANDROID_SDK_ROOT:-}" ]; then
        candidates+=("$ANDROID_SDK_ROOT")
    fi

    candidates+=("$HOME/Library/Android/sdk")
    candidates+=("$HOME/android-sdk")

    for dir in "${candidates[@]}"; do
        if [ -d "$dir" ]; then
            echo "$dir"
            return 0
        fi
    done

    return 1
}

ANDROID_HOME="$(resolve_android_home || true)"
if [ -n "$ANDROID_HOME" ]; then
    export ANDROID_HOME
    export ANDROID_SDK_ROOT="$ANDROID_HOME"
    export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
fi

if [ ! -d "$ANDROID_HOME" ]; then
    echo "❌ Error: ANDROID_HOME not found at $ANDROID_HOME"
    echo "Please run scripts/setup-local-build.sh first."
    exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
    echo "❌ Error: adb not found in PATH"
    echo "Please run scripts/setup-local-build.sh first."
    exit 1
fi

echo "--------------------------------------------------"
echo "🔨 Starting Local Build"
echo "--------------------------------------------------"
echo "Release version: ${RELEASE_VERSION_NAME} (${RELEASE_VERSION_CODE})"
echo "Local debug version: ${DEBUG_VERSION_NAME}-debug (${DEBUG_VERSION_CODE})"

# Setup QEMU Sysroot for x86_64 emulation
export QEMU_LD_PREFIX="$PROJECT_ROOT/scripts/android/common/sysroot"

if [ -d "$QEMU_LD_PREFIX" ]; then
    echo "🌍 Using QEMU Sysroot: $QEMU_LD_PREFIX"
fi

if [ ! -x "./gradlew" ]; then
    chmod +x ./gradlew
fi

# Build GitHub debug APK for local sideload flow.
./gradlew :app:assembleGithubDebug \
    -PAPP_VERSION_NAME="$DEBUG_VERSION_NAME" \
    -PAPP_VERSION_CODE="$DEBUG_VERSION_CODE"

echo "--------------------------------------------------"
echo "📲 Deploying to Device"
echo "--------------------------------------------------"

# Find debug APK outputs using the same path convention as CI:
# app/build/outputs/apk/**/debug/*.apk
DEBUG_APKS=()
while IFS= read -r apk_path; do
    DEBUG_APKS+=("$apk_path")
done < <(find app/build/outputs/apk/github/debug -type f -name "*.apk" | sort)

if [ ${#DEBUG_APKS[@]} -eq 0 ]; then
    echo "❌ Build failed: No debug APK found in app/build/outputs/apk/github/debug/"
    exit 1
fi

if [ ${#DEBUG_APKS[@]} -gt 1 ]; then
    echo "⚠️  Multiple debug APKs found. Using the first one:"
    printf '    %s\n' "${DEBUG_APKS[@]}"
fi

APK_FILE="${DEBUG_APKS[0]}"
echo "Found debug APK: $APK_FILE"

# Detect package name from APK so uninstall targets the right app ID.
detect_package_name() {
    local apk_path="$1"

    if command -v aapt >/dev/null 2>&1; then
        aapt dump badging "$apk_path" | awk -F"'" '/package: name=/{print $2; exit}'
        return 0
    fi

    if command -v apkanalyzer >/dev/null 2>&1; then
        apkanalyzer manifest application-id "$apk_path"
        return 0
    fi

    return 1
}

APK_PACKAGE="$(detect_package_name "$APK_FILE" 2>/dev/null || true)"
if [ -z "$APK_PACKAGE" ]; then
    APK_PACKAGE="com.hyliankid14.bbcradioplayer.debug"
fi

# Check for connected devices and select an install target.
CONNECTED_DEVICES=()
while IFS= read -r device_serial; do
    CONNECTED_DEVICES+=("$device_serial")
done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

if [ ${#CONNECTED_DEVICES[@]} -eq 0 ]; then
    echo "⚠️  No device connected via ADB."
    echo "    APK is ready at: $APK_FILE"
    exit 0
fi

is_watch_device() {
    local serial="$1"
    local characteristics
    characteristics="$(adb -s "$serial" shell getprop ro.build.characteristics 2>/dev/null | tr -d '\r')"
    [[ "$characteristics" == *watch* ]]
}

TARGET_DEVICE=""

if [ -n "$REQUESTED_DEVICE" ]; then
    for serial in "${CONNECTED_DEVICES[@]}"; do
        if [ "$serial" = "$REQUESTED_DEVICE" ]; then
            TARGET_DEVICE="$serial"
            break
        fi
    done

    if [ -z "$TARGET_DEVICE" ]; then
        echo "❌ Requested device not found: $REQUESTED_DEVICE"
        echo "Connected devices:"
        printf '    %s\n' "${CONNECTED_DEVICES[@]}"
        exit 1
    fi
elif [ ${#CONNECTED_DEVICES[@]} -eq 1 ]; then
    TARGET_DEVICE="${CONNECTED_DEVICES[0]}"
else
    for serial in "${CONNECTED_DEVICES[@]}"; do
        if ! is_watch_device "$serial"; then
            TARGET_DEVICE="$serial"
            break
        fi
    done

    if [ -z "$TARGET_DEVICE" ]; then
        TARGET_DEVICE="${CONNECTED_DEVICES[0]}"
    fi

    echo "ℹ️  Multiple ADB devices detected."
    printf '    %s\n' "${CONNECTED_DEVICES[@]}"
    echo "    Using: $TARGET_DEVICE"
fi

echo "📦 Installing new version (preserving data)..."
# Use -r (reinstall) and -d (allow downgrade) to update in place without losing data
# If this fails due to signature mismatch, user will need to manually uninstall first
if ! adb -s "$TARGET_DEVICE" install -r -d "$APK_FILE"; then
    echo "⚠️  Update in place failed. Trying clean install..."
    echo "    (This will clear app data)"

    # Remove old installs signed with a different key before reinstalling.
    declare -A PACKAGE_CANDIDATES=()
    PACKAGE_CANDIDATES["$APK_PACKAGE"]=1
    PACKAGE_CANDIDATES["com.hyliankid14.bbcradioplayer.debug"]=1
    PACKAGE_CANDIDATES["com.hyliankid14.bbcradioplayer"]=1

    for pkg in "${!PACKAGE_CANDIDATES[@]}"; do
        echo "🧹 Removing package (if installed): $pkg"
        adb -s "$TARGET_DEVICE" uninstall "$pkg" >/dev/null 2>&1 || true
    done

    adb -s "$TARGET_DEVICE" install "$APK_FILE"
fi

echo "✅ App installed successfully on $TARGET_DEVICE!"
