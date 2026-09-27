#!/usr/bin/env bash
#
# Repository invariants that no linter or type checker can express.
#
# Runs in CI and locally via `pnpm verify`. It is deliberately fast and dependency-free
# so it can be a pre-push habit rather than a special occasion.
#
# `scripts/verify-handoff.sh` is a separate, narrower check that validates the original
# handoff package. This script covers the production tree.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

failures=0

fail() {
  printf '  ✗ %s\n' "$1" >&2
  failures=$((failures + 1))
}

pass() {
  printf '  ✓ %s\n' "$1"
}

# prototype/ and reference/ are the visual source of truth, not production code.
PRODUCTION_EXCLUDES=(
  --exclude-dir=node_modules
  --exclude-dir=.git
  --exclude-dir=.next
  --exclude-dir=.venv
  --exclude-dir=dist
  --exclude-dir=coverage
  --exclude-dir=var
  --exclude-dir=__pycache__
  --exclude-dir=.ruff_cache
  --exclude-dir=.mypy_cache
  --exclude-dir=.pytest_cache
  --exclude-dir=prototype
  --exclude-dir=reference
  --exclude-dir=vendor
  --exclude=verify-repo.sh
  --exclude=verify-handoff.sh
  --exclude=MANIFEST.sha256
  --exclude=pnpm-lock.yaml
  --exclude=uv.lock
)

echo "Taste Inbox — repository verification"
echo

# ---------------------------------------------------------------- 1. no secrets
echo "Secrets"
if grep -rInE '(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY)' \
  "${PRODUCTION_EXCLUDES[@]}" . >/dev/null 2>&1; then
  grep -rInE '(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY)' \
    "${PRODUCTION_EXCLUDES[@]}" . >&2 || true
  fail "credential-shaped string found"
else
  pass "no credential-shaped strings"
fi

# Only tracked files can actually be committed, so ask git rather than the filesystem.
# This is what keeps local caches (.mypy_cache, .next) from producing false alarms.
if git rev-parse --git-dir >/dev/null 2>&1; then
  artefacts=$(git ls-files | grep -iE '(cookies.*\.json|storage-state.*\.json|auth-state.*\.json|\.har$|\.sqlite[0-9]*$|\.db$|\.pem$|\.key$)' || true)
  if [ -n "$artefacts" ]; then
    printf '%s\n' "$artefacts" >&2
    fail "session, key or database artefact is tracked by git"
  else
    pass "no session, key or database artefact is tracked"
  fi

  # Somebody else's name is the thing that cannot be taken back once it is pushed. The
  # first commit carried eleven of them — real Threads handles, LinkedIn names, an
  # Instagram shortcode and caption — because the fixtures were built from real captures
  # and the sanitising stopped at the parser.
  #
  # Sanitized fixtures use documented synthetic ids. The set lives in
  # .github/allowed-fixture-urls.txt so CI and this gate cannot drift apart — two
  # allowlists would mean one of them is wrong and nobody finds out which.
  #
  # `--others --exclude-standard` matters. Before the first commit `git ls-files` is empty,
  # so a check that asks only about tracked files passes by having nothing to look at —
  # which is exactly how the real data got in.
  strangers=$(git ls-files --cached --others --exclude-standard -z 2>/dev/null |
    grep -zv '^\.github/allowed-fixture-urls\.txt$' |
    xargs -0 grep -noIE 'instagram\.com/(p|reel)/[A-Za-z0-9_-]{11}|threads\.com/@[a-z0-9_.]+/post/[A-Za-z0-9_-]{11}|urn:li:(activity|ugcPost):[0-9]{15,}' 2>/dev/null |
    grep -vFf <(grep -v '^#' .github/allowed-fixture-urls.txt | grep -v '^$') |
    grep -vE ':1[0-9]{18}$' || true)
  if [ -n "$strangers" ]; then
    printf '%s\n' "$strangers" >&2
    fail "a real-looking account or permalink appears outside the synthetic fixture set"
  else
    pass "no third-party permalink outside the synthetic fixture set"
  fi
else
  fail "not a git repository; cannot verify tracked files"

fi
echo

# ------------------------------------------------- 2. no fixed hardware profile
# The locked decision is that limits are derived from the host detected at runtime
# (CLAUDE.md §2, DECISIONS.md → Host). These checks look for the two ways that decision
# gets reversed in practice: naming a device, or shipping a pinned profile.
echo "Runtime hardware adaptation"
if grep -rInE '(M[1-9](\s*(Pro|Max|Ultra))?\s*Mac ?(mini|Studio|Book)|Mac ?(mini|Studio|Book)\s*M[1-9])' \
  "${PRODUCTION_EXCLUDES[@]}" --include='*.ts' --include='*.tsx' --include='*.py' \
  --include='*.yaml' --include='*.yml' --include='*.json' --include='*.md' . >/dev/null 2>&1; then
  fail "a specific Mac model is named"
else
  pass "no specific Mac model is named"
fi

# The shipped example config must not pin a device. Every manual_override value is null;
# operators may fill them in locally, but the committed default detects instead.
if python3 - <<'PY'
import sys, re, pathlib
text = pathlib.Path("config/resource-policy.example.yaml").read_text(encoding="utf-8")
block = re.search(r"^  manual_override:\n((?:    .*\n)+)", text, re.MULTILINE)
if block is None:
    sys.exit(1)
values = re.findall(r"^    \w+:\s*(.+?)\s*$", block.group(1), re.MULTILINE)
sys.exit(0 if values and all(v == "null" for v in values) else 1)
PY
then
  pass "shipped config pins no device profile"
else
  fail "config/resource-policy.example.yaml pins a device profile"
fi

# The detector must actually read the host rather than assume it.
if grep -q 'hw.memsize' apps/api/src/taste_inbox/host/detector.py &&
  grep -q 'disk_usage' apps/api/src/taste_inbox/host/detector.py &&
  grep -q 'memorystatus_vm_pressure_level' apps/api/src/taste_inbox/host/detector.py; then
  pass "detector reads memory, storage and pressure from the host"
else
  fail "detector no longer reads a required host signal"
fi
echo

# ------------------------------------------------------ 3. locked product facts
echo "Locked decisions"
if python3 - <<'PY'
import json, pathlib, sys
data = json.loads(pathlib.Path("packages/ui/theme-ids.json").read_text(encoding="utf-8"))
expected = [
    "meadow-cream",
    "moss-cream",
    "spring-sage",
    "bright-forest",
    "ivory-sage",
    "oatwood-cream",
]
ok = (
    data["themeIds"] == expected
    and data["defaultThemeId"] == "meadow-cream"
    and data["storageKey"] == "taste-inbox-component-theme-v4"
)
sys.exit(0 if ok else 1)
PY
then
  pass "six themes, default meadow-cream, storage key v4"
else
  fail "theme identity changed (docs/THEME_SYSTEM.md, DECISIONS.md)"
fi

# 2026-09-28: this used to fail when OpenClaw was referenced at all, because the inherited
# product did not use it. This distribution does (docs/DECISIONS.md). Deleting the check
# would have traded a real invariant for nothing, so it was replaced by the one the new
# decision actually depends on: the sandbox must never see the host filesystem.
#
# `--host-mount` is the NemoClaw onboarding flag that would grant it. The decision that
# re-allows code execution is only sound while that flag is absent, so absence is checked
# rather than described. The flag name is assembled at runtime so this file does not match
# its own pattern.
host_mount_flag="--host-$(printf 'mount')"
if grep -rIn -- "$host_mount_flag" "${PRODUCTION_EXCLUDES[@]}" --include='*.ts' --include='*.tsx' \
  --include='*.py' --include='*.yaml' --include='*.sh' . >/dev/null 2>&1; then
  fail "the sandbox is given a host mount; DECISIONS.md 2026-09-28 forbids it"
else
  pass "sandbox never mounts the host filesystem"
fi

# The agent runtime and the policy engine are reached from one place. Scattering
# `openclaw`/`openshell`/`nemoclaw` invocations across the codebase is how an unreviewed
# second path to execution appears; keeping them in `sandbox/` keeps the boundary auditable.
stray_runtime_calls=$(grep -rIlE 'subprocess\.(run|Popen|check_output)' \
  "${PRODUCTION_EXCLUDES[@]}" --include='*.py' apps services 2>/dev/null \
  | xargs grep -lE '"(openclaw|openshell|nemoclaw)"|\x27(openclaw|openshell|nemoclaw)\x27' 2>/dev/null \
  | grep -v '/sandbox/' || true)
if [[ -n "$stray_runtime_calls" ]]; then
  fail "agent runtime is invoked outside sandbox/: $stray_runtime_calls"
else
  pass "agent runtime is invoked only from sandbox/"
fi
echo

# -------------------------------------------------------- 5. prototype isolation
echo "Prototype isolation"
if grep -rInE '(from|require\()\s*"[^"]*prototype/' \
  --include='*.ts' --include='*.tsx' apps packages 2>/dev/null | grep -q .; then
  fail "production code imports from prototype/"
else
  pass "production code does not import from prototype/"
fi
echo

if [ "$failures" -gt 0 ]; then
  printf '%s check(s) failed.\n' "$failures" >&2
  exit 1
fi

echo "All repository checks passed."
