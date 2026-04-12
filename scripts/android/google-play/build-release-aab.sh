#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/../../.." && pwd))"

cd "$PROJECT_ROOT"

OBJDUMP_BIN="$(command -v objdump || true)"

verify_16kb_page_support_in_aab() {
    local aab_file="$1"
    local label="$2"

    if [ -z "$OBJDUMP_BIN" ]; then
        echo "⚠️  Warning: objdump not found; skipping 16 KB native page-size verification for ${label}."
        return
    fi

    local tmp_dir
    tmp_dir="$(mktemp -d)"
    trap 'rm -rf "$tmp_dir"' RETURN

    unzip -oq "$aab_file" "base/lib/arm64-v8a/*.so" -d "$tmp_dir" >/dev/null 2>&1 || true

    if ! find "$tmp_dir/base/lib/arm64-v8a" -type f -name "*.so" 2>/dev/null | grep -q .; then
        echo "ℹ️  No arm64 native libraries found in ${label}; skipping 16 KB check."
        return
    fi

    local failed=0
    while IFS= read -r so_file; do
        local load_lines
        load_lines="$($OBJDUMP_BIN -x "$so_file" | awk '/^[[:space:]]*LOAD /')"
        if [ -z "$load_lines" ]; then
            echo "❌ Error: Unable to parse LOAD segments for ${so_file}"
            failed=1
            continue
        fi

        while IFS= read -r load_line; do
            [ -z "$load_line" ] && continue
            local align_pow
            align_pow="$(echo "$load_line" | sed -nE 's/.*align 2\*\*([0-9]+).*/\1/p')"
            if [ -z "$align_pow" ]; then
                echo "❌ Error: Missing align value in ${so_file}: $load_line"
                failed=1
                continue
            fi
            if [ "$align_pow" -lt 14 ]; then
                echo "❌ Error: ${so_file} has LOAD align 2**${align_pow} (< 2**14)."
                failed=1
            fi
        done <<< "$load_lines"
    done < <(find "$tmp_dir/base/lib/arm64-v8a" -type f -name "*.so" | sort)

    if [ "$failed" -ne 0 ]; then
        echo "❌ ${label} failed 16 KB native page-size validation."
        exit 1
    fi

    echo "✅ ${label} passed 16 KB native page-size validation (arm64 LOAD align >= 2**14)."
}

VERSION_NAME=$(grep -E '^APP_VERSION_NAME=' gradle.properties | cut -d'=' -f2-)
VERSION_CODE=$(grep -E '^APP_VERSION_CODE=' gradle.properties | cut -d'=' -f2-)
PHONE_VERSION_NAME="$VERSION_NAME"
PHONE_VERSION_CODE="$VERSION_CODE"
WEAR_VERSION_NAME="$VERSION_NAME"
DEFAULT_WEAR_VERSION_CODE=$(( VERSION_CODE * 10 + 1 ))
WEAR_VERSION_CODE="${WEAR_VERSION_CODE_OVERRIDE:-$DEFAULT_WEAR_VERSION_CODE}"

if ! [[ "$WEAR_VERSION_CODE" =~ ^[0-9]+$ ]]; then
    echo "❌ Error: Wear version code must be numeric. Received '$WEAR_VERSION_CODE'."
    echo "   Set WEAR_VERSION_CODE_OVERRIDE to a valid integer, for example: WEAR_VERSION_CODE_OVERRIDE=612"
    exit 1
fi

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
STORE_PASSWORD=$(grep "^RELEASE_STORE_PASSWORD=" "$GRADLE_PROPS" | cut -d'=' -f2-)
KEY_ALIAS=$(grep "^RELEASE_KEY_ALIAS=" "$GRADLE_PROPS" | cut -d'=' -f2-)
KEY_PASSWORD=$(grep "^RELEASE_KEY_PASSWORD=" "$GRADLE_PROPS" | cut -d'=' -f2-)
if [ ! -f "$KEYSTORE_FILE" ]; then
    echo "❌ Error: Keystore not found at $KEYSTORE_FILE"
    exit 1
fi

if [ -z "$STORE_PASSWORD" ] || [ -z "$KEY_ALIAS" ] || [ -z "$KEY_PASSWORD" ]; then
    echo "❌ Error: Signing credentials are incomplete in ~/.gradle/gradle.properties"
    exit 1
fi

EXPECTED_SHA1="${EXPECTED_PLAY_UPLOAD_SHA1:-}"
if [ -n "$EXPECTED_SHA1" ]; then
    ACTUAL_SHA1=$(keytool -list -v -keystore "$KEYSTORE_FILE" -alias "$KEY_ALIAS" -storepass "$STORE_PASSWORD" -keypass "$KEY_PASSWORD" \
        | awk -F': ' '/SHA1:/{print $2; exit}')
    if [ -z "$ACTUAL_SHA1" ]; then
        echo "❌ Error: Unable to read SHA1 fingerprint for alias '$KEY_ALIAS' in $KEYSTORE_FILE"
        exit 1
    fi

    NORM_EXPECTED=$(echo "$EXPECTED_SHA1" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')
    NORM_ACTUAL=$(echo "$ACTUAL_SHA1" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')
    if [ "$NORM_EXPECTED" != "$NORM_ACTUAL" ]; then
        echo "❌ Error: Release keystore fingerprint mismatch."
        echo "   Expected SHA1: $NORM_EXPECTED"
        echo "   Actual SHA1  : $NORM_ACTUAL"
        echo "   Update ~/.gradle/gradle.properties to point to the correct Play upload keystore."
        exit 1
    fi
fi

if [ ! -x "./gradlew" ]; then
    chmod +x ./gradlew
fi

echo "--------------------------------------------------"
echo "🔨 Building Release AAB for Google Play"
echo "--------------------------------------------------"

./gradlew \
    :app:bundlePlayRelease \
    :wear:bundleRelease \
    -PWEAR_VERSION_CODE="$WEAR_VERSION_CODE" \
    -PRELEASE_STORE_FILE="$KEYSTORE_FILE" \
    -PRELEASE_STORE_PASSWORD="$STORE_PASSWORD" \
    -PRELEASE_KEY_ALIAS="$KEY_ALIAS" \
    -PRELEASE_KEY_PASSWORD="$KEY_PASSWORD"

# -------------------------------------------------------
# Locate the AAB
# -------------------------------------------------------
AAB_FILE=$(find app/build/outputs/bundle/playRelease -name "*.aab" | sort | head -1)
MAPPING_FILE="app/build/outputs/mapping/playRelease/mapping.txt"
SYMBOLS_FILE="app/build/outputs/native-debug-symbols/playRelease/native-debug-symbols.zip"
NATIVE_LIBS_ROOT="app/build/intermediates/merged_native_libs/playRelease/mergePlayReleaseNativeLibs/out"
WEAR_AAB_FILE=$(find wear/build/outputs/bundle/release -name "*.aab" | sort | head -1)
WEAR_MAPPING_FILE="wear/build/outputs/mapping/release/mapping.txt"
WEAR_SYMBOLS_FILE="wear/build/outputs/native-debug-symbols/release/native-debug-symbols.zip"
WEAR_NATIVE_LIBS_ROOT="wear/build/intermediates/merged_native_libs/release/mergeReleaseNativeLibs/out"
WEAR_STRIPPED_NATIVE_LIBS_ROOT="wear/build/intermediates/stripped_native_libs/release/stripReleaseDebugSymbols/out"
WEAR_NATIVE_SYMBOLS_REASON=""

if [ -z "$AAB_FILE" ]; then
    echo "❌ Build failed: No AAB found in app/build/outputs/bundle/playRelease/"
    exit 1
fi

if [ -z "$WEAR_AAB_FILE" ]; then
    echo "❌ Build failed: No Wear AAB found in wear/build/outputs/bundle/release/"
    exit 1
fi

verify_16kb_page_support_in_aab "$AAB_FILE" "Phone AAB"
verify_16kb_page_support_in_aab "$WEAR_AAB_FILE" "Wear AAB"

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

# Generate Wear native symbols archive when native libs are present.
WEAR_SYMBOLS_FILE="wear/build/outputs/native-debug-symbols/release/native-debug-symbols.zip"
mkdir -p "$(dirname "$WEAR_SYMBOLS_FILE")"
rm -f "$WEAR_SYMBOLS_FILE"

package_wear_symbols_from_dir() {
    local src_dir="$1"
    if command -v zip >/dev/null 2>&1; then
        (
            cd "$src_dir"
            zip -rq "$PROJECT_ROOT/$WEAR_SYMBOLS_FILE" .
        )
    else
        (
            cd "$src_dir"
            ditto -c -k --sequesterRsrc . "$PROJECT_ROOT/$WEAR_SYMBOLS_FILE"
        )
    fi
}

if [ -d "$WEAR_NATIVE_LIBS_ROOT/lib" ] && find "$WEAR_NATIVE_LIBS_ROOT/lib" -name "*.so" | grep -q .; then
    package_wear_symbols_from_dir "$WEAR_NATIVE_LIBS_ROOT/lib"
elif [ -d "$WEAR_STRIPPED_NATIVE_LIBS_ROOT/lib" ] && find "$WEAR_STRIPPED_NATIVE_LIBS_ROOT/lib" -name "*.so" | grep -q .; then
    package_wear_symbols_from_dir "$WEAR_STRIPPED_NATIVE_LIBS_ROOT/lib"
else
    WEAR_AAB_TMP_DIR="$(mktemp -d)"
    unzip -oq "$WEAR_AAB_FILE" "base/lib/*" -d "$WEAR_AAB_TMP_DIR" >/dev/null 2>&1 || true
    if [ -d "$WEAR_AAB_TMP_DIR/base/lib" ] && find "$WEAR_AAB_TMP_DIR/base/lib" -name "*.so" | grep -q .; then
        package_wear_symbols_from_dir "$WEAR_AAB_TMP_DIR/base/lib"
    else
        WEAR_SYMBOLS_FILE=""
        WEAR_NATIVE_SYMBOLS_REASON="Wear bundle contains no native .so libraries."
    fi
    rm -rf "$WEAR_AAB_TMP_DIR"
fi

# -------------------------------------------------------
# Verify signature
# -------------------------------------------------------
echo ""
echo "--------------------------------------------------"
echo "🔏 Verifying signature"
echo "--------------------------------------------------"

if jarsigner -verify -verbose "$AAB_FILE" 2>&1 | grep -q "jar verified"; then
    echo "✅ Phone AAB is correctly signed."
else
    echo "⚠️  Warning: jarsigner could not verify the phone AAB signature."
fi

if jarsigner -verify -verbose "$WEAR_AAB_FILE" 2>&1 | grep -q "jar verified"; then
    echo "✅ Wear AAB is correctly signed."
else
    echo "⚠️  Warning: jarsigner could not verify the Wear AAB signature."
fi

# -------------------------------------------------------
# Summary
# -------------------------------------------------------
AAB_SIZE=$(du -sh "$AAB_FILE" | cut -f1)
WEAR_AAB_SIZE=$(du -sh "$WEAR_AAB_FILE" | cut -f1)

echo ""
echo "=================================================="
echo "✅ Release AAB ready for Google Play"
echo "   Phone version : ${PHONE_VERSION_NAME} (Build ${PHONE_VERSION_CODE})"
echo "   Wear OS version : ${WEAR_VERSION_NAME} (Build ${WEAR_VERSION_CODE})"
echo "   Phone AAB : $AAB_FILE"
echo "   Phone size : $AAB_SIZE"
echo "   Wear AAB : $WEAR_AAB_FILE"
echo "   Wear size : $WEAR_AAB_SIZE"
if [ -f "$MAPPING_FILE" ]; then
    echo "   Phone mapping : $MAPPING_FILE"
    echo "   Upload phone mapping.txt in Play Console deobfuscation section"
else
    echo "   Phone mapping : Not generated"
fi
if [ -n "${SYMBOLS_FILE:-}" ] && [ -f "$SYMBOLS_FILE" ]; then
    echo "   Phone native symbols : $SYMBOLS_FILE"
    echo "   Upload phone native-debug-symbols.zip in Play Console to resolve native crash/ANR symbols"
else
    echo "   Phone native symbols : Not generated"
fi
if [ -f "$WEAR_MAPPING_FILE" ]; then
    echo "   Wear mapping : $WEAR_MAPPING_FILE"
    echo "   Upload wear mapping.txt in Play Console deobfuscation section"
else
    echo "   Wear mapping : Not generated"
fi
if [ -n "${WEAR_SYMBOLS_FILE:-}" ] && [ -f "$WEAR_SYMBOLS_FILE" ]; then
    echo "   Wear native symbols : $WEAR_SYMBOLS_FILE"
    echo "   Upload wear native-debug-symbols.zip in Play Console to resolve native crash/ANR symbols"
else
    if [ -n "$WEAR_NATIVE_SYMBOLS_REASON" ]; then
        echo "   Wear native symbols : Not generated ($WEAR_NATIVE_SYMBOLS_REASON)"
    else
        echo "   Wear native symbols : Not generated"
    fi
fi
echo "=================================================="
