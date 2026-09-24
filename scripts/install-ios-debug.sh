#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/react-app"
BUNDLE_ID="com.hyliankid14.BBCRadioPlayer.react"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must be run on macOS with Xcode installed." >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Xcode command-line tools are required. Install Xcode and run xcode-select --install." >&2
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun is required but was not found on PATH." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found on PATH." >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/node_modules" ]]; then
  echo "Installing React Native dependencies..."
  (cd "$APP_DIR" && npm install)
fi

REQUESTED_DEVICE=""
BINARY_PATH=""
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device|-d)
      REQUESTED_DEVICE="$2"
      shift 2
      ;;
    --binary)
      BINARY_PATH="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: ./scripts/install-ios-debug.sh [device-name-or-udid] [options]"
      echo ""
      echo "Options:"
      echo "  -d, --device <name|udid>  Target a specific connected iPhone"
      echo "  --binary <path>           Path to existing .app bundle to install directly"
      echo "  -h, --help                Show this help message"
      exit 0
      ;;
    *)
      if [[ -z "$REQUESTED_DEVICE" && ! "$1" =~ ^- ]]; then
        REQUESTED_DEVICE="$1"
      else
        PASSTHROUGH_ARGS+=("$1")
      fi
      shift
      ;;
  esac
done

REQUESTED_DEVICE="${REQUESTED_DEVICE:-${IOS_DEVICE:-}}"

echo "Discovering connected physical iOS devices..."

# Extract physical devices list using devicectl (or xctrace fallback)
PHYSICAL_DEVICES_JSON="[]"
if command -v devicectl >/dev/null 2>&1 || xcrun --find devicectl >/dev/null 2>&1; then
  PHYSICAL_DEVICES_JSON="$(xcrun devicectl list devices --json-output - 2>/dev/null | node -e '
let data = "";
process.stdin.on("data", chunk => data += chunk);
process.stdin.on("end", () => {
  try {
    const json = JSON.parse(data);
    const devices = json.result?.devices || [];
    const physical = devices.filter(d =>
      d.hardwareProperties?.reality === "physical" ||
      d.properties?.hardware?.reality === "physical"
    );
    console.log(JSON.stringify(physical.map(d => ({
      name: d.deviceProperties?.name || d.properties?.state?.name || "iPhone",
      udid: d.hardwareProperties?.udid || d.properties?.hardware?.udid || d.identifier,
      state: d.connectionProperties?.tunnelState || d.properties?.connection?.state || "unknown",
      model: d.hardwareProperties?.marketingName || d.properties?.hardware?.marketingName || ""
    }))));
  } catch (e) {
    console.log("[]");
  }
});' || echo "[]")"
fi

DEVICE_COUNT="$(node -e "const d = $PHYSICAL_DEVICES_JSON; console.log(d.length);")"

TARGET_UDID=""
TARGET_NAME=""

if [[ "$DEVICE_COUNT" -gt 0 ]]; then
  if [[ -n "$REQUESTED_DEVICE" ]]; then
    # Match by name or UDID
    MATCH_INFO="$(node -e "
      const devices = $PHYSICAL_DEVICES_JSON;
      const target = '$REQUESTED_DEVICE'.toLowerCase();
      const found = devices.find(d => d.udid.toLowerCase() === target || d.name.toLowerCase() === target || d.name.toLowerCase().includes(target));
      if (found) console.log(JSON.stringify(found));
    ")"
    if [[ -n "$MATCH_INFO" ]]; then
      TARGET_UDID="$(node -e "console.log(($MATCH_INFO).udid)")"
      TARGET_NAME="$(node -e "console.log(($MATCH_INFO).name)")"
      TARGET_STATE="$(node -e "console.log(($MATCH_INFO).state)")"
    else
      echo "Requested device '$REQUESTED_DEVICE' not found." >&2
      echo "Discovered physical devices:" >&2
      node -e "const d = $PHYSICAL_DEVICES_JSON; d.forEach(x => console.log('  - ' + x.name + ' (' + x.udid + ') [' + x.state + ']'));" >&2
      exit 1
    fi
  elif [[ "$DEVICE_COUNT" -eq 1 ]]; then
    TARGET_UDID="$(node -e "console.log($PHYSICAL_DEVICES_JSON[0].udid)")"
    TARGET_NAME="$(node -e "console.log($PHYSICAL_DEVICES_JSON[0].name)")"
    TARGET_STATE="$(node -e "console.log($PHYSICAL_DEVICES_JSON[0].state)")"
  else
    # Find first available/connected physical device
    FIRST_CONN="$(node -e "
      const devices = $PHYSICAL_DEVICES_JSON;
      const conn = devices.find(d => d.state === 'connected' || d.state === 'available') || devices[0];
      console.log(JSON.stringify(conn));
    ")"
    TARGET_UDID="$(node -e "console.log(($FIRST_CONN).udid)")"
    TARGET_NAME="$(node -e "console.log(($FIRST_CONN).name)")"
    TARGET_STATE="$(node -e "console.log(($FIRST_CONN).state)")"
  fi

  if [[ "$TARGET_STATE" == "unavailable" || "$TARGET_STATE" == "disconnected" ]]; then
    echo "Notice: $TARGET_NAME ($TARGET_UDID) is currently '$TARGET_STATE'." >&2
    echo "Ensure the iPhone is unlocked, connected via USB, trusted, and Developer Mode is enabled." >&2
  fi
else
  # Check if an iPhone is detected via xctrace
  XCTRACE_OUTPUT="$(xcrun xctrace list devices 2>/dev/null || true)"
  if echo "$XCTRACE_OUTPUT" | grep -q "Devices Offline"; then
    OFFLINE_DEV="$(echo "$XCTRACE_OUTPUT" | grep -A 5 "Devices Offline" | grep -E '\([0-9A-Fa-f-]+\)' | head -n 1 || true)"
    if [[ -n "$OFFLINE_DEV" ]]; then
      echo "An iPhone was detected but is offline or locked:" >&2
      echo "  $OFFLINE_DEV" >&2
      echo "" >&2
      echo "Please unlock your iPhone, trust this Mac if prompted, and ensure Developer Mode is enabled" >&2
      echo "(Settings > Privacy & Security > Developer Mode)." >&2
      exit 1
    fi
  fi

  echo "No connected physical iOS device detected." >&2
  echo "Connect your iPhone via USB, unlock it, and try again." >&2
  exit 1
fi

echo "Target device: $TARGET_NAME ($TARGET_UDID)"

cd "$APP_DIR"

if [[ -n "$BINARY_PATH" && -e "$BINARY_PATH" ]]; then
  echo "Installing prebuilt application binary ($BINARY_PATH)..."
  xcrun devicectl device install app --device "$TARGET_UDID" "$BINARY_PATH"
  echo "App installed successfully on $TARGET_NAME."
  exit 0
fi

echo "Building and installing React Native Debug app onto $TARGET_NAME..."
npx expo run:ios --device "$TARGET_UDID" --configuration Debug --no-bundler ${PASSTHROUGH_ARGS[@]+"${PASSTHROUGH_ARGS[@]}"}

echo ""
echo "=== Installation complete ==="
echo "The Debug build has been installed onto $TARGET_NAME."
echo "To start the development server for live refresh on this device, run:"
echo "  npm run ios:dev"
echo "or:"
echo "  npx expo start --dev-client"
