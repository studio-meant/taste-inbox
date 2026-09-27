#!/usr/bin/env bash
#
# Start the local NVIDIA AI-Q backend that research runs against — on loopback, always.
#
#   pnpm aiq            → http://127.0.0.1:8010   (then AIQ_SERVER_URL=http://127.0.0.1:8010)
#
# Three things this script exists to get right:
#
#   1. `--host 127.0.0.1`. AI-Q's own `start_as_skill.sh` defaults to 0.0.0.0, which puts a
#      research service on every interface of the machine (docs/FEASIBILITY.md, Phase 1).
#   2. A checkout outside this repository. It is 1.4 GB with its venv, and its
#      `deploy/.env` holds NVIDIA_API_KEY and TAVILY_API_KEY — neither belongs in a tree
#      that is pushed. The default is ~/.local/share/taste-inbox/aiq.
#   3. The keys stay in that file. This script reads nothing from this repository's `.env`
#      and passes nothing on; AI-Q's start script loads its own `deploy/.env`.
#
# Set up once (NVIDIA-AI-Blueprints/aiq):
#   git clone https://github.com/NVIDIA-AI-Blueprints/aiq.git ~/.local/share/taste-inbox/aiq
#   cd ~/.local/share/taste-inbox/aiq && uv sync
#   cp deploy/.env.example deploy/.env && chmod 600 deploy/.env   # then add the two keys
#
set -euo pipefail

AIQ_DIR="${TASTE_INBOX_AIQ_DIR:-$HOME/.local/share/taste-inbox/aiq}"
PORT="${TASTE_INBOX_AIQ_PORT:-8010}"
CONFIG="${TASTE_INBOX_AIQ_CONFIG:-configs/config_web_default_llamaindex.yml}"

die() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

[[ -x "$AIQ_DIR/scripts/start_as_skill.sh" ]] \
  || die "no AI-Q checkout at ${AIQ_DIR}. See the set-up lines at the top of this script, or set TASTE_INBOX_AIQ_DIR."
[[ -f "$AIQ_DIR/deploy/.env" ]] \
  || die "no ${AIQ_DIR}/deploy/.env — AI-Q needs NVIDIA_API_KEY and TAVILY_API_KEY there."
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "port ${PORT} is already in use. Stop what is on it, or set TASTE_INBOX_AIQ_PORT."
fi

printf '\033[2m›\033[0m AI-Q → http://127.0.0.1:%s   (%s)\n' "$PORT" "$AIQ_DIR"
cd "$AIQ_DIR"
exec ./scripts/start_as_skill.sh --config_file "$CONFIG" --host 127.0.0.1 --port "$PORT"
