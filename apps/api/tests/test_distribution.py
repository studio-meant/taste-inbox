"""A source tree decides whether collection runs, and fails closed.

The marker carries an *edition*. This repository ships `rnd`, which runs the GitHub Stars
and Hugging Face collectors on a schedule. The rule worth guarding is the fail-closed one:
anything unreadable, unrecognised, or merely present resolves to the most restrictive
profile — no collection at all.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from taste_inbox.distribution import COMMUNITY_MARKER, distribution_profile

#: What this repository actually ships.
RND_MARKER = json.dumps({"edition": "rnd", "apiCollection": True})


def test_this_repository_ships_the_rnd_marker() -> None:
    root = Path(__file__).resolve().parents[3]
    assert json.loads((root / COMMUNITY_MARKER).read_text("utf-8")) == json.loads(RND_MARKER)
    assert distribution_profile(root).edition == "rnd"


def test_a_tree_with_no_marker_collects(tmp_path: Path) -> None:
    profile = distribution_profile(tmp_path)

    assert profile.edition == "personal-workspace"
    assert profile.api_collection is True


def test_an_unreadable_marker_fails_closed(tmp_path: Path) -> None:
    (tmp_path / COMMUNITY_MARKER).write_text("not json and not configuration", encoding="utf-8")

    profile = distribution_profile(tmp_path)

    assert profile.edition == "community"
    assert profile.api_collection is False


def test_an_empty_marker_is_still_the_most_restrictive_edition(tmp_path: Path) -> None:
    (tmp_path / COMMUNITY_MARKER).touch()

    profile = distribution_profile(tmp_path)

    assert profile.edition == "community"
    assert profile.collection_available is False


def test_the_rnd_marker_unlocks_collection(tmp_path: Path) -> None:
    (tmp_path / COMMUNITY_MARKER).write_text(RND_MARKER, encoding="utf-8")

    profile = distribution_profile(tmp_path)

    assert profile.edition == "rnd"
    assert profile.collection_available is True


def test_an_unknown_edition_falls_back_to_the_most_restrictive_profile(tmp_path: Path) -> None:
    (tmp_path / COMMUNITY_MARKER).write_text(
        json.dumps({"edition": "something-invented-later"}), encoding="utf-8"
    )

    profile = distribution_profile(tmp_path)

    assert profile.edition == "community"
    assert profile.collection_available is False


def test_a_tree_without_collection_schedules_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from taste_inbox.api import launchd, schedule

    (tmp_path / COMMUNITY_MARKER).touch()
    monkeypatch.setattr(launchd, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(schedule, "REPO_ROOT", tmp_path)

    description = schedule.describe()
    jobs = launchd.plan(tmp_path / "launchd")

    assert description["distributionEdition"] == "community"
    assert description["apiCollectionAvailable"] is False
    assert description["sources"] == []
    assert jobs == []
    assert "예약할 수집 작업이 없습니다" in launchd.install_commands(jobs)[0]


def test_the_rnd_schedule_lists_the_three_collectors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from taste_inbox.api import launchd, schedule

    (tmp_path / COMMUNITY_MARKER).write_text(RND_MARKER, encoding="utf-8")
    monkeypatch.setattr(launchd, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(schedule, "REPO_ROOT", tmp_path)

    description = schedule.describe()

    assert description["distributionEdition"] == "rnd"
    assert description["apiCollectionAvailable"] is True
    assert [source["collectorId"] for source in description["sources"]] == list(
        schedule.SOURCE_ORDER
    )
    jobs = launchd.plan(tmp_path / "launchd")
    assert [job.collector_id for job in jobs] == list(schedule.SOURCE_ORDER)


def test_a_distribution_with_no_collectors_refuses_even_a_direct_plist_builder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from taste_inbox.api import launchd

    (tmp_path / COMMUNITY_MARKER).touch()
    monkeypatch.setattr(launchd, "REPO_ROOT", tmp_path)

    with pytest.raises(ValueError, match="no collectors"):
        launchd.build_plist(
            label="x", collector_id="github_stars_api", interval_hours=4, timezone="Asia/Seoul"
        )
