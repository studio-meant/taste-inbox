"""The schema, exercised against the rows this product actually writes.

A starred repository, a liked model, an upvoted paper and a link added by hand go through
the same tables — which is the cheapest way to find out whether the platform-agnostic design
actually is one. `CLAUDE.md` §9 asks for saved fixtures rather than live accounts, and this
is that.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.db.models import (
    Base,
    Checkpoint,
    CollectorRun,
    Evidence,
    Item,
    ItemSource,
    ItemTag,
    Job,
    RawEvent,
    SourceAccount,
)

NOW = "2026-09-28T07:00:00Z"


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    # SQLite ignores foreign keys and, in older builds, some CHECKs unless asked.
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory() as active:
        yield active


def account(session: Session, platform: str, handle: str | None = None) -> SourceAccount:
    row = SourceAccount(
        platform=platform, handle=handle, label=platform.title(), enabled=1, state="collected"
    )
    session.add(row)
    session.flush()
    return row


def item(**overrides: object) -> Item:
    base: dict[str, object] = {
        "id": str(uuid.uuid4()),
        "kind": "repo",
        "platform": "github",
        "platform_item_id": "123456789",
        "canonical_url": "https://github.com/sample-org/agent-kit",
        "title": "sample-org/agent-kit",
        "body_text": "A small toolkit for agents.",
        "first_seen_at": NOW,
        "source_published_at": None,
        "action_at": "2026-09-27T09:12:00Z",
        "checked_at": None,
        "updated_at": NOW,
    }
    base.update(overrides)
    return Item(**base)


def paper() -> Item:
    return item(
        kind="paper",
        platform="huggingface",
        platform_item_id="paper:2501.12948",
        canonical_url="https://huggingface.co/papers/2501.12948",
        title="A Sample Paper",
        action_at=None,
    )


def membership(row: Item, source: SourceAccount, action: str | None) -> ItemSource:
    return ItemSource(
        item_id=row.id, source_account_id=source.id, action_type=action, first_seen_at=NOW
    )


class TestShapes:
    def test_stores_a_star_with_a_title_and_a_real_action_time(self, session: Session) -> None:
        source = account(session, "github", "sample-user")
        row = item()
        session.add(row)
        session.add(membership(row, source, "star"))
        session.commit()

        stored = session.scalar(select(Item).where(Item.platform == "github"))
        assert stored is not None
        assert stored.title == "sample-org/agent-kit"
        assert stored.action_at == "2026-09-27T09:12:00Z"

    def test_a_link_added_by_hand_has_no_action_and_no_account_handle(
        self, session: Session
    ) -> None:
        source = account(session, "web", None)
        row = item(
            kind="post",
            platform="web",
            platform_item_id="manual:abc",
            canonical_url="https://example.com/article",
            title=None,
            action_at=None,
        )
        session.add(row)
        session.add(membership(row, source, None))
        session.commit()
        assert session.scalar(select(ItemSource)) is not None

    @pytest.mark.parametrize("kind", ["repo", "model", "dataset", "space", "paper", "post"])
    def test_every_kind_the_collectors_and_the_manual_form_write(
        self, session: Session, kind: str
    ) -> None:
        session.add(item(kind=kind))
        session.commit()


class TestMemberships:
    def test_one_paper_keeps_both_the_like_and_the_upvote(self, session: Session) -> None:
        """Reached through a liked model *and* upvoted on its own page: one item, two
        signals, each with its own time (docs/DECISIONS.md §업보트)."""
        source = account(session, "huggingface")
        row = paper()
        session.add(row)
        session.add(membership(row, source, "like"))
        session.add(membership(row, source, "upvote"))
        session.commit()
        assert len(session.scalars(select(ItemSource)).all()) == 2

    def test_the_same_signal_cannot_be_recorded_twice(self, session: Session) -> None:
        source = account(session, "huggingface")
        row = paper()
        session.add(row)
        session.add(membership(row, source, "upvote"))
        session.commit()
        session.add(membership(row, source, "upvote"))
        with pytest.raises(IntegrityError):
            session.commit()

    def test_the_saved_collection_column_is_gone(self) -> None:
        assert "collection_name" not in ItemSource.__table__.columns


class TestDeduplication:
    def test_the_same_platform_id_cannot_be_stored_twice(self, session: Session) -> None:
        session.add(item())
        session.add(item(canonical_url="https://github.com/sample-org/renamed"))
        with pytest.raises(IntegrityError):
            session.commit()

    def test_the_same_canonical_url_cannot_be_stored_twice(self, session: Session) -> None:
        session.add(item())
        session.add(item(platform_item_id="987654321"))
        with pytest.raises(IntegrityError):
            session.commit()

    def test_the_same_id_on_two_platforms_is_not_a_duplicate(self, session: Session) -> None:
        # Identity is the pair, not the id alone.
        session.add(item())
        session.add(item(platform="huggingface", canonical_url="https://huggingface.co/x"))
        session.commit()
        assert len(session.scalars(select(Item)).all()) == 2


class TestConstraints:
    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("platform", "myspace"),
            ("kind", "nonsense"),
            # Removed on 2026-09-28 with the Instagram era: nothing here writes them.
            ("platform", "instagram"),
            ("platform", "threads"),
            ("platform", "linkedin"),
            ("kind", "outfit"),
            ("kind", "product"),
        ],
    )
    def test_rejects_a_value_the_frontend_cannot_represent(
        self, session: Session, field: str, value: str
    ) -> None:
        session.add(item(**{field: value}))
        with pytest.raises(IntegrityError):
            session.commit()

    @pytest.mark.parametrize("action", ["bookmarked", "save", "repost"])
    def test_rejects_an_action_type_outside_the_shared_enum(
        self, session: Session, action: str
    ) -> None:
        source = account(session, "github", "x")
        row = item()
        session.add(row)
        session.flush()
        session.add(membership(row, source, action))
        with pytest.raises(IntegrityError):
            session.commit()

    @pytest.mark.parametrize("job_type", ["build", "run", "price", "cleanup"])
    def test_rejects_a_job_type_nothing_produces(self, session: Session, job_type: str) -> None:
        session.add(Job(id="j", type=job_type, state="queued", title="x", created_at=NOW))
        with pytest.raises(IntegrityError):
            session.commit()

    def test_rejects_a_confidence_outside_zero_to_one(self, session: Session) -> None:
        row = item()
        session.add(row)
        session.flush()
        session.add(
            Evidence(
                item_id=row.id,
                type="paper.github_repo",
                label="코드",
                value="https://github.com/a/b",
                provenance="huggingface",
                confidence=1.5,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()

    def test_rejects_evidence_that_does_not_say_where_it_came_from(self, session: Session) -> None:
        row = item()
        session.add(row)
        session.flush()
        session.add(
            Evidence(item_id=row.id, type="guess", label="x", value="y", provenance="vibes")
        )
        with pytest.raises(IntegrityError):
            session.commit()

    def test_rejects_a_run_outcome_the_collector_cannot_produce(self, session: Session) -> None:
        session.add(
            CollectorRun(collector_id="github_stars_api", outcome="probably_fine", started_at=NOW)
        )
        with pytest.raises(IntegrityError):
            session.commit()


class TestCheckpoints:
    def test_one_row_per_collector_never_a_union(self, session: Session) -> None:
        for collector in ("huggingface_activity", "huggingface_upvotes"):
            session.add(Checkpoint(collector_id=collector, last_seen_code="x", updated_at=NOW))
        session.commit()
        assert len(session.scalars(select(Checkpoint)).all()) == 2

    def test_a_collector_cannot_have_two_checkpoints(self, session: Session) -> None:
        session.add(Checkpoint(collector_id="github_stars_api", updated_at=NOW))
        session.commit()
        session.add(Checkpoint(collector_id="github_stars_api", updated_at=NOW))
        with pytest.raises(IntegrityError):
            session.commit()

    def test_a_never_run_collector_has_no_code_yet(self, session: Session) -> None:
        session.add(Checkpoint(collector_id="github_stars_api", updated_at=NOW))
        session.commit()
        stored = session.scalar(select(Checkpoint))
        assert stored is not None
        assert stored.last_seen_code is None
        assert stored.last_outcome == "never_run"

    def test_records_whether_a_run_was_allowed_to_advance_the_checkpoint(
        self, session: Session
    ) -> None:
        # A truncated run repeats work on purpose; without this column that looks like a
        # bug and gets optimised back into data loss.
        session.add(
            CollectorRun(
                collector_id="github_stars_api",
                outcome="rate_limited",
                started_at=NOW,
                advanced_checkpoint=0,
                stopped_because="시간당 한도",
            )
        )
        session.commit()
        stored = session.scalar(select(CollectorRun))
        assert stored is not None
        assert bool(stored.advanced_checkpoint) is False


class TestTags:
    def test_tags_are_indexable_and_ordered(self, session: Session) -> None:
        row = item()
        session.add(row)
        session.flush()
        for ordinal, tag in enumerate(["agents", "llm"]):
            session.add(ItemTag(item_id=row.id, tag=tag, ordinal=ordinal))
        session.commit()
        assert len(session.scalars(select(ItemTag)).all()) == 2

    def test_the_same_tag_is_not_stored_twice_for_one_item(self, session: Session) -> None:
        row = item()
        session.add(row)
        session.flush()
        session.add(ItemTag(item_id=row.id, tag="agents", ordinal=0))
        session.add(ItemTag(item_id=row.id, tag="agents", ordinal=1))
        with pytest.raises(IntegrityError):
            session.commit()


class TestRawEvents:
    def _run(self, session: Session) -> CollectorRun:
        run = CollectorRun(collector_id="github_stars_api", outcome="ok", started_at=NOW)
        session.add(run)
        session.flush()
        return run

    def _event(self, run: CollectorRun) -> RawEvent:
        return RawEvent(
            run_id=run.id,
            platform="github",
            platform_item_id="123456789",
            payload="{}",
            observed_at=NOW,
        )

    def test_one_row_per_item_per_run(self, session: Session) -> None:
        run = self._run(session)
        session.add(self._event(run))
        session.commit()
        session.add(self._event(run))
        with pytest.raises(IntegrityError):
            session.commit()

    def test_the_same_item_may_be_observed_again_by_a_later_run(self, session: Session) -> None:
        # Re-collection is normal — a truncated run deliberately walks the same ground.
        for _ in range(2):
            session.add(self._event(self._run(session)))
        session.commit()
        assert len(session.scalars(select(RawEvent)).all()) == 2
