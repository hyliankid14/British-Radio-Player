#!/usr/bin/env bash
# Verifies that every arm64 native library inside an Android App Bundle (or APK) is linked for
# 16 KB memory pages.
#
# Google Play requires 16 KB page size support for apps targeting Android 15+.  An app fails the
# requirement when any arm64-v8a ELF shared object has a PT_LOAD segment aligned to less than
# 2**14 bytes (16 KB).  Prebuilt native libraries — Hermes, react-android, MMKV, Nitro modules,
# react-native-track-player — are the usual offenders, so this is checked on every release build
# rather than discovered at upload time.
#
# Usage: .github/scripts/verify-16kb.sh <bundle> [label]
set -euo pipefail

BUNDLE="${1:-}"
LABEL="${2:-$BUNDLE}"

if [[ -z "$BUNDLE" ]]; then
  echo "Usage: $(basename "$0") <bundle.aab|apk> [label]" >&2
  exit 1
fi

if [[ ! -f "$BUNDLE" ]]; then
  echo "❌ ${LABEL}: file not found: ${BUNDLE}" >&2
  exit 1
fi

OBJDUMP_BIN="$(command -v objdump || true)"

if [[ -z "$OBJDUMP_BIN" ]]; then
  echo "❌ ${LABEL}: objdump not found; cannot verify 16 KB native page-size support." >&2
  echo "   Install binutils (apt-get install -y binutils) and re-run." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# App Bundles store libraries under base/lib, APKs under lib.
unzip -oq "$BUNDLE" 'base/lib/arm64-v8a/*.so' -d "$WORK_DIR" 2>/dev/null || true
if ! find "$WORK_DIR/base/lib/arm64-v8a" -type f -name '*.so' 2>/dev/null | grep -q .; then
  unzip -oq "$BUNDLE" 'lib/arm64-v8a/*.so' -d "$WORK_DIR" 2>/dev/null || true
fi
LIB_DIR="$WORK_DIR/base/lib/arm64-v8a"
if [[ ! -d "$LIB_DIR" ]]; then
  LIB_DIR="$WORK_DIR/lib/arm64-v8a"
fi

if ! find "$LIB_DIR" -type f -name '*.so' 2>/dev/null | grep -q .; then
  echo "ℹ️  ${LABEL}: no arm64 native libraries found; nothing to verify."
  exit 0
fi

FAILED=0
while IFS= read -r so_file; do
  load_lines="$("$OBJDUMP_BIN" -x "$so_file" | awk '/^[[:space:]]*LOAD /')"
  if [[ -z "$load_lines" ]]; then
    echo "❌ ${LABEL}: could not read LOAD segments from $(basename "$so_file")"
    FAILED=1
    continue
  fi

  # Report the library once, however many of its segments are under-aligned.
  library_bad=0
  library_detail=""
  while IFS= read -r load_line; do
    [[ -z "$load_line" ]] && continue
    align_pow="$(printf '%s\n' "$load_line" | sed -nE 's/.*align 2\*\*([0-9]+).*/\1/p')"
    if [[ -z "$align_pow" ]]; then
      library_bad=1
      library_detail="has a LOAD segment with no align value"
    elif [[ "$align_pow" -lt 14 ]]; then
      library_bad=1
      library_detail="is linked for 4 KB pages (LOAD align 2**${align_pow})"
    fi
  done <<< "$load_lines"

  if [[ "$library_bad" -ne 0 ]]; then
    echo "❌ ${LABEL}: $(basename "$so_file") ${library_detail}"
    FAILED=1
  fi
done < <(find "$LIB_DIR" -type f -name '*.so' | sort)

if [[ "$FAILED" -ne 0 ]]; then
  echo "❌ ${LABEL} failed 16 KB native page-size validation."
  echo "   Google Play will reject this bundle. Rebuild or replace the offending library"
  echo "   with a 16 KB-aligned build before uploading." >&2
  exit 1
fi

COUNT="$(find "$LIB_DIR" -type f -name '*.so' | wc -l | tr -d ' ')"
echo "✅ ${LABEL}: ${COUNT} arm64 native libraries pass 16 KB page-size validation."
