#!/usr/bin/env python3
"""Create and verify a source tree that cannot run the private browser collectors."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DESTINATION = ROOT / "dist" / "taste-inbox-community-source"
MARKER = ".taste-inbox-community"
GENERATED_MARKER = ".taste-inbox-community-generated"
MANIFEST = "COMMUNITY_MANIFEST.json"

# The private workspace is broader than the future public product. These paths either
# contain the browser implementation, describe this machine's private operation, or are
# reference/handoff material rather than build inputs.
EXCLUDED_PATHS = frozenset(
    {
        "AGENTS.md",
        "CLAUDE.md",
        "CONTENTS.md",
        "MANIFEST.sha256",
        "README.md",  # replaced with the community document below
        "START_HERE.md",
        "design-qa.md",
        "memo.txt",
        "config/collectors.example.yaml",
        "docs/INSTAGRAM_MEDIA_AUDIT_2026-09-03.md",
        "docs/REMOTE_ACCESS.md",
        "scripts/bootstrap.sh",
        "scripts/remote-access.py",
        "apps/web/playwright.remote.config.ts",
        "apps/api/src/taste_inbox/api/remote.py",
        "apps/api/tests/test_remote.py",
        "apps/api/tests/test_remote_setup.py",
    }
)
EXCLUDED_PREFIXES = (
    "prototype/",
    "reference/",
    "services/collectors/",
    "apps/web/remote-e2e/",
    "apps/web/server/",
)

# Files that would carry identity or private state even if a future ignore rule regressed.
FORBIDDEN_NAMES = {
    ".env",
    "collectors.yaml",
    "taste-inbox.db",
}
FORBIDDEN_PARTS = {
    "browser-profiles",
    "media-cache",
    "storage-state",
    "auth-state",
    "cookies",
    "var",
}


def _tracked_and_visible(root: Path) -> list[Path]:
    """Files Git could publish, including the current uncommitted source work."""

    completed = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=root,
        check=True,
        stdout=subprocess.PIPE,
    )
    return [Path(raw.decode("utf-8")) for raw in completed.stdout.split(b"\0") if raw]


def is_publishable(relative: Path) -> bool:
    posix = relative.as_posix()
    if posix in EXCLUDED_PATHS or any(
        posix.startswith(prefix) for prefix in EXCLUDED_PREFIXES
    ):
        return False
    if relative.name in {"AGENTS.md", "CLAUDE.md"}:
        return False
    return relative.name not in FORBIDDEN_NAMES and not (
        set(relative.parts) & FORBIDDEN_PARTS
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _community_package(source: Path, destination: Path) -> None:
    payload: dict[str, Any] = json.loads(source.read_text(encoding="utf-8"))
    scripts: dict[str, str] = payload["scripts"]
    for key in list(scripts):
        if key.startswith(("collectors:", "remote:")):
            del scripts[key]
    scripts["verify:all"] = (
        "pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm e2e && "
        "pnpm api:lint && pnpm api:typecheck && pnpm api:test && pnpm verify"
    )
    scripts["community:verify"] = "python3 scripts/community_release.py --check-tree ."
    scripts.pop("community:release", None)
    destination.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _community_tauri_config(path: Path) -> None:
    payload: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    scope: list[str] = payload["app"]["security"]["assetProtocol"]["scope"]
    payload["app"]["security"]["assetProtocol"]["scope"] = [
        entry for entry in scope if not entry.startswith("$HOME/Desktop/")
    ]
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def build(destination: Path) -> None:
    destination = destination.resolve()
    if destination == ROOT or ROOT.is_relative_to(destination):
        raise ValueError("destination must not contain or equal the private workspace")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="taste-inbox-community-", dir=destination.parent
    ) as raw:
        staging = Path(raw) / "source"
        staging.mkdir()
        for relative in _tracked_and_visible(ROOT):
            if not is_publishable(relative):
                continue
            source = ROOT / relative
            if not source.is_file():
                continue
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)

        (staging / MARKER).write_text(
            '{"edition":"community","browserAutomation":false}\n', encoding="utf-8"
        )
        (staging / GENERATED_MARKER).write_text(
            "Generated by scripts/community_release.py; safe to replace.\n",
            encoding="utf-8",
        )
        shutil.copy2(staging / "docs" / "COMMUNITY_RELEASE.md", staging / "README.md")
        _community_package(staging / "package.json", staging / "package.json")
        _community_tauri_config(
            staging / "apps" / "desktop" / "src-tauri" / "tauri.conf.json"
        )

        # The manifest covers its inputs, not itself. Sorting makes the result reproducible.
        entries = {
            path.relative_to(staging).as_posix(): _sha256(path)
            for path in sorted(staging.rglob("*"))
            if path.is_file() and path.name != MANIFEST
        }
        (staging / MANIFEST).write_text(
            json.dumps({"edition": "community", "files": entries}, indent=2) + "\n",
            encoding="utf-8",
        )
        verify(staging)

        if destination.exists():
            if not (destination / GENERATED_MARKER).is_file():
                raise ValueError(
                    f"refusing to replace a directory not created by this tool: {destination}"
                )
            shutil.rmtree(destination)
        staging.rename(destination)


def verify(root: Path) -> None:
    root = root.resolve()
    failures: list[str] = []
    if not (root / MARKER).is_file():
        failures.append(f"missing fail-closed marker: {MARKER}")
    if (root / "services" / "collectors").exists():
        failures.append("private browser collector package is present")

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if relative.name in FORBIDDEN_NAMES or set(relative.parts) & FORBIDDEN_PARTS:
            failures.append(f"private runtime path is present: {relative}")

    manifest_path = root / MANIFEST
    if manifest_path.is_file():
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        for relative, expected in payload.get("files", {}).items():
            candidate = root / relative
            if not candidate.is_file() or _sha256(candidate) != expected:
                failures.append(f"manifest mismatch: {relative}")
    elif root.name != ".":
        failures.append(f"missing manifest: {MANIFEST}")

    if failures:
        raise ValueError("community release check failed:\n- " + "\n- ".join(failures))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    parser.add_argument("--check-tree", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.check_tree is not None:
            verify(args.check_tree)
            print(f"Community release verified: {args.check_tree.resolve()}")
        else:
            build(args.destination)
            print(f"Community release written: {args.destination.resolve()}")
    except (
        OSError,
        ValueError,
        subprocess.CalledProcessError,
        json.JSONDecodeError,
    ) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
