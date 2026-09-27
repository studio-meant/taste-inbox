"""Database migration tooling.

Phase 0 ships no schema — Phase 2 introduces sources, raw events, items, jobs,
evidence and checkpoints. What must work now is the tooling itself: a clean checkout
can run migrations against a fresh SQLite file without manual setup.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]


def _alembic(*args: str, database_url: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - fixed argv from this test module, no shell
        [sys.executable, "-m", "alembic", *args],
        cwd=API_ROOT,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
        env={"PATH": "/usr/bin:/bin", "DATABASE_URL": database_url},
    )


def test_alembic_config_loads_and_creates_a_missing_directory(tmp_path: Path) -> None:
    """The `var/` tree is gitignored, so migrations must create it on demand."""
    database = tmp_path / "nested" / "dir" / "taste-inbox.db"
    assert not database.parent.exists()

    result = _alembic("current", database_url=f"sqlite:///{database}")

    assert result.returncode == 0, result.stderr
    assert database.parent.is_dir()


def test_upgrade_head_succeeds_on_an_empty_revision_history(tmp_path: Path) -> None:
    database = tmp_path / "taste-inbox.db"

    result = _alembic("upgrade", "head", database_url=f"sqlite:///{database}")

    assert result.returncode == 0, result.stderr


def test_no_migration_hardcodes_a_personal_path() -> None:
    """docs/SECURITY_BOUNDARIES.md — personal paths are never committed."""
    for script in (API_ROOT / "migrations").rglob("*.py"):
        text = script.read_text(encoding="utf-8")
        assert "/Users/" not in text, script
        assert "/home/" not in text, script
