#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
IOS_DIR="$ROOT_DIR/ios"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required but not installed. Install Homebrew first: https://brew.sh"
  exit 1
fi

echo "Installing iOS project tooling (xcodegen + mas)..."
brew install xcodegen mas

echo "Checking full Xcode availability..."
if xcodebuild -version >/dev/null 2>&1; then
  echo "Xcode CLI build tools are available."
else
  echo "Full Xcode is not active yet."
  echo "1) Install Xcode from App Store (ADAM ID 497799835): mas install 497799835"
  echo "2) Launch Xcode once and accept the licence"
  echo "3) Set developer dir: sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer"
fi

echo "Generating Xcode project..."
cd "$IOS_DIR"
xcodegen generate

echo "Done. Open: $IOS_DIR/BBCRadioPlayer.xcodeproj"
