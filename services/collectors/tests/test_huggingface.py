"""Hugging Face likes and paper upvotes, on recorded Hub responses.

The like listing is a real public page with the account name dropped; each liked
repository's own document and each paper it cites were recorded alongside it, so the
walk below — likes, details, arXiv tags, papers — runs exactly as it does live.

The upvote pages are the same: two real pages of a public activity feed, account name
replaced, with the collections and articles the live feed actually mixes in left in place.
`CLAUDE.md` §9 — collector parsers run on stored fixtures and never touch a live account
in CI.
"""

from __future__ import annotations

import pytest

from taste_inbox_collectors.api_sources import SURFACES, huggingface
from taste_inbox_collectors.api_sources.huggingface import likes, papers, upvotes
from taste_inbox_collectors.capture_file import SourceItem, SourceRun

from .transport import RecordedNetwork, load

LIKES = load("huggingface", "likes-page.json")
LISTING = f"{likes.API_ROOT}/users/sample-user/likes?limit={likes.PER_PAGE}"

ROUTES = {
    LISTING: LIKES,
    f"{likes.API_ROOT}/spaces/cfahlgren1/robotok": load(
        "huggingface", "space-cfahlgren1__robotok.json"
    ),
    f"{likes.API_ROOT}/datasets/FineEnvs/SmolDataEnvs": load(
        "huggingface", "dataset-FineEnvs__SmolDataEnvs.json"
    ),
    f"{likes.API_ROOT}/datasets/secemp9/arxiv-complete": load(
        "huggingface", "dataset-secemp9__arxiv-complete.json"
    ),
    f"{likes.API_ROOT}/models/hfmlsoc/ncii-light-guard-v01": load(
        "huggingface", "model-hfmlsoc__ncii-light-guard-v01.json"
    ),
    f"{likes.API_ROOT}/models/zai-org/GLM-5.3": load("huggingface", "model-zai-org__GLM-5.3.json"),
    f"{likes.API_ROOT}/papers/2401.18030": load("huggingface", "paper-2401.18030.json"),
    f"{likes.API_ROOT}/papers/2602.15763": load("huggingface", "paper-2602.15763.json"),
}


@pytest.fixture
def network(monkeypatch: pytest.MonkeyPatch) -> RecordedNetwork:
    recorded = RecordedNetwork(ROUTES)
    monkeypatch.setattr(likes, "get_json", recorded)
    monkeypatch.setattr(papers, "get_json", recorded)
    return recorded


def _by_id(run: SourceRun) -> dict[str, SourceItem]:
    return {item.platform_item_id: item for item in run.items}


# --- likes ----------------------------------------------------------------------------------


def test_each_like_keeps_its_type_and_its_time(network: RecordedNetwork) -> None:
    run = likes.collect(username="sample-user")

    items = _by_id(run)
    assert items["space:cfahlgren1/robotok"].kind == "space"
    assert items["space:cfahlgren1/robotok"].canonical_url == (
        "https://huggingface.co/spaces/cfahlgren1/robotok"
    )
    assert items["dataset:FineEnvs/SmolDataEnvs"].kind == "dataset"
    assert items["model:zai-org/GLM-5.3"].canonical_url == "https://huggingface.co/zai-org/GLM-5.3"
    # The like's own timestamp, straight from the listing.
    assert items["space:cfahlgren1/robotok"].action_at == LIKES[0]["createdAt"]


def test_a_type_the_hub_added_later_is_skipped_not_guessed(network: RecordedNetwork) -> None:
    """The recorded page holds a `kernel` like. A guessed URL would be a dead link forever."""

    assert any(entry["repo"]["type"] == "kernel" for entry in LIKES)

    run = likes.collect(username="sample-user")

    assert not any(item.platform_item_id.startswith("kernel:") for item in run.items)
    assert "1 like entries were unreadable and were skipped" in run.notes


def test_a_model_and_a_dataset_with_one_name_are_two_items() -> None:
    assert likes.canonical_url("model", "a/b") != likes.canonical_url("dataset", "a/b")


def test_arxiv_tags_are_the_thread_to_the_paper() -> None:
    detail = load("huggingface", "dataset-secemp9__arxiv-complete.json")

    # `arxiv` alone is a topic tag, not an id, and must not become a request.
    assert "arxiv" in detail["tags"]
    assert likes.arxiv_ids(detail) == ["2401.18030"]


def test_no_username_is_a_failure_that_says_so(network: RecordedNetwork) -> None:
    run = likes.collect(username="")

    assert run.outcome == "failed"
    assert network.requested == []


# --- papers ----------------------------------------------------------------------------------


def test_activity_resolves_the_papers_the_likes_cite(network: RecordedNetwork) -> None:
    run = huggingface.collect_activity(username="sample-user")

    items = _by_id(run)
    paper = items["paper:2401.18030"]
    assert paper.kind == "paper"
    assert paper.canonical_url == "https://huggingface.co/papers/2401.18030"
    # Nobody upvoted it: it arrived with the like of the dataset that cites it, and carries
    # that like's time rather than an invented upvote.
    assert paper.action_at == items["dataset:secemp9/arxiv-complete"].action_at
    assert "paper:2602.15763" in items
    assert "resolved 2 papers from arXiv tags on liked artifacts" in run.notes


def test_a_person_linked_repo_and_a_hub_match_stay_different() -> None:
    by_person = papers.branches(load("huggingface", "paper-2602.15763.json"))
    by_hub = papers.branches(load("huggingface", "paper-2501.12948.json"))

    person = next(branch for branch in by_person if branch.type == "paper.github_repo")
    hub = next(branch for branch in by_hub if branch.type == "paper.github_repo")
    # Recorded values: `githubRepoAddedBy` is "user" for GLM-5 and "auto" for DeepSeek-R1.
    assert person.confidence == 1.0
    assert hub.confidence == 0.9
    assert person.label != hub.label


def test_the_totals_are_the_hubs_not_the_preview_length() -> None:
    paper = load("huggingface", "paper-2501.12948.json")
    found = {branch.type: branch.value for branch in papers.branches(paper)}

    assert found["paper.total_models"] == str(paper["numTotalModels"])
    assert found["paper.total_spaces"] == str(paper["numTotalSpaces"])
    assert int(found["paper.total_spaces"]) > len(paper["linkedSpaces"])


def test_a_paper_with_no_repo_states_no_repo() -> None:
    paper = load("huggingface", "paper-2401.18030.json")

    assert paper.get("githubRepo") is None
    assert not any(branch.type == "paper.github_repo" for branch in papers.branches(paper))


@pytest.mark.parametrize("identifier", ["2401.18030", "2501.12948v2"])
def test_modern_arxiv_ids_are_accepted(identifier: str) -> None:
    assert papers.ARXIV_ID.match(identifier)


@pytest.mark.parametrize("identifier", ["arxiv", "cs/0112017", "2401.1", "../../etc"])
def test_anything_else_is_never_requested(network: RecordedNetwork, identifier: str) -> None:
    assert papers.fetch(identifier) is None
    assert network.requested == []


def test_a_paper_the_hub_does_not_have_is_counted_not_fatal(
    network: RecordedNetwork,
) -> None:
    del network.routes[f"{likes.API_ROOT}/papers/2602.15763"]

    run = huggingface.collect_activity(username="sample-user")

    assert "paper:2401.18030" in _by_id(run)
    assert "1 arXiv ids had no Hugging Face paper page" in run.notes


# --- upvotes ---------------------------------------------------------------------------------
#
# Two recorded pages of a real public activity feed, account name replaced. They carry what
# the live feed carries — three papers mixed with two collections and three articles — which
# is the whole reason `targetType` filtering has to be tested against a recording rather than
# a hand-written page where every row is a paper.

UPVOTES_1 = load("huggingface", "upvotes-page-1.json")
UPVOTES_2 = load("huggingface", "upvotes-page-2.json")

UPVOTES_URL = upvotes.listing_url("sample-user")
UPVOTES_URL_2 = upvotes.listing_url("sample-user", UPVOTES_1["cursor"])

UPVOTE_ROUTES = {
    UPVOTES_URL: UPVOTES_1,
    UPVOTES_URL_2: UPVOTES_2,
    f"{likes.API_ROOT}/papers/2510.04871": load("huggingface", "paper-2510.04871.json"),
}


@pytest.fixture
def upvote_network(monkeypatch: pytest.MonkeyPatch) -> RecordedNetwork:
    recorded = RecordedNetwork(dict(UPVOTE_ROUTES))
    monkeypatch.setattr(upvotes, "get_json", recorded)
    monkeypatch.setattr(papers, "get_json", recorded)
    return recorded


def test_only_papers_are_collected_and_the_rest_are_counted(
    upvote_network: RecordedNetwork,
) -> None:
    """Collections and articles are upvotes too, and this product does not act on them."""

    run = upvotes.collect(username="sample-user", max_pages=2)

    assert [item.platform_item_id for item in run.items] == [
        "paper:2510.04871",
        "paper:2606.17090",
        "paper:2607.24653",
    ]
    assert "skipped 3 upvoted article (papers only)" in run.notes
    assert "skipped 2 upvoted collection (papers only)" in run.notes
    assert run.stopped_because == "stopped at the 2-page ceiling"
    assert run.advanced_checkpoint is False


def test_an_upvote_carries_its_own_time_not_a_like(upvote_network: RecordedNetwork) -> None:
    """The point of the surface: the user acted on the paper, and when."""

    run = upvotes.collect(username="sample-user", max_pages=1)

    upvoted = _by_id(run)["paper:2510.04871"]
    assert upvoted.action_at == "2026-09-01T16:43:18.750Z"
    assert upvoted.kind == "paper"
    assert upvoted.canonical_url == "https://huggingface.co/papers/2510.04871"


def test_an_upvoted_paper_brings_its_bundle(upvote_network: RecordedNetwork) -> None:
    """Same document, same branches as a paper reached through a liked model's arXiv tag."""

    run = upvotes.collect(username="sample-user", max_pages=1)

    branches = {row["type"]: row for row in _by_id(run)["paper:2510.04871"].evidence}
    assert branches["paper.github_repo"]["value"] == (
        "https://github.com/SamsungSAILMontreal/TinyRecursiveModels"
    )
    # `githubRepoAddedBy: "user"` — a person linked it, which is not a claim about *which*.
    assert branches["paper.github_repo"]["label"] == "Code · linked by a person"
    assert branches["paper.total_models"]["value"] == "8"


def test_a_paper_the_hub_cannot_describe_is_still_the_upvote(
    upvote_network: RecordedNetwork,
) -> None:
    """A missing bundle must not lose a signal the user actually gave."""

    run = upvotes.collect(username="sample-user", max_pages=1)

    # 2606.17090 has no recorded paper document, so the Hub answers 404 for it.
    stranded = _by_id(run)["paper:2606.17090"]
    assert stranded.evidence == []
    assert stranded.title == "ANEForge: Python for direct computation on the Apple Neural Engine"
    assert stranded.action_at == "2026-08-22T09:37:47.088Z"
    assert stranded.canonical_url == "https://huggingface.co/papers/2606.17090"


def test_the_listing_is_read_with_no_token_even_when_one_is_configured(
    upvote_network: RecordedNetwork,
) -> None:
    """A condition of the exception, not an optimisation: only what a logged-out visitor sees."""

    upvotes.collect(username="sample-user", token="hf_" + "x" * 20, max_pages=1)

    listing_headers = [
        headers for url, headers in upvote_network.requested if "recent-activity" in url
    ]
    assert listing_headers
    assert all(headers == {} for headers in listing_headers)
    # The paper document is a different request, and a token there is ordinary.
    paper_headers = [headers for url, headers in upvote_network.requested if "/papers/" in url]
    assert any(headers.get("Authorization") for headers in paper_headers)


def test_a_run_stops_at_the_previous_run_s_newest_upvote(
    upvote_network: RecordedNetwork,
) -> None:
    run = upvotes.collect(username="sample-user", last_seen="paper:2606.17090")

    assert [item.platform_item_id for item in run.items] == ["paper:2510.04871"]
    assert "reached the previous run's newest upvote" in run.notes
    assert run.advanced_checkpoint is True
    assert run.checkpoint == "paper:2510.04871"


def test_a_seeding_run_that_stopped_early_may_not_move_the_checkpoint(
    upvote_network: RecordedNetwork,
) -> None:
    """Otherwise the next run starts at the top and never looks into the gap it left."""

    run = upvotes.collect(username="sample-user", limit=1)

    assert len(run.items) == 1
    assert run.checkpoint == "paper:2510.04871"
    assert run.advanced_checkpoint is False


def test_resolve_papers_false_keeps_the_upvote_and_skips_the_bundle_request(
    upvote_network: RecordedNetwork,
) -> None:
    run = upvotes.collect(username="sample-user", resolve_papers=False, max_pages=2)

    assert [item.platform_item_id for item in run.items] == [
        "paper:2510.04871",
        "paper:2606.17090",
        "paper:2607.24653",
    ]
    assert all(item.evidence == [] for item in run.items)
    assert not [url for url, _ in upvote_network.requested if "/papers/" in url]


def test_a_changed_shape_stops_this_collector_with_a_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unofficial path may change without notice, and it must not fail quietly."""

    recorded = RecordedNetwork({UPVOTES_URL: {"activities": [], "cursor": None}})
    monkeypatch.setattr(upvotes, "get_json", recorded)

    run = upvotes.collect(username="sample-user")

    assert run.outcome == "failed"
    assert run.stopped_because == upvotes.SHAPE_CHANGED
    assert run.items == []


def test_an_unknown_account_is_reported_as_such(monkeypatch: pytest.MonkeyPatch) -> None:
    recorded = RecordedNetwork({})
    monkeypatch.setattr(upvotes, "get_json", recorded)

    run = upvotes.collect(username="nobody-here")

    assert run.outcome == "failed"
    assert "no Hugging Face user 'nobody-here'" in run.stopped_because


def test_the_two_hugging_face_surfaces_keep_separate_checkpoints() -> None:
    """One path is official and one is not; a shared id would let one answer for the other."""

    assert upvotes.SURFACE != likes.SURFACE
    assert SURFACES[upvotes.SURFACE].official is False
    assert SURFACES[likes.SURFACE].official is True
    assert SURFACES[upvotes.SURFACE].platform == SURFACES[likes.SURFACE].platform
