"""A public source tree cannot grow browser automation through configuration."""

from __future__ import annotations

from pathlib import Path

import pytest

from taste_inbox.distribution import COMMUNITY_MARKER, distribution_profile


def test_private_workspace_keeps_its_existing_personal_collector_capability(tmp_path: Path) -> None:
    profile = distribution_profile(tmp_path)

    assert profile.edition == "personal-workspace"
    assert profile.browser_automation is True


def test_community_marker_fails_closed_even_when_its_contents_are_invalid(tmp_path: Path) -> None:
    (tmp_path / COMMUNITY_MARKER).write_text("not json and not configuration", encoding="utf-8")

    profile = distribution_profile(tmp_path)

    assert profile.edition == "community"
    assert profile.browser_automation is False


def test_community_schedule_and_launchd_plan_expose_no_browser_jobs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from taste_inbox.api import launchd, schedule

    (tmp_path / COMMUNITY_MARKER).touch()
    monkeypatch.setattr(launchd, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(schedule, "REPO_ROOT", tmp_path)

    description = schedule.describe()
    jobs = launchd.plan(tmp_path / "launchd")

    assert description["distributionEdition"] == "community"
    assert description["browserAutomationAvailable"] is False
    assert description["sources"] == []
    assert jobs == []
    assert "로그인 브라우저 자동 수집 작업이 없습니다" in launchd.install_commands(jobs)[0]


def test_community_distribution_refuses_even_a_direct_plist_builder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from taste_inbox.api import launchd

    (tmp_path / COMMUNITY_MARKER).touch()
    monkeypatch.setattr(launchd, "REPO_ROOT", tmp_path)

    with pytest.raises(ValueError, match="community releases"):
        launchd.build_plist(
            label="x", collector_id="github_stars", interval_hours=4, timezone="Asia/Seoul"
        )
