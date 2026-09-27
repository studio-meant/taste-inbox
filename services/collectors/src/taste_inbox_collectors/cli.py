"""Collect one API surface into `var/captures/<surface>.json`.

    uv run probe api --source github_stars_api
    uv run probe api --source huggingface_activity --last-seen model:deepseek-ai/DeepSeek-R1
    uv run probe api --source huggingface_upvotes --last-seen paper:2510.04871
    uv run probe sources                      # what this build can collect, and from whom

Without `--last-seen` a run takes the newest `--limit` items and is a seeding run. With it,
the run walks back until that id reappears and takes everything above it.

**The capture file is written whatever happened** — rate-limited, unauthorised, empty. It
is the only path from a run to `checkpoints.last_outcome` and from there to the Today
screen, so a run that produced no file is indistinguishable from a run that never happened.

Credentials come from the environment and are never printed. This package does not read
`.env`; the caller exports what it needs, which is what the scheduled driver in
`apps/api` already does for the inherited collectors.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from .api_sources import SURFACES, describe, surface_names
from .capture_file import SourceRun, capture_path, summarise, write_capture

#: Where the ingester looks. Resolved from this file so the CLI works from any directory.
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_CAPTURE_DIR = REPO_ROOT / "var" / "captures"


def _event(**fields: Any) -> None:
    """One JSON line per run, for a log a person or a job can both read."""

    print(json.dumps(fields, ensure_ascii=False), flush=True)


def cmd_sources(_: argparse.Namespace) -> int:
    for name in surface_names():
        entry = describe(name)
        account = os.environ.get(entry["accountEnv"], "")
        token = bool(os.environ.get(entry["tokenEnv"], "").strip())
        ready = token or not entry["tokenRequired"]
        _event(
            surface=name,
            label=entry["label"],
            account=account or None,
            tokenPresent=token,
            tokenRequired=entry["tokenRequired"],
            official=entry["official"],
            ready=bool(account) and ready,
        )
    return 0


def _run_surface(surface: str, args: argparse.Namespace) -> SourceRun:
    entry = SURFACES[surface]
    token = os.environ.get(entry.token_env, "").strip() or None
    account = (args.account or os.environ.get(entry.account_env, "")).strip() or None

    if surface == "github_stars_api":
        return entry.collect(
            token=token,
            login=account,
            last_seen=args.last_seen,
            limit=args.limit,
        )

    if account is None:
        run = SourceRun(surface=surface)
        run.outcome = "failed"
        run.stopped_because = f"no account configured; set {entry.account_env} or pass --account"
        return run

    return entry.collect(
        username=account,
        token=token,
        last_seen=args.last_seen,
        limit=args.limit,
        resolve_papers=not args.no_papers,
    )


def cmd_api(args: argparse.Namespace) -> int:
    surface = args.source
    directory = args.output_dir or DEFAULT_CAPTURE_DIR

    try:
        run = _run_surface(surface, args)
    except Exception as error:
        run = SourceRun(surface=surface)
        run.outcome = "failed"
        run.stopped_because = f"{type(error).__name__}: {error}"

    destination = write_capture(run, directory)
    _event(**summarise(run), written=str(destination), notes=run.notes)

    # 0 collected, 2 a platform stop a person has to resolve, 1 anything else. The
    # inherited driver reads these; see `ingest/collect.py`.
    if run.outcome == "ok":
        return 0
    if run.outcome in ("auth_required", "rate_limited", "blocked"):
        return 2
    return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="probe", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("sources", help="list the surfaces this build can collect").set_defaults(
        handler=cmd_sources
    )

    api = sub.add_parser("api", help="collect one API surface")
    api.add_argument("--source", required=True, choices=sorted(SURFACES))
    api.add_argument(
        "--last-seen",
        default=None,
        help="the previous run's newest platform id; walk back until it reappears",
    )
    api.add_argument(
        "--limit",
        type=int,
        default=None,
        help="seeding runs only — take at most this many newest items",
    )
    api.add_argument("--account", default=None, help="override the configured account")
    api.add_argument(
        "--no-papers",
        action="store_true",
        help="Hugging Face only: skip the per-paper bundle request",
    )
    api.add_argument("--output-dir", type=Path, default=None)
    api.set_defaults(handler=cmd_api)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    handler = args.handler
    return int(handler(args))


if __name__ == "__main__":
    sys.exit(main())


__all__ = ["DEFAULT_CAPTURE_DIR", "build_parser", "capture_path", "main"]
