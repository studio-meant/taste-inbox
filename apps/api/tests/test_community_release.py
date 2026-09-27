"""The source release allowlist keeps private collectors and state out."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType


def _script() -> ModuleType:
    path = Path(__file__).resolve().parents[3] / "scripts" / "community_release.py"
    spec = importlib.util.spec_from_file_location("community_release", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_private_collection_and_runtime_paths_are_never_publishable() -> None:
    release = _script()

    assert release.is_publishable(Path("services/collectors/src/private.py")) is False
    assert release.is_publishable(Path("config/collectors.yaml")) is False
    assert release.is_publishable(Path("var/data/taste-inbox.db")) is False
    assert release.is_publishable(Path("browser-profiles/Default/Cookies")) is False
    assert release.is_publishable(Path("apps/web/AGENTS.md")) is False
    assert release.is_publishable(Path("apps/api/CLAUDE.md")) is False
    assert release.is_publishable(Path("apps/web/src/app/page.tsx")) is True


def test_verifier_requires_marker_and_refuses_a_collector_package(tmp_path: Path) -> None:
    release = _script()

    try:
        release.verify(tmp_path)
    except ValueError as error:
        assert "missing fail-closed marker" in str(error)
    else:
        raise AssertionError("an unmarked source tree was accepted")

    (tmp_path / release.MARKER).touch()
    (tmp_path / "services" / "collectors").mkdir(parents=True)
    try:
        release.verify(tmp_path)
    except ValueError as error:
        assert "private browser collector package is present" in str(error)
    else:
        raise AssertionError("a private collector package was accepted")
