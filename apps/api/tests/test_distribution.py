"""A source tree cannot grow browser automation through configuration.

Since 2026-09-28 the marker carries an *edition* rather than a single boolean, because
this distribution runs official-API collectors while browser automation stays off. The
fail-closed rule is the part worth guarding: anything unreadable, unrecognised, or merely
present resolves to the most restrictive profile, and no marker content can turn the
browser back on.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from taste_inbox.distribution import COMMUNITY_MARKER, distribution_profile

#: What this repository actually ships, written by hand rather than by the release script.
RND_MARKER = json.dumps({"edition": "rnd", "browserAutomation": False, "apiCollection": True})


def test_private_workspace_keeps_its_existing_personal_collector_capability(tmp_path: Path) -> None:
    profile = distribution_profile(tmp_path)

    assert profile.edition == "personal-workspace"
    assert profile.browser_automation is True
    assert profile.api_collection is True


def test_community_marker_fails_closed_even_when_its_contents_are_invalid(tmp_path: Path) -> None:
    (tmp_path / COMMUNITY_MARKER).write_text("not json and not configuration", encoding="utf-8")

    profile = distribution_profile(tmp_path)

    assert profile.edition == "community"
    assert profile.browser_automation is False
    # Unreadable must not mean "the new, more permissive edition" either.
    assert profile.api_collection is False


def test_an_empty_marker_is_still_the_most_restrictive_edition(tmp_path: Path) -> None:
    (tmp_path / COMMUNITY_MARKER).touch()

    profile = distribution_profile(tmp_path)

    assert profile.edition == "community"
    assert profile.collection_available is False


def test_rnd_marker_unlocks_api_collection_and_nothing_else(tmp_path: Path) -> None:
    (tmp_path / COMMUNITY_MARKER).write_text(RND_MARKER, encoding="utf-8")

    profile = distribution_profile(tmp_path)

    assert profile.edition == "rnd"
    assert profile.api_collection is True
    assert profile.browser_automation is False
    assert profile.collection_available is True


def test_a_marker_claiming_browser_automation_is_not_believed(tmp_path: Path) -> None:
    """The marker may only ever tighten.

    A tree that copies a collector package next to this checkout and edits the marker to
    say `true` must still fail closed — that is the whole reason the check lives at
    runtime instead of in the release script.
    """

    (tmp_path / COMMUNITY_MARKER).write_text(
        json.dumps({"edition": "rnd", "browserAutomation": True}), encoding="utf-8"
    )

    assert distribution_profile(tmp_path).browser_automation is False


def test_an_unknown_edition_falls_back_to_the_most_restrictive_profile(tmp_path: Path) -> None:
    (tmp_path / COMMUNITY_MARKER).write_text(
        json.dumps({"edition": "something-invented-later"}), encoding="utf-8"
    )

    profile = distribution_profile(tmp_path)

    assert profile.edition == "community"
    assert profile.collection_available is False


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
    assert description["apiCollectionAvailable"] is False
    assert description["sources"] == []
    assert jobs == []
    assert "로그인 브라우저 자동 수집 작업이 없습니다" in launchd.install_commands(jobs)[0]


def test_rnd_schedule_lists_the_api_collectors_and_no_browser_ones(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The point of splitting the capability: a schedule exists, with API sources only."""

    from taste_inbox.api import launchd, schedule

    (tmp_path / COMMUNITY_MARKER).write_text(RND_MARKER, encoding="utf-8")
    monkeypatch.setattr(launchd, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(schedule, "REPO_ROOT", tmp_path)

    description = schedule.describe()

    assert description["distributionEdition"] == "rnd"
    assert description["browserAutomationAvailable"] is False
    assert description["apiCollectionAvailable"] is True

    listed = [source["collectorId"] for source in description["sources"]]
    assert listed == list(schedule.API_SOURCE_ORDER)
    assert not set(listed) & set(schedule.BROWSER_SOURCE_ORDER)

    jobs = launchd.plan(tmp_path / "launchd")
    assert [job.collector_id for job in jobs] == list(schedule.API_SOURCE_ORDER)


def test_a_distribution_with_no_collectors_refuses_even_a_direct_plist_builder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from taste_inbox.api import launchd

    (tmp_path / COMMUNITY_MARKER).touch()
    monkeypatch.setattr(launchd, "REPO_ROOT", tmp_path)

    with pytest.raises(ValueError, match="no collectors"):
        launchd.build_plist(
            label="x", collector_id="github_stars", interval_hours=4, timezone="Asia/Seoul"
        )
