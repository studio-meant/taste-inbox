"""Hugging Face likes → paper bundles, on recorded Hub responses.

The like listing is a real public page with the account name dropped; each liked
repository's own document and each paper it cites were recorded alongside it, so the
walk below — likes, details, arXiv tags, papers — runs exactly as it does live.
"""

from __future__ import annotations

import pytest

from taste_inbox_collectors.api_sources import huggingface
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


def test_upvoted_papers_are_unavailable_with_the_reason() -> None:
    """No public API lists them. The answer is `Unavailable(reason)`, never an empty list."""

    answer = upvotes.get_upvoted_papers()

    assert isinstance(answer, upvotes.Unavailable)
    assert "공개 API로 제공하지 않습니다" in answer.reason
