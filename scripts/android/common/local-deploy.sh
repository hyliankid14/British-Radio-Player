#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || cd "$SCRIPT_DIR/../../.." && pwd)"

# Always execute Gradle from the repository root.
cd "$PROJECT_ROOT"

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

# Setup QEMU Sysroot for x86_64 emulation
export QEMU_LD_PREFIX="$PROJECT_ROOT/scripts/android/common/sysroot"

if [ -d "$QEMU_LD_PREFIX" ]; then
    echo "🌍 Using QEMU Sysroot: $QEMU_LD_PREFIX"
fi

if [ ! -x "./gradlew" ]; then
    chmod +x ./gradlew
fi

# Build GitHub debug APK for local sideload flow.
./gradlew :app:assembleGithubDebug

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

# Check for connected device
if ! adb get-state 1>/dev/null 2>&1; then
    echo "⚠️  No device connected via ADB."
    echo "    APK is ready at: $APK_FILE"
    exit 0
fi

echo "📦 Installing new version (preserving data)..."
# Use -r (reinstall) and -d (allow downgrade) to update in place without losing data
# If this fails due to signature mismatch, user will need to manually uninstall first
if ! adb install -r -d "$APK_FILE"; then
    echo "⚠️  Update in place failed. Trying clean install..."
    echo "    (This will clear app data)"

    # Remove old installs signed with a different key before reinstalling.
    declare -A PACKAGE_CANDIDATES=()
    PACKAGE_CANDIDATES["$APK_PACKAGE"]=1
    PACKAGE_CANDIDATES["com.hyliankid14.bbcradioplayer.debug"]=1
    PACKAGE_CANDIDATES["com.hyliankid14.bbcradioplayer"]=1

    for pkg in "${!PACKAGE_CANDIDATES[@]}"; do
        echo "🧹 Removing package (if installed): $pkg"
        adb uninstall "$pkg" >/dev/null 2>&1 || true
    done

    adb install "$APK_FILE"
fi

echo "✅ App installed successfully!"
