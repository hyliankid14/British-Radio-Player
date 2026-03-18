#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_ROOT"

PROPS_FILE="gradle.properties"
RELEASE_ASSET_NAME="bbc-radio-player.apk"
APK_OUTPUT_DIR="app/build/outputs/apk/github/release"
APK_OUTPUT_PATH="$APK_OUTPUT_DIR/$RELEASE_ASSET_NAME"

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Error: required command not found: $1"
        exit 1
    fi
}

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

require_cmd gh
require_cmd git

if ! gh auth status >/dev/null 2>&1; then
    echo "Error: GitHub CLI is not authenticated. Run: gh auth login"
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: working tree is not clean. Commit/stash changes before creating a release."
    exit 1
fi

VERSION_NAME="$(read_prop APP_VERSION_NAME)"
VERSION_CODE="$(read_prop APP_VERSION_CODE)"
if [[ -z "$VERSION_NAME" || -z "$VERSION_CODE" ]]; then
    echo "Error: APP_VERSION_NAME and APP_VERSION_CODE must be set in $PROPS_FILE"
    exit 1
fi

TAG="v${VERSION_NAME}"

if [[ ! -x ./gradlew ]]; then
    chmod +x ./gradlew
fi

echo "Building GitHub release APK for ${TAG}..."
./gradlew :app:assembleGithubRelease

SIGNED_APK="$(find "$APK_OUTPUT_DIR" -type f -name "*.apk" ! -name "*-unsigned.apk" | head -1)"
if [[ -z "$SIGNED_APK" ]]; then
    echo "Error: no signed APK found under $APK_OUTPUT_DIR"
    exit 1
fi

cp "$SIGNED_APK" "$APK_OUTPUT_PATH"

LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
if [[ -n "$LAST_TAG" ]]; then
    COMMITS="$(git log --pretty=format:'- %s' "${LAST_TAG}"..HEAD --no-merges)"
else
    COMMITS="$(git log --pretty=format:'- %s' -n 40 --no-merges)"
fi

if [[ -z "$COMMITS" ]]; then
    COMMITS="- Maintenance release"
fi

NOTES_FILE="$(mktemp)"
{
    echo "## BBC Radio Player ${TAG}"
    echo
    echo "### Highlights"
    echo "$COMMITS"
    echo
    echo "### Build"
    echo "- Version: ${VERSION_NAME}"
    echo "- Version code: ${VERSION_CODE}"
    echo "- Distribution: GitHub"
} > "$NOTES_FILE"

if ! git rev-parse "$TAG" >/dev/null 2>&1; then
    git tag -a "$TAG" -m "Release ${TAG}" HEAD
fi

if ! git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
    git push origin "$TAG"
fi

if gh release view "$TAG" >/dev/null 2>&1; then
    gh release upload "$TAG" "$APK_OUTPUT_PATH#${RELEASE_ASSET_NAME}" --clobber
else
    gh release create "$TAG" "$APK_OUTPUT_PATH#${RELEASE_ASSET_NAME}" \
        --title "$TAG" \
        --notes-file "$NOTES_FILE"
fi

rm -f "$NOTES_FILE"

echo "Release complete: ${TAG}"
