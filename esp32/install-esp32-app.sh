#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ESP32_DIR="$REPO_ROOT/esp32"

usage() {
  cat <<'EOF'
Install BBC Radio Player ESP32 firmware to a connected device.

Usage:
  scripts/install-esp32-app.sh [--port <serial-port>] [--monitor]

Options:
  --port <serial-port>  Serial port to use (for example: /dev/cu.usbmodem1101)
  --monitor             Open serial monitor after flashing
  -h, --help            Show this help message

Environment variables:
  ESP32_PORT            Alternative way to set the serial port

Examples:
  scripts/install-esp32-app.sh
  scripts/install-esp32-app.sh --port /dev/cu.usbmodem1101
  scripts/install-esp32-app.sh --monitor
EOF
}

detect_port() {
  local candidates=()

  # macOS common USB serial devices
  while IFS= read -r p; do candidates+=("$p"); done < <(ls /dev/cu.usbmodem* 2>/dev/null || true)
  while IFS= read -r p; do candidates+=("$p"); done < <(ls /dev/cu.usbserial* 2>/dev/null || true)
  while IFS= read -r p; do candidates+=("$p"); done < <(ls /dev/cu.SLAB_USBtoUART* 2>/dev/null || true)
  while IFS= read -r p; do candidates+=("$p"); done < <(ls /dev/cu.wchusbserial* 2>/dev/null || true)

  # Linux common USB serial devices (for portability)
  while IFS= read -r p; do candidates+=("$p"); done < <(ls /dev/ttyUSB* 2>/dev/null || true)
  while IFS= read -r p; do candidates+=("$p"); done < <(ls /dev/ttyACM* 2>/dev/null || true)

  if [[ ${#candidates[@]} -eq 0 ]]; then
    return 1
  fi

  printf '%s\n' "${candidates[0]}"
}

ensure_idf_available() {
  if command -v idf.py >/dev/null 2>&1; then
    return 0
  fi

  local export_script="$HOME/esp/esp-idf/export.sh"
  if [[ -f "$export_script" ]]; then
    # shellcheck disable=SC1090
    . "$export_script" >/dev/null 2>&1
  fi

  if ! command -v idf.py >/dev/null 2>&1; then
    echo "Error: idf.py is not available."
    echo "Please install ESP-IDF or set it up first."
    echo "Tried sourcing: $export_script"
    exit 1
  fi
}

PORT="${ESP32_PORT:-}"
OPEN_MONITOR=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      if [[ $# -lt 2 ]]; then
        echo "Error: --port requires a value"
        usage
        exit 1
      fi
      PORT="$2"
      shift 2
      ;;
    --monitor)
      OPEN_MONITOR=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ ! -d "$ESP32_DIR" ]]; then
  echo "Error: ESP32 directory not found: $ESP32_DIR"
  exit 1
fi

ensure_idf_available

if [[ -z "$PORT" ]]; then
  if ! PORT="$(detect_port)"; then
    echo "Error: no connected ESP32 serial device found."
    echo "Use --port to specify a device manually."
    exit 1
  fi
fi

echo "Using serial port: $PORT"
cd "$ESP32_DIR"

if [[ "$OPEN_MONITOR" == true ]]; then
  idf.py -p "$PORT" build flash monitor
else
  idf.py -p "$PORT" build flash
fi
