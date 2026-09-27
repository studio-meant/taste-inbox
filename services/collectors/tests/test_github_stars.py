"""GitHub Stars through the official API, on a recorded page (`octocat`'s public stars)."""

from __future__ import annotations

import json

import pytest

from taste_inbox_collectors.api_sources import github_stars
from taste_inbox_collectors.http import CollectorHttpError

from .transport import RecordedNetwork, load

PAGE = load("github", "starred-page.json")
FIRST = f"{github_stars.API_ROOT}/users/octocat/starred?per_page={github_stars.PER_PAGE}"
MINE = f"{github_stars.API_ROOT}/user/starred?per_page={github_stars.PER_PAGE}"


@pytest.fixture
def network(monkeypatch: pytest.MonkeyPatch) -> RecordedNetwork:
    recorded = RecordedNetwork({FIRST: PAGE, MINE: PAGE})
    monkeypatch.setattr(github_stars, "get_json", recorded)
    return recorded


def test_a_star_keeps_when_it_was_starred(network: RecordedNetwork) -> None:
    run = github_stars.collect(token=None, login="octocat")

    first = run.items[0]
    # `starred_at` exists only under the star+json media type — the reason this collector
    # exists, since the stars page never showed it.
    assert first.action_at == "2016-07-28T18:43:22Z"
    assert first.platform_item_id == str(PAGE[0]["repo"]["id"])
    assert first.canonical_url == "https://github.com/violet-org/boysenberry-repo"
    assert first.kind == "repo"
    _, headers = network.requested[0]
    assert headers["Accept"] == github_stars.STAR_MEDIA_TYPE


def test_the_id_not_the_name_is_the_identity(network: RecordedNetwork) -> None:
    """A renamed repository keeps its id; keying on the name would file it twice."""

    run = github_stars.collect(token=None, login="octocat")

    assert all(item.platform_item_id.isdigit() for item in run.items)
    assert len({item.platform_item_id for item in run.items}) == len(run.items)


def test_a_complete_walk_advances_the_checkpoint(network: RecordedNetwork) -> None:
    run = github_stars.collect(token=None, login="octocat")

    assert run.exhausted is True
    assert run.checkpoint == run.items[0].platform_item_id
    assert run.advanced_checkpoint is True


def test_an_incremental_run_stops_at_the_previous_newest(network: RecordedNetwork) -> None:
    second = str(PAGE[1]["repo"]["id"])

    run = github_stars.collect(token=None, login="octocat", last_seen=second)

    assert [item.title for item in run.items] == ["violet-org/boysenberry-repo"]
    assert run.advanced_checkpoint is True
    assert "reached the previous run's newest star" in run.notes


def test_a_seeding_run_does_not_claim_the_position(monkeypatch: pytest.MonkeyPatch) -> None:
    more = RecordedNetwork(
        {FIRST: PAGE, "https://api.github.com/next": PAGE},
        next_urls={FIRST: "https://api.github.com/next"},
    )
    monkeypatch.setattr(github_stars, "get_json", more)

    run = github_stars.collect(token=None, login="octocat", limit=2)

    assert len(run.items) == 2
    assert run.stopped_because == "reached the requested limit of 2"
    # It left a gap below what it took, so the next run must not start from here.
    assert run.advanced_checkpoint is False


def test_without_a_token_or_a_login_it_says_why(network: RecordedNetwork) -> None:
    run = github_stars.collect(token=None)

    assert run.outcome == "auth_required"
    assert run.items == []
    assert network.requested == []


def test_the_token_goes_in_a_header_and_nowhere_else(network: RecordedNetwork) -> None:
    run = github_stars.collect(token="test-token-value")  # noqa: S106 — a placeholder

    url, headers = network.requested[0]
    assert url == MINE
    assert headers["Authorization"] == "Bearer test-token-value"
    # Not in the capture document either — that file is what the ingester and Today read.
    assert "test-token-value" not in json.dumps(run.as_document())


@pytest.mark.parametrize(
    ("error", "outcome"),
    [
        (CollectorHttpError("rate limited", status=403, retryable=True), "rate_limited"),
        (CollectorHttpError("not authorised (401)", status=401), "auth_required"),
        (CollectorHttpError("HTTP 500", status=500), "failed"),
    ],
)
def test_a_refusal_is_reported_not_retried(
    network: RecordedNetwork, error: CollectorHttpError, outcome: str
) -> None:
    network.failures[FIRST] = error

    run = github_stars.collect(token=None, login="octocat")

    assert run.outcome == outcome
    assert len(network.requested) == 1  # asked once; the next cycle is the retry


def test_a_malformed_entry_costs_one_row_not_the_page(monkeypatch: pytest.MonkeyPatch) -> None:
    broken = [{"starred_at": "2026-01-01T00:00:00Z", "repo": {"name": "no-id"}}, *PAGE]
    monkeypatch.setattr(github_stars, "get_json", RecordedNetwork({FIRST: broken}))

    run = github_stars.collect(token=None, login="octocat")

    assert len(run.items) == len(PAGE)
    assert "1 entries had no usable repository and were skipped" in run.notes
