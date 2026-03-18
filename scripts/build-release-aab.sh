#!/usr/bin/env bash
set -euo pipefail

"$(cd "$(dirname "$0")" && pwd)/android/google-play/build-release-aab.sh" "$@"
