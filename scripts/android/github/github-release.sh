#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/../../.." && pwd))"
cd "$PROJECT_ROOT"

PROPS_FILE="gradle.properties"
RELEASE_ASSET_NAME="british-radio-player.apk"
APK_OUTPUT_DIR="app/build/outputs/apk/github/release"
APK_OUTPUT_PATH="$APK_OUTPUT_DIR/$RELEASE_ASSET_NAME"
WEAR_RELEASE_ASSET_NAME="british-radio-player-wear.apk"
WEAR_APK_OUTPUT_DIR="wear/build/outputs/apk/release"
WEAR_APK_OUTPUT_PATH="$WEAR_APK_OUTPUT_DIR/$WEAR_RELEASE_ASSET_NAME"

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

write_prop() {
    local key="$1"
    local value="$2"
    sed -i '' "s/^${key}=.*/${key}=${value}/" "$PROPS_FILE"
}

resolve_tag_commit() {
    local tag="$1"
    git rev-list -n 1 "$tag"
}

resolve_remote_tag_commit() {
    local tag="$1"
    local remote_commit

    remote_commit="$(git ls-remote --tags origin "refs/tags/${tag}^{}" | awk '{print $1}' | head -1)"
    if [[ -z "$remote_commit" ]]; then
        remote_commit="$(git ls-remote --tags origin "refs/tags/${tag}" | awk '{print $1}' | head -1)"
    fi

    echo "$remote_commit"
}

ensure_new_release_tag_available() {
    local tag="$1"

    if git rev-parse "$tag" >/dev/null 2>&1; then
        echo "Error: ${tag} already exists at $(resolve_tag_commit "$tag")."
        echo "Choose a new APP_VERSION_NAME before creating a new release commit."
        exit 1
    fi

    local remote_tag_commit
    remote_tag_commit="$(resolve_remote_tag_commit "$tag")"
    if [[ -n "$remote_tag_commit" ]]; then
        echo "Error: remote tag ${tag} already exists at ${remote_tag_commit}."
        echo "Choose a new APP_VERSION_NAME before creating a new release commit."
        exit 1
    fi
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

# ── Interactive version prompt ────────────────────────────────────────────────
echo ""
echo "Current version : ${VERSION_NAME}  (build ${VERSION_CODE})"
NEXT_CODE=$(( VERSION_CODE + 1 ))

read -rp "New version name [${VERSION_NAME}]: " INPUT_NAME
NEW_VERSION_NAME="${INPUT_NAME:-$VERSION_NAME}"

read -rp "New build code   [${NEXT_CODE}]: " INPUT_CODE
NEW_VERSION_CODE="${INPUT_CODE:-$NEXT_CODE}"

TAG="v${NEW_VERSION_NAME}"

if [[ "$NEW_VERSION_NAME" != "$VERSION_NAME" || "$NEW_VERSION_CODE" != "$VERSION_CODE" ]]; then
    ensure_new_release_tag_available "$TAG"
fi

if [[ "$NEW_VERSION_NAME" != "$VERSION_NAME" || "$NEW_VERSION_CODE" != "$VERSION_CODE" ]]; then
    write_prop APP_VERSION_NAME "$NEW_VERSION_NAME"
    write_prop APP_VERSION_CODE "$NEW_VERSION_CODE"
    git add "$PROPS_FILE"
    git commit -m "chore: bump version to v${NEW_VERSION_NAME} (build ${NEW_VERSION_CODE})"
    echo "gradle.properties updated and version bump committed."
fi

VERSION_NAME="$NEW_VERSION_NAME"
VERSION_CODE="$NEW_VERSION_CODE"
PHONE_VERSION_NAME="$VERSION_NAME"
PHONE_VERSION_CODE="$VERSION_CODE"
WEAR_VERSION_NAME="$VERSION_NAME"
WEAR_VERSION_CODE=$(( VERSION_CODE * 10 + 1 ))
echo ""
# ─────────────────────────────────────────────────────────────────────────────

RELEASE_COMMIT="$(git rev-parse HEAD)"

echo "Release commit: ${RELEASE_COMMIT}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
    TAG_COMMIT="$(resolve_tag_commit "$TAG")"
    if [[ "$TAG_COMMIT" != "$RELEASE_COMMIT" ]]; then
        echo "Error: ${TAG} already exists at ${TAG_COMMIT}, but current HEAD is ${RELEASE_COMMIT}."
        echo "Refusing to publish with a stale tag."
        echo "Either bump APP_VERSION_NAME to a new version, or move/delete the existing tag manually if that is intentional."
        exit 1
    fi
fi

if git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null 2>&1; then
    REMOTE_TAG_COMMIT="$(resolve_remote_tag_commit "$TAG")"
    if [[ -n "$REMOTE_TAG_COMMIT" && "$REMOTE_TAG_COMMIT" != "$RELEASE_COMMIT" ]]; then
        echo "Error: remote tag ${TAG} points to ${REMOTE_TAG_COMMIT}, but current HEAD is ${RELEASE_COMMIT}."
        echo "Refusing to update release for a different commit."
        echo "Create a new version tag, or explicitly retag on remote if you intend to replace this release."
        exit 1
    fi
fi

if [[ ! -x ./gradlew ]]; then
    chmod +x ./gradlew
fi

echo "Building GitHub release APKs for ${TAG} (phone + wear)..."
./gradlew \
    :app:assembleGithubRelease \
    :wear:assembleRelease \
    -PWEAR_VERSION_CODE="$WEAR_VERSION_CODE"

SIGNED_APK="$(find "$APK_OUTPUT_DIR" -type f -name "*.apk" ! -name "*-unsigned.apk" | head -1)"
if [[ -z "$SIGNED_APK" ]]; then
    echo "Error: no signed APK found under $APK_OUTPUT_DIR"
    exit 1
fi

cp "$SIGNED_APK" "$APK_OUTPUT_PATH"

SIGNED_WEAR_APK="$(find "$WEAR_APK_OUTPUT_DIR" -type f -name "*.apk" ! -name "*-unsigned.apk" | head -1)"
if [[ -z "$SIGNED_WEAR_APK" ]]; then
    echo "Error: no signed Wear APK found under $WEAR_APK_OUTPUT_DIR"
    exit 1
fi

cp "$SIGNED_WEAR_APK" "$WEAR_APK_OUTPUT_PATH"

PREV_TAG="$(git tag --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | grep -v "^${TAG}$" | head -1)"
NOTES_END_REF="HEAD"
if git rev-parse "$TAG" >/dev/null 2>&1; then
    # If rerunning for an existing tag, keep notes pinned to that tagged commit.
    NOTES_END_REF="$TAG"
fi

if [[ -n "$PREV_TAG" ]]; then
    COMMITS="$(git log --pretty=format:'%s' "${PREV_TAG}".."${NOTES_END_REF}" --no-merges)"
else
    COMMITS="$(git log --pretty=format:'%s' "${NOTES_END_REF}" --no-merges)"
fi

collect_matches() {
    local pattern="$1"
    local fallback="$2"
    local result
    result="$(printf '%s\n' "$COMMITS" | grep -E "$pattern" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g' || true)"
    if [[ -z "$result" ]]; then
        echo "- $fallback"
    else
        printf '%s\n' "$result" | sed 's/^/- /'
    fi
}

UI_ITEMS="$(collect_matches 'ui|layout|theme|settings|browse|search|filter|pagination|station|podcast' 'Improved interface polish and browsing reliability across radio and podcast sections.')"
PLAYBACK_ITEMS="$(collect_matches 'playback|audio|download|episode|stream|resume|buffer|notification' 'Playback and media handling improvements for more reliable listening.')"
AUTO_ITEMS="$(collect_matches 'android auto|auto|car|mini-player|mini player' 'General in-car and mini-player stability improvements.')"
SECURITY_ITEMS="$(collect_matches 'security|permission|keystore|storage|file|filesystem|provider' 'Storage and security hardening updates for release builds.')"
MAINT_ITEMS="$(collect_matches 'build|release|version|script|gradle|metadata|chore|refactor|fix' 'Release tooling and maintenance updates.')"

NOTES_FILE="$(mktemp)"
{
    echo "## British Radio Player ${TAG}"
    echo
    echo "### 📱 Version Matrix"
    echo "- Phone app: ${PHONE_VERSION_NAME} (Build ${PHONE_VERSION_CODE})"
    echo "- Wear OS app: ${WEAR_VERSION_NAME} (Build ${WEAR_VERSION_CODE})"
    echo
    echo "### ✨ UI Redesign & Browsing"
    echo "$UI_ITEMS"
    echo
    echo "### 🎧 Playback & Media Management"
    echo "$PLAYBACK_ITEMS"
    echo
    echo "### 🚗 Android Auto & Mini-Player"
    echo "$AUTO_ITEMS"
    echo
    echo "### 📂 Storage & Security"
    echo "$SECURITY_ITEMS"
    echo
    echo "### 🔒 Maintenance & Release"
    echo "$MAINT_ITEMS"
    echo "- Version bump: ${TAG} (Build ${VERSION_CODE})."
    echo
    echo "### 📦 Release Artifacts"
    echo "- ${RELEASE_ASSET_NAME}: A single, unified, installable APK for all supported devices."
    echo "- ${WEAR_RELEASE_ASSET_NAME}: Wear OS companion APK for watches."
    echo
    echo "Release Version: ${TAG} (Build ${PHONE_VERSION_CODE})"
    if [[ -n "$PREV_TAG" ]]; then
        echo "Full Changelog: https://github.com/hyliankid14/British-Radio-Player/compare/${PREV_TAG}...${TAG}"
    fi
} > "$NOTES_FILE"

if ! git rev-parse "$TAG" >/dev/null 2>&1; then
    git tag -a "$TAG" -m "Release ${TAG}" "$RELEASE_COMMIT"
fi

if ! git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
    git push origin "$TAG"
fi

if gh release view "$TAG" >/dev/null 2>&1; then
    gh release upload "$TAG" "$APK_OUTPUT_PATH#${RELEASE_ASSET_NAME}" --clobber
    gh release upload "$TAG" "$WEAR_APK_OUTPUT_PATH#${WEAR_RELEASE_ASSET_NAME}" --clobber
    gh release edit "$TAG" --title "$TAG" --notes-file "$NOTES_FILE"
else
    gh release create "$TAG" \
        "$APK_OUTPUT_PATH#${RELEASE_ASSET_NAME}" \
        "$WEAR_APK_OUTPUT_PATH#${WEAR_RELEASE_ASSET_NAME}" \
        --target "$RELEASE_COMMIT" \
        --title "$TAG" \
        --notes-file "$NOTES_FILE"
fi

rm -f "$NOTES_FILE"

echo "Release complete: ${TAG}"
