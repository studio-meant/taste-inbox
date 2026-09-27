#!/usr/bin/env bash
#
# Start Taste Inbox — the API and the web app together, against the collected data.
#
# This exists because starting it by hand is three things that have to agree, and getting
# any of them wrong fails quietly rather than loudly:
#
#   1. `DATABASE_URL` must be absolute. The default is relative, and uvicorn resolves it
#      against `apps/api/`, where `var/data/` does not exist — so the API starts fine and
#      serves an empty database.
#   2. `NEXT_PUBLIC_DATA_SOURCE` must be `live`. It defaults to `mock`, so the boards fill
#      with fixtures and look convincing while showing nobody's real saves.
#   3. Both have to be running. The web app fetches boards server-side, so with the API
#      down every page renders its error state instead of failing to start.
#
# Usage:
#   pnpm dev            live data (this script)
#   pnpm dev:mock       fixtures, no API needed
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${TASTE_INBOX_API_PORT:-8787}"
WEB_PORT="${TASTE_INBOX_WEB_PORT:-4173}"
API_URL="http://127.0.0.1:${API_PORT}"
DB_PATH="${TASTE_INBOX_DB:-${ROOT}/var/data/taste-inbox.db}"

say() { printf '\033[2m›\033[0m %s\n' "$1"; }
die() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

for port in "$API_PORT" "$WEB_PORT"; do
  if port_busy "$port"; then
    # 8787 is also the default of Dask's dashboard, which a local AI-Q backend starts.
    die "port ${port} is already in use. Stop what is on it, or set TASTE_INBOX_API_PORT / TASTE_INBOX_WEB_PORT.
    (A local AI-Q backend opens Dask's dashboard on 8787 — TASTE_INBOX_API_PORT=8790 pnpm dev)"
  fi
done

# A first run has no database, and creating an empty one loses nothing — so it is created
# here rather than refused. The app then opens on onboarding (2026-09-28). An *existing*
# database behind the migrations is still only warned about below: migrating that is a
# decision about someone's data, not a side effect of starting a dev server.
if [[ ! -f "$DB_PATH" ]]; then
  say "no database yet — creating ${DB_PATH##*/} (first run)"
  mkdir -p "$(dirname "$DB_PATH")"
  (cd "$ROOT/apps/api" && DATABASE_URL="sqlite:///${DB_PATH}" uv run alembic upgrade head >/dev/null) \
    || die "could not create the database at ${DB_PATH}"
fi

# Warn rather than migrate. A migration is not trivially reversible, and running one as a
# side effect of asking for a dev server is not a decision this script gets to make.
pushd "$ROOT/apps/api" >/dev/null
current="$(DATABASE_URL="sqlite:///${DB_PATH}" uv run alembic current 2>/dev/null | tail -1 || true)"
popd >/dev/null
if [[ "$current" != *"(head)"* ]]; then
  printf '\033[33m!\033[0m schema is behind the migrations. Boards may 500 until you run:\n'
  printf '    cd apps/api && DATABASE_URL="sqlite:///%s" uv run alembic upgrade head\n\n' "$DB_PATH"
fi

# Plain variables rather than an array: macOS ships bash 3.2, where `${arr[@]}` on an
# empty array is an unbound-variable error under `set -u`.
API_PID=""
WEB_PID=""

stop() {
  [[ -n "$1" ]] || return 0
  # Children first. `next dev` forks a `next-server`, and killing only the parent leaves it
  # holding the port, so the next run refuses to start.
  pkill -TERM -P "$1" 2>/dev/null || true
  kill -TERM "$1" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM EXIT
  stop "$WEB_PID"
  stop "$API_PID"
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# The two NVIDIA settings the API needs, read from `.env` by name — and only those two.
# Both are addresses, not secrets; the keys in the same file belong to the AI-Q process and
# are never handed to this one. Without the first, research refuses to send rather than
# guessing a port (`research/aiq_client.py`).
env_value() { grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
AIQ_SERVER_URL="${AIQ_SERVER_URL:-$(env_value AIQ_SERVER_URL)}"
NEMOCLAW_SANDBOX_NAME="${NEMOCLAW_SANDBOX_NAME:-$(env_value NEMOCLAW_SANDBOX_NAME)}"
# Optional collector tokens: passed through to the collectors only, never shown anywhere
# (Settings reports whether each is set). Public stars, likes and upvotes need neither.
GITHUB_TOKEN="${GITHUB_TOKEN:-$(env_value GITHUB_TOKEN)}"
HF_TOKEN="${HF_TOKEN:-$(env_value HF_TOKEN)}"
[[ -n "$AIQ_SERVER_URL" ]] || say "AIQ_SERVER_URL is not set — research will refuse until it is."

say "api  → ${API_URL}   (${DB_PATH##*/})"
(
  cd "$ROOT/apps/api"
  # `--reload` so this side matches the other one. The web app has had hot reloading all
  # along, so a Python edit was the one change that looked applied and was not: the page
  # updated, the API kept serving the code it started with, and the difference was
  # invisible until something disagreed. Watches `src` only — without `--reload-dir` it
  # also watches `.venv`, and restarts on every `uv run`.
  DATABASE_URL="sqlite:///${DB_PATH}" \
  AIQ_SERVER_URL="$AIQ_SERVER_URL" \
  NEMOCLAW_SANDBOX_NAME="$NEMOCLAW_SANDBOX_NAME" \
  GITHUB_TOKEN="$GITHUB_TOKEN" \
  HF_TOKEN="$HF_TOKEN" \
  TASTE_INBOX_SCHEDULER=1 \
    exec uv run uvicorn taste_inbox.api.app:app --host 127.0.0.1 --port "$API_PORT" \
    --reload --reload-dir src
) &
API_PID=$!

# Wait for the API before starting the web app. Not required — the web app only calls it
# per request — but it turns "every board shows its error state" into a plain message here.
for _ in $(seq 1 40); do
  if curl -sf --max-time 1 "${API_URL}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
curl -sf --max-time 2 "${API_URL}/api/health" >/dev/null 2>&1 \
  || die "the API did not come up on ${API_URL}. Its output is above."

say "web  → http://127.0.0.1:${WEB_PORT}   (live data)"
printf '\n'
(
  cd "$ROOT/apps/web"
  NEXT_PUBLIC_DATA_SOURCE=live \
  TASTE_INBOX_API_URL="$API_URL" \
    exec pnpm exec next dev --hostname 127.0.0.1 --port "$WEB_PORT"
) &
WEB_PID=$!

# `wait -n` would be the obvious way to return as soon as either exits, but it does not
# exist in bash 3.2, which is what macOS ships. Polling both is the portable equivalent.
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done
printf '\n\033[31m✗\033[0m one of the two servers exited — stopping the other.\n' >&2
