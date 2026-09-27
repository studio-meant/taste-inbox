#!/usr/bin/env bash
#
# Checksum the handoff package.
#
# MANIFEST.sha256 covers what arrived with the brief — the specs, the shipped example
# config, the prototype and its reference media — and deliberately not the application
# code, which git already tracks. Its job is to make an unnoticed edit to a source-of-truth
# document visible.
#
#   scripts/manifest.sh check    verify nothing drifted (default)
#   scripts/manifest.sh write    regenerate after an intentional amendment
#
# Regenerating is a deliberate act: it is how an amendment to docs/DECISIONS.md or to a
# shipped example config becomes the new baseline. Do it in the same change that makes the
# edit, never as a way to clear a failure you have not read.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MANIFEST="MANIFEST.sha256"
MODE="${1:-check}"

# Every tracked file under these roots, plus the root-level documents. Sorted so the
# manifest is stable across machines and a diff shows only what actually changed.
collect() {
  {
    printf '%s\n' .env.example .gitignore CLAUDE.md CONTENTS.md README.md START_HERE.md
    find config docs prototype reference scripts \
      -type f \
      ! -name '.DS_Store' \
      ! -path '*/node_modules/*' \
      -print
  } | sed 's|^|./|' | LC_ALL=C sort
}

case "$MODE" in
check)
  if [[ ! -f $MANIFEST ]]; then
    echo "$MANIFEST is missing; run: scripts/manifest.sh write" >&2
    exit 1
  fi
  # Report every mismatch, not just the first, so one run tells the whole story.
  if ! shasum -a 256 -c "$MANIFEST" --quiet; then
    echo >&2
    echo "Handoff package drifted. Read the diff; if the edit was intended," >&2
    echo "run: scripts/manifest.sh write" >&2
    exit 1
  fi
  echo "Handoff package matches $MANIFEST"
  ;;
write)
  collect | xargs shasum -a 256 >"$MANIFEST"
  echo "Wrote $MANIFEST ($(wc -l <"$MANIFEST" | tr -d ' ') files)"
  ;;
*)
  echo "usage: scripts/manifest.sh [check|write]" >&2
  exit 2
  ;;
esac
