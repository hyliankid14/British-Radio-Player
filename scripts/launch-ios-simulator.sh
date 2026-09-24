#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found on PATH." >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/node_modules" ]]; then
  echo "Installing React Native dependencies..."
  (cd "$APP_DIR" && npm install)
fi

# Ensure iOS Simulator is running
DEVICE_HUB=""
for candidate in \
  "/Applications/Device Hub.app" \
  "$HOME/Applications/Device Hub.app" \
  "/System/Applications/Device Hub.app"
do
  if [[ -d "$candidate" ]]; then
    DEVICE_HUB="$candidate"
    break
  fi
done

if [[ -n "$DEVICE_HUB" ]]; then
  open "$DEVICE_HUB"
elif open -a DeviceHub 2>/dev/null; then
  :
elif [[ -d "/Applications/Simulator.app" ]] || open -a Simulator 2>/dev/null; then
  open -a Simulator 2>/dev/null || true
else
  echo "Unable to find Device Hub or Simulator in the standard macOS application locations." >&2
  echo "Install Xcode and its iOS simulator components, then try again." >&2
  exit 1
fi

# Ensure a simulator is booted
BOOTED_SIM="$(xcrun simctl list devices booted 2>/dev/null | grep -E '\([A-F0-9-]+\)' | head -n 1 || true)"
if [[ -z "$BOOTED_SIM" ]]; then
  echo "Booting default iOS simulator..."
  DEFAULT_SIM="$(xcrun simctl list devices available 2>/dev/null | grep -E 'iPhone' | grep -v 'unavailable' | head -n 1 | sed -E 's/.*\(([A-F0-9-]+)\).*/\1/' || true)"
  if [[ -n "$DEFAULT_SIM" ]]; then
    xcrun simctl boot "$DEFAULT_SIM" 2>/dev/null || true
  fi
fi

# Wait for booted simulator to become ready
xcrun simctl bootstatus booted -b 2>/dev/null || true

# Parse flags: check if clean rebuild requested
REBUILD=false
PASSTHROUGH_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --rebuild|--build|-b)
      REBUILD=true
      ;;
    *)
      PASSTHROUGH_ARGS+=("$arg")
      ;;
  esac
done

cd "$APP_DIR"

# Check if the app is already installed on the booted simulator
APP_CONTAINER="$(xcrun simctl get_app_container booted "$BUNDLE_ID" 2>/dev/null || true)"

if [[ -z "$APP_CONTAINER" || "$REBUILD" == true ]]; then
  echo "Building and installing React app onto simulator..."
  npx expo run:ios --no-bundler
fi

# Launch a background waiter that ensures Metro is ready before launching the app on the simulator.
# This prevents the "No script URL provided. unsanitizedScriptURLString = (null)" error if the app starts
# before Metro is listening on port 8081.
(
  for i in {1..60}; do
    if curl -s http://localhost:8081/status 2>/dev/null | grep -q "packager-status:running"; then
      sleep 0.5
      xcrun simctl launch booted "$BUNDLE_ID" 2>/dev/null || true
      exit 0
    fi
    sleep 0.5
  done
) &

# Start Expo Metro development server with live refresh / Fast Refresh
echo "Starting Metro bundler with Live Refresh (Fast Refresh)..."
exec npx expo start --localhost ${PASSTHROUGH_ARGS[@]+"${PASSTHROUGH_ARGS[@]}"}
