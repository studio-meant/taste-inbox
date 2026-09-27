#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
required=(
  "$ROOT/CLAUDE.md"
  "$ROOT/docs/DESIGN.md"
  "$ROOT/docs/IA_WIREFRAMES.md"
  "$ROOT/docs/PAGE_SPECIFICATIONS.md"
  "$ROOT/docs/FRONTEND_COMPONENT_ARCHITECTURE.md"
  "$ROOT/prototype/package.json"
  "$ROOT/prototype/src/app.js"
  "$ROOT/prototype/src/themeRegistry.js"
  "$ROOT/config/resource-policy.example.yaml"
  "$ROOT/reference/motion-demo.mp4"
)

for file in "${required[@]}"; do
  test -s "$file" || { echo "Missing or empty: $file" >&2; exit 1; }
done

# Generated and vendored trees are not part of the handoff package. Without these
# exclusions the scan reports third-party documentation as a leaked secret.
GENERATED=(
  --exclude-dir=node_modules
  --exclude-dir=.git
  --exclude-dir=.next
  --exclude-dir=.venv
  --exclude-dir=dist
  --exclude-dir=coverage
  --exclude-dir=var
  --exclude-dir=__pycache__
  --exclude-dir=.mypy_cache
  --exclude-dir=.ruff_cache
  --exclude-dir=.pytest_cache
)

if grep -RInE '(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA|OPENSSH) PRIVATE KEY)' "$ROOT" \
  "${GENERATED[@]}" --exclude='verify-handoff.sh' --exclude='MANIFEST.sha256'; then
  echo "Potential secret detected." >&2
  exit 1
fi

if grep -RInE '(M4 Mac mini|Mac mini M4|M4 compatible|M4에서|M4 16GB|M4 resource policy)' "$ROOT" \
  "${GENERATED[@]}" --exclude='verify-handoff.sh' --exclude='MANIFEST.sha256'; then
  echo "Stale device-specific runtime assumption detected." >&2
  exit 1
fi

echo "Handoff package OK"
