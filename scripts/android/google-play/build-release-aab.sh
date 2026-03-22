#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/../../.." && pwd))"

cd "$PROJECT_ROOT"

# -------------------------------------------------------
# Check signing config
# -------------------------------------------------------
GRADLE_PROPS="$HOME/.gradle/gradle.properties"
if [ ! -f "$GRADLE_PROPS" ]; then
    echo "❌ Error: ~/.gradle/gradle.properties not found."
    echo "   Run scripts/setup-release-signing.sh to configure signing."
    exit 1
fi

for key in RELEASE_STORE_FILE RELEASE_STORE_PASSWORD RELEASE_KEY_ALIAS RELEASE_KEY_PASSWORD; do
    if ! grep -q "^${key}=" "$GRADLE_PROPS"; then
        echo "❌ Error: $key missing from ~/.gradle/gradle.properties."
        echo "   Run scripts/setup-release-signing.sh to configure signing."
        exit 1
    fi
done

KEYSTORE_FILE=$(grep "^RELEASE_STORE_FILE=" "$GRADLE_PROPS" | cut -d'=' -f2-)
if [ ! -f "$KEYSTORE_FILE" ]; then
    echo "❌ Error: Keystore not found at $KEYSTORE_FILE"
    exit 1
fi

if [ ! -x "./gradlew" ]; then
    chmod +x ./gradlew
fi

echo "--------------------------------------------------"
echo "🔨 Building Release AAB for Google Play"
echo "--------------------------------------------------"

./gradlew :app:bundlePlayRelease

# -------------------------------------------------------
# Locate the AAB
# -------------------------------------------------------
AAB_FILE=$(find app/build/outputs/bundle/playRelease -name "*.aab" | sort | head -1)
MAPPING_FILE="app/build/outputs/mapping/playRelease/mapping.txt"
SYMBOLS_FILE="app/build/outputs/native-debug-symbols/playRelease/native-debug-symbols.zip"
NATIVE_LIBS_ROOT="app/build/intermediates/merged_native_libs/playRelease/mergePlayReleaseNativeLibs/out"

if [ -z "$AAB_FILE" ]; then
    echo "❌ Build failed: No AAB found in app/build/outputs/bundle/playRelease/"
    exit 1
fi

# Always generate a Play-compatible symbols archive from merged native libs.
# Play Console expects ABI folders at zip root (arm64-v8a/, x86_64/, ...), not lib/.
if [ -d "$NATIVE_LIBS_ROOT/lib" ] && find "$NATIVE_LIBS_ROOT/lib" -name "*.so" | grep -q .; then
    SYMBOLS_FILE="app/build/outputs/native-debug-symbols/playRelease/native-debug-symbols.zip"
    mkdir -p "$(dirname "$SYMBOLS_FILE")"
    rm -f "$SYMBOLS_FILE"

    if command -v zip >/dev/null 2>&1; then
        (
            cd "$NATIVE_LIBS_ROOT/lib"
            zip -rq "$PROJECT_ROOT/$SYMBOLS_FILE" .
        )
    else
        # macOS fallback if zip is unavailable.
        (
            cd "$NATIVE_LIBS_ROOT/lib"
            ditto -c -k --sequesterRsrc . "$PROJECT_ROOT/$SYMBOLS_FILE"
        )
    fi
else
    SYMBOLS_FILE=""
fi

# -------------------------------------------------------
# Verify signature
# -------------------------------------------------------
echo ""
echo "--------------------------------------------------"
echo "🔏 Verifying signature"
echo "--------------------------------------------------"

if jarsigner -verify -verbose "$AAB_FILE" 2>&1 | grep -q "jar verified"; then
    echo "✅ AAB is correctly signed."
else
    echo "⚠️  Warning: jarsigner could not verify the AAB signature."
fi

# -------------------------------------------------------
# Summary
# -------------------------------------------------------
AAB_SIZE=$(du -sh "$AAB_FILE" | cut -f1)

echo ""
echo "=================================================="
echo "✅ Release AAB ready for Google Play"
echo "   Path : $AAB_FILE"
echo "   Size : $AAB_SIZE"
if [ -f "$MAPPING_FILE" ]; then
    echo "   Mapping : $MAPPING_FILE"
    echo "   Upload mapping.txt in Play Console deobfuscation section"
else
    echo "   Mapping : Not generated"
fi
if [ -n "${SYMBOLS_FILE:-}" ] && [ -f "$SYMBOLS_FILE" ]; then
    echo "   Native symbols : $SYMBOLS_FILE"
    echo "   Upload native-debug-symbols.zip in Play Console to resolve native crash/ANR symbols"
else
    echo "   Native symbols : Not generated"
fi
echo "=================================================="
