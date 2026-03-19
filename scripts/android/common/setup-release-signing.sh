#!/bin/bash
set -euo pipefail

KEYSTORE_DIR_DEFAULT="$HOME/.keystores"
KEYSTORE_FILE_DEFAULT="british-radio-player-release.jks"
KEY_ALIAS_DEFAULT="british-radio-player"
GRADLE_PROPS="$HOME/.gradle/gradle.properties"

ensure_dir() {
    local dir="$1"
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
    fi
}

prompt_default() {
    local prompt="$1"
    local default="$2"
    local value
    read -r -p "$prompt [$default]: " value
    if [ -z "$value" ]; then
        value="$default"
    fi
    echo "$value"
}

is_ascii_printable() {
    local value="$1"
    local byte

    for byte in $(printf '%s' "$value" | LC_ALL=C od -An -v -t u1); do
        # Allow standard printable ASCII only (space through ~)
        if [ "$byte" -lt 32 ] || [ "$byte" -gt 126 ]; then
            return 1
        fi
    done

    return 0
}

prompt_secret_confirm() {
    local label="$1"
    local first second
    while true; do
        read -r -s -p "$label: " first
        echo >&2
        read -r -s -p "Confirm $label: " second
        echo >&2

        # Some clipboard pastes include trailing carriage return on Linux terminals.
        first="${first%$'\r'}"
        second="${second%$'\r'}"

        if [ "$first" != "$second" ]; then
            echo "Values do not match. Try again." >&2
            continue
        fi
        if [ -z "$first" ]; then
            echo "Value cannot be empty. Try again." >&2
            continue
        fi
        if ! is_ascii_printable "$first"; then
            echo "Value must contain printable ASCII characters only." >&2
            echo "Tip: if you pasted it, try typing once to rule out hidden clipboard characters." >&2
            continue
        fi
        echo "$first"
        return 0
    done
}

echo "════════════════════════════════════════════════════════════"
echo "🔐 Release Signing Setup"
echo "════════════════════════════════════════════════════════════"
echo

KEYSTORE_DIR=$(prompt_default "Keystore directory" "$KEYSTORE_DIR_DEFAULT")
KEYSTORE_FILE=$(prompt_default "Keystore filename" "$KEYSTORE_FILE_DEFAULT")
KEY_ALIAS=$(prompt_default "Key alias" "$KEY_ALIAS_DEFAULT")
KEYSTORE_PATH="$KEYSTORE_DIR/$KEYSTORE_FILE"

echo
if [ -f "$KEYSTORE_PATH" ]; then
    echo "⚠️  Keystore already exists: $KEYSTORE_PATH"
    read -r -p "Reuse this keystore? (y/n): " REUSE
    if [ "$REUSE" != "y" ]; then
        echo "Aborted. Choose a different path next time."
        exit 1
    fi
    read -r -s -p "Existing keystore password: " STORE_PASSWORD
    echo
    read -r -s -p "Key password (often same as keystore password): " KEY_PASSWORD
    echo
else
    ensure_dir "$KEYSTORE_DIR"

    STORE_PASSWORD=$(prompt_secret_confirm "Set keystore password")
    KEY_PASSWORD=$(prompt_secret_confirm "Set key password")

    echo
    echo "Certificate identity (used for keystore metadata):"
    CN=$(prompt_default "Common Name (CN)" "British Radio Player")
    OU=$(prompt_default "Org Unit (OU)" "Development")
    O=$(prompt_default "Organization (O)" "British Radio Player")
    L=$(prompt_default "City/Locality (L)" "Unknown")
    ST=$(prompt_default "State/Province (ST)" "Unknown")
    C=$(prompt_default "Country code (C, 2 letters)" "GB")

    DNAME="CN=$CN, OU=$OU, O=$O, L=$L, ST=$ST, C=$C"

    echo
    echo "🛠️  Generating keystore..."
    keytool -genkeypair \
        -v \
        -keystore "$KEYSTORE_PATH" \
        -alias "$KEY_ALIAS" \
        -keyalg RSA \
        -keysize 4096 \
        -validity 10000 \
        -storepass "$STORE_PASSWORD" \
        -keypass "$KEY_PASSWORD" \
        -dname "$DNAME"

    echo "✅ Keystore created: $KEYSTORE_PATH"
fi

ensure_dir "$(dirname "$GRADLE_PROPS")"
if [ -f "$GRADLE_PROPS" ]; then
    cp "$GRADLE_PROPS" "${GRADLE_PROPS}.bak"
fi

TMP_FILE=$(mktemp)
if [ -f "$GRADLE_PROPS" ]; then
    grep -Ev '^(RELEASE_STORE_FILE|RELEASE_STORE_PASSWORD|RELEASE_KEY_ALIAS|RELEASE_KEY_PASSWORD)=' "$GRADLE_PROPS" > "$TMP_FILE" || true
fi

{
    echo "RELEASE_STORE_FILE=$KEYSTORE_PATH"
    echo "RELEASE_STORE_PASSWORD=$STORE_PASSWORD"
    echo "RELEASE_KEY_ALIAS=$KEY_ALIAS"
    echo "RELEASE_KEY_PASSWORD=$KEY_PASSWORD"
} >> "$TMP_FILE"

mv "$TMP_FILE" "$GRADLE_PROPS"
chmod 600 "$GRADLE_PROPS"

echo
echo "✅ Signing config written to: $GRADLE_PROPS"
echo "✅ Ready to create signed releases."
echo
echo "Next steps:"
echo "1) ./scripts/github-release.sh"
echo "2) Keep your keystore and passwords backed up securely"
