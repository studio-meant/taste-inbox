"""Enrichment: reading what a repository declares, and recording only that.

The verdict that used to be drawn from these declarations plus the host profile went with
the sandbox runner (docs/DECISIONS.md, 2026-08-09). What remains is the half that was
always an observation — and the rule that a README's prose must not become a number nobody
measured.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.db.models import Base, Evidence, Item
from taste_inbox.enrich import (
    Fact,
    RepositoryFacts,
    Unavailable,
    enrich_repositories,
)
from taste_inbox.enrich.github import owner_and_repo
from taste_inbox.host.models import HostProfile
from taste_inbox.ingest import ingest_all
from taste_inbox.paths import HOST_PROFILE_FIXTURES_DIR


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as active:
        yield active


def host() -> HostProfile:
    path = HOST_PROFILE_FIXTURES_DIR / "capacity-16gb-512gb.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload.pop("availableMemoryGb", None)
    return HostProfile.model_validate(payload)


def facts(**overrides: object) -> RepositoryFacts:
    base: dict[str, object] = {
        "full_name": "a/b",
        "license_name": "MIT License",
        # The real provider always carries at least what the repository API returned, so a
        # fixture without observations would test a shape that never occurs.
        "facts": (Fact("주 언어", "Python", "https://github.com/a/b"),),
    }
    base.update(overrides)
    return RepositoryFacts(**base)  # type: ignore[arg-type]


class TestOwnerAndRepo:
    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("https://github.com/a/b", ("a", "b")),
            ("https://github.com/a/b.git", ("a", "b")),
            ("https://github.com/a/b/tree/main", ("a", "b")),
            ("https://gitlab.com/a/b", None),
            ("https://github.com/a", None),
        ],
    )
    def test_reads_a_repository_out_of_a_url(
        self, url: str, expected: tuple[str, str] | None
    ) -> None:
        assert owner_and_repo(url) == expected


class FakeProvider:
    def __init__(self, result: RepositoryFacts | Unavailable) -> None:
        self._result = result

    def fetch(self, canonical_url: str) -> RepositoryFacts | Unavailable:
        del canonical_url
        return self._result


class ExplodingProvider:
    def fetch(self, canonical_url: str) -> RepositoryFacts | Unavailable:
        del canonical_url
        raise RuntimeError("upstream is down")


def seed(session: Session, tmp_path: Path) -> None:
    payload = {
        "run": {
            "surface": "github_stars_api",
            "outcome": "ok",
            "started_at": "2026-08-09T00:00:00+00:00",
            "checkpoint": "a/b",
            "advanced_checkpoint": True,
            "notes": [],
        },
        "items": [
            {
                "platform": "github",
                "platform_item_id": "a/b",
                "canonical_url": "https://github.com/a/b",
                "kind": "repo",
                "title": "a/b",
                "body_text": "설명",
                "owner": "a",
                "tags": [],
            }
        ],
    }
    (tmp_path / "github_stars_api.json").write_text(json.dumps(payload), "utf-8")
    ingest_all(session, tmp_path)


class TestRunner:
    def test_records_the_declarations_and_nothing_it_concluded(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed(session, tmp_path)
        provider = FakeProvider(facts(mentions_arm64=True))

        report = enrich_repositories(session, provider=provider, host=host())

        assert report.enriched == 1
        rows = {row.type: row.provenance for row in session.scalars(select(Evidence))}
        # What the repository says is an observation, and now the only thing stored.
        assert rows["declared_fact"] == "fact"
        assert "compatibility_verdict" not in rows

    def test_marks_when_something_actually_looked(self, session: Session, tmp_path: Path) -> None:
        seed(session, tmp_path)
        assert session.scalar(select(Item)).checked_at is None  # type: ignore[union-attr]

        enrich_repositories(session, provider=FakeProvider(facts()), host=host())

        stored = session.scalar(select(Item))
        assert stored is not None
        assert stored.checked_at is not None

    def test_never_records_a_figure_nobody_measured(self, session: Session, tmp_path: Path) -> None:
        # A number taken from prose would be invented, and there is no longer even a run
        # that could have produced a real one.
        seed(session, tmp_path)
        enrich_repositories(session, provider=FakeProvider(facts(mentions_arm64=True)), host=host())

        values = {row.label for row in session.scalars(select(Evidence))}
        assert not any("메모리" in label or "GB" in label for label in values)

    def test_does_not_look_again_at_something_already_checked(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Re-reading nightly would spend the unauthenticated rate limit on unchanged
        # answers.
        seed(session, tmp_path)
        enrich_repositories(session, provider=FakeProvider(facts()), host=host())
        second = enrich_repositories(session, provider=FakeProvider(facts()), host=host())

        assert second.skipped == 1
        assert second.enriched == 0

    def test_force_looks_again(self, session: Session, tmp_path: Path) -> None:
        seed(session, tmp_path)
        enrich_repositories(session, provider=FakeProvider(facts()), host=host())
        again = enrich_repositories(
            session, provider=FakeProvider(facts()), host=host(), force=True
        )
        assert again.enriched == 1

    def test_a_provider_that_throws_leaves_the_item_alone(
        self, session: Session, tmp_path: Path
    ) -> None:
        # CLAUDE.md §7: a failed enricher must not invalidate successful collection.
        seed(session, tmp_path)
        report = enrich_repositories(session, provider=ExplodingProvider(), host=host())

        assert report.unavailable == 1
        stored = session.scalar(select(Item))
        assert stored is not None
        assert stored.checked_at is None

    def test_an_unavailable_answer_is_reported_with_its_reason(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed(session, tmp_path)
        report = enrich_repositories(
            session, provider=FakeProvider(Unavailable("요청 한도")), host=host()
        )
        assert report.unavailable == 1
        assert any("요청 한도" in reason for reason in report.reasons)

    def test_re_enriching_replaces_its_own_output_and_nothing_else(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed(session, tmp_path)
        enrich_repositories(
            session,
            provider=FakeProvider(facts(facts=(Fact("주 언어", "Python", None),))),
            host=host(),
        )
        enrich_repositories(
            session,
            provider=FakeProvider(facts(facts=(Fact("주 언어", "Rust", None),))),
            host=host(),
            force=True,
        )

        stored = [
            row.value
            for row in session.scalars(select(Evidence).where(Evidence.type == "declared_fact"))
        ]
        assert stored == ["Rust"]


class TestRequestBudget:
    """Blind manifest fetches were 80% waste.

    Measured across the five collected repositories: four guesses each, twenty requests,
    zero facts — they are TypeScript and Jupyter projects with no `pyproject.toml` to find.
    Unauthenticated GitHub allows sixty requests an hour, so the waste is the difference
    between twelve repositories an hour and thirty.
    """

    def test_asks_what_exists_before_fetching_anything(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from taste_inbox.enrich import github as gh

        seen: list[str] = []

        def fake_get(url: str) -> tuple[bytes | None, str | None]:
            seen.append(url)
            if url.endswith("/contents/"):
                return b'[{"name":"package.json","type":"file"}]', None
            if url.endswith("/repos/a/b"):
                return b'{"description":"x","language":"TypeScript","default_branch":"main"}', None
            return b"{}", None

        monkeypatch.setattr(gh, "_get", fake_get)
        gh.GitHubRepositoryProvider().fetch("https://github.com/a/b")

        # Repo, listing, and only the one manifest that is actually there.
        assert len(seen) == 3
        assert not any("pyproject.toml" in url for url in seen)
        assert any("package.json" in url for url in seen)

    def test_a_failed_listing_fetches_nothing_rather_than_guessing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from taste_inbox.enrich import github as gh

        seen: list[str] = []

        def fake_get(url: str) -> tuple[bytes | None, str | None]:
            seen.append(url)
            if url.endswith("/repos/a/b"):
                return b'{"default_branch":"main"}', None
            return None, "rate_limited"

        monkeypatch.setattr(gh, "_get", fake_get)
        gh.GitHubRepositoryProvider().fetch("https://github.com/a/b")

        # A rate limit is exactly when extra requests are worst.
        assert len(seen) == 2

    def test_refuses_a_url_outside_the_two_known_roots(self) -> None:
        from taste_inbox.enrich.github import _get

        body, reason = _get("https://example.com/evil")
        assert body is None
        assert reason == "refused"


class TestRetiredEvidence:
    def test_re_enriching_clears_what_the_enricher_no_longer_writes(
        self, session: Session, tmp_path: Path
    ) -> None:
        """Removing a feature stops it producing rows; it does not remove the old ones.

        Five `compatibility_verdict` rows outlived the sandbox runner and kept rendering on
        the item detail page, describing an execution the product no longer performs.
        """
        seed(session, tmp_path)
        item = session.scalar(select(Item))
        assert item is not None
        session.add(
            Evidence(
                item_id=item.id,
                type="compatibility_verdict",
                label="unknown",
                value="실행 조건을 확인할 만한 선언이 저장소에 없어요.",
                provenance="inference",
            )
        )
        session.commit()

        enrich_repositories(session, provider=FakeProvider(facts()), host=host())

        assert (
            session.scalar(select(Evidence).where(Evidence.type == "compatibility_verdict")) is None
        )
