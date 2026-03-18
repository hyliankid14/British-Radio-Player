#!/usr/bin/env bash
set -euo pipefail

"$(cd "$(dirname "$0")" && pwd)/cloud/setup-google-cloud-index.sh" "$@"
