"""The schema, exercised against more than one platform.

Every one of the 126 items collected so far is an Instagram save, so the nullability of
`title`, `action_at` and `body_text` is currently a *decision* rather than an observation.
These tests put a GitHub-shaped row and a Threads-shaped row through the same tables, which
is the cheapest way to find out whether the platform-agnostic design actually is one —
`CLAUDE.md` §9 asks for saved fixtures rather than live accounts, and this is that.
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
    MediaAsset,
    RawEvent,
    SourceAccount,
)

NOW = "2026-08-08T07:00:00Z"


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
        "kind": "post",
        "platform": "instagram",
        "platform_item_id": "DAaaaaaaaaa",
        "canonical_url": "https://www.instagram.com/reel/DAaaaaaaaaa/",
        "title": None,
        "body_text": "여름에 이렇게 입고 나갔다가",
        "first_seen_at": NOW,
        "source_published_at": "2025-09-13T04:05:41Z",
        "action_at": None,
        "checked_at": None,
        "updated_at": NOW,
    }
    base.update(overrides)
    return Item(**base)


class TestInstagramShape:
    def test_stores_a_saved_post_with_no_title_and_no_action_time(self, session: Session) -> None:
        # Instagram Saved supplies neither. Filling them in would invent facts.
        source = account(session, "instagram", "__lucky_u___")
        row = item()
        session.add(row)
        session.add(
            ItemSource(
                item_id=row.id,
                source_account_id=source.id,
                action_type="save",
                collection_name="fashion",
                position=0,
                first_seen_at=NOW,
                action_at=None,
            )
        )
        session.commit()

        stored = session.scalar(select(Item))
        assert stored is not None
        assert stored.title is None
        assert stored.action_at is None
        assert stored.checked_at is None

    def test_one_post_can_belong_to_two_collections(self, session: Session) -> None:
        # The reason `item_sources` is a table rather than a column on `items`.
        source = account(session, "instagram", "__lucky_u___")
        row = item()
        session.add(row)
        for name in ("ai", "music"):
            session.add(
                ItemSource(
                    item_id=row.id,
                    source_account_id=source.id,
                    action_type="save",
                    collection_name=name,
                    first_seen_at=NOW,
                )
            )
        session.commit()

        assert len(session.scalars(select(ItemSource)).all()) == 2

    def test_the_same_membership_cannot_be_recorded_twice(self, session: Session) -> None:
        source = account(session, "instagram", "__lucky_u___")
        row = item()
        session.add(row)
        session.flush()
        for _ in range(2):
            session.add(
                ItemSource(
                    item_id=row.id,
                    source_account_id=source.id,
                    collection_name="ai",
                    first_seen_at=NOW,
                )
            )
        with pytest.raises(IntegrityError):
            session.commit()


class TestANewBoardNeedsNoMigration:
    """Adding the places board changed no table, and this is why.

    The design of `item_sources` anticipated exactly this: a board is a value in
    `collection_name`, which is a plain nullable `VARCHAR(64)` with **no CHECK constraint**
    behind it. So a fourth board is a new key in `cards.BOARD_COLLECTIONS` and nothing else
    — no `ALTER`, and none of the table rebuild SQLite would demand if the column were an
    enum. These tests pin that property, because the cheap way to break it is to "tighten"
    the column later and silently make a board unfilable.
    """

    def test_a_places_membership_stores_and_reads_back(self, session: Session) -> None:
        source = account(session, "instagram", "__lucky_u___")
        row = item(
            platform_item_id="DBbbbbbbbbb",
            canonical_url="https://www.instagram.com/p/DBbbbbbbbbb/",
            body_text="성수동 이 카페 진짜 좋았어요 #카페추천",
        )
        session.add(row)
        session.add(
            ItemSource(
                item_id=row.id,
                source_account_id=source.id,
                action_type="save",
                collection_name="places",
                position=0,
                first_seen_at=NOW,
            )
        )
        session.commit()

        stored = session.scalar(select(ItemSource).where(ItemSource.collection_name == "places"))
        assert stored is not None
        assert stored.item_id == row.id

    def test_a_place_is_a_post_and_needs_no_new_kind(self, session: Session) -> None:
        # `items.kind` *is* a CHECK — repo/model/paper/demo/tool/post/product/outfit — and a
        # new member there would need the table rebuild SQLite requires. It does not need
        # one: a saved place is an Instagram post, which the constraint already allows.
        # Anything else would be asserting a classification no enricher has made.
        source = account(session, "instagram", "__lucky_u___")
        row = item(kind="post", platform_item_id="DBbbbbbbbbb")
        row.canonical_url = "https://www.instagram.com/p/DBbbbbbbbbb/"
        session.add(row)
        session.add(
            ItemSource(
                item_id=row.id,
                source_account_id=source.id,
                action_type="save",
                collection_name="places",
                first_seen_at=NOW,
            )
        )
        session.commit()

        stored = session.scalar(select(Item).where(Item.platform_item_id == "DBbbbbbbbbb"))
        assert stored is not None
        assert stored.kind == "post"

    def test_one_post_can_be_filed_under_places_and_another_board_at_once(
        self, session: Session
    ) -> None:
        # The reason `item_sources` is a table. A café post that is also a travel reference
        # can sit on two boards without either row being rewritten.
        source = account(session, "instagram", "__lucky_u___")
        row = item(platform_item_id="DCccccccccc")
        row.canonical_url = "https://www.instagram.com/p/DCccccccccc/"
        session.add(row)
        for name in ("places", "fashion"):
            session.add(
                ItemSource(
                    item_id=row.id,
                    source_account_id=source.id,
                    action_type="save",
                    collection_name=name,
                    first_seen_at=NOW,
                )
            )
        session.commit()

        assert len(session.scalars(select(ItemSource)).all()) == 2


class TestGitHubShape:
    """GitHub reaches columns Instagram never touches."""

    def test_stores_a_star_with_a_title_and_a_real_action_time(self, session: Session) -> None:
        # `starred_at` is supplied, so `action_at` carries a value here — the column is
        # not dead weight, it is simply unknown for one platform.
        source = account(session, "github", "sample-user")
        row = item(
            kind="repo",
            platform="github",
            platform_item_id="123456789",
            canonical_url="https://github.com/anthropics/claude-code",
            title="anthropics/claude-code",
            body_text="Agentic coding tool that lives in your terminal.",
            action_at="2026-08-01T09:12:00Z",
        )
        session.add(row)
        session.add(
            ItemSource(
                item_id=row.id,
                source_account_id=source.id,
                action_type="star",
                collection_name=None,
                first_seen_at=NOW,
                action_at="2026-08-01T09:12:00Z",
            )
        )
        session.commit()

        stored = session.scalar(select(Item).where(Item.platform == "github"))
        assert stored is not None
        assert stored.title == "anthropics/claude-code"
        assert stored.action_at == "2026-08-01T09:12:00Z"

    def test_a_source_with_no_collection_name_is_representable(self, session: Session) -> None:
        # Only Instagram Saved carries a user-declared grouping. A star has none, and a
        # NOT NULL here would have forced an invented value like "starred".
        source = account(session, "github", "sample-user")
        row = item(platform="github", platform_item_id="1", canonical_url="https://github.com/a/b")
        session.add(row)
        session.add(
            ItemSource(
                item_id=row.id,
                source_account_id=source.id,
                action_type="star",
                collection_name=None,
                first_seen_at=NOW,
            )
        )
        session.commit()
        stored = session.scalar(select(ItemSource))
        assert stored is not None
        assert stored.collection_name is None

    def test_two_platforms_coexist(self, session: Session) -> None:
        # The state the boards need before a `source` filter chip can appear at all.
        account(session, "instagram", "__lucky_u___")
        account(session, "github", "sample-user")
        session.add(item())
        session.add(
            item(platform="github", platform_item_id="1", canonical_url="https://github.com/a/b")
        )
        session.commit()
        assert len(session.scalars(select(Item)).all()) == 2


class TestThreadsShape:
    def test_stores_a_repost_with_no_title(self, session: Session) -> None:
        source = account(session, "threads", "oh.suzie")
        row = item(
            platform="threads",
            platform_item_id="DDddddddddd",
            canonical_url="https://www.threads.com/@someone/post/DDddddddddd",
            title=None,
            action_at=None,
        )
        session.add(row)
        session.add(
            ItemSource(
                item_id=row.id,
                source_account_id=source.id,
                action_type="repost",
                first_seen_at=NOW,
            )
        )
        session.commit()
        assert session.scalar(select(Item).where(Item.platform == "threads")) is not None

    def test_a_platform_with_no_account_handle_is_representable(self, session: Session) -> None:
        # arXiv has no account of its own.
        account(session, "arxiv", None)
        assert session.scalar(select(SourceAccount).where(SourceAccount.platform == "arxiv"))


class TestDeduplication:
    def test_the_same_platform_id_cannot_be_stored_twice(self, session: Session) -> None:
        session.add(item())
        session.add(item(canonical_url="https://www.instagram.com/p/DAaaaaaaaaa/"))
        with pytest.raises(IntegrityError):
            session.commit()

    def test_the_same_canonical_url_cannot_be_stored_twice(self, session: Session) -> None:
        session.add(item())
        session.add(item(platform_item_id="DIFFERENT01"))
        with pytest.raises(IntegrityError):
            session.commit()

    def test_the_same_shortcode_on_two_platforms_is_not_a_duplicate(self, session: Session) -> None:
        # Identity is the pair, not the id alone.
        session.add(item())
        session.add(
            item(
                platform="threads",
                canonical_url="https://www.threads.com/@x/post/DAaaaaaaaaa",
            )
        )
        session.commit()
        assert len(session.scalars(select(Item)).all()) == 2


class TestConstraints:
    @pytest.mark.parametrize(
        ("field", "value"),
        [("platform", "myspace"), ("kind", "nonsense")],
    )
    def test_rejects_a_value_the_frontend_cannot_represent(
        self, session: Session, field: str, value: str
    ) -> None:
        session.add(item(**{field: value}))
        with pytest.raises(IntegrityError):
            session.commit()

    def test_rejects_an_action_type_outside_the_shared_enum(self, session: Session) -> None:
        source = account(session, "instagram", "x")
        row = item()
        session.add(row)
        session.flush()
        session.add(
            ItemSource(
                item_id=row.id,
                source_account_id=source.id,
                action_type="bookmarked",
                first_seen_at=NOW,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()

    def test_rejects_a_confidence_outside_zero_to_one(self, session: Session) -> None:
        row = item()
        session.add(row)
        session.flush()
        session.add(
            Evidence(
                item_id=row.id,
                type="audio_attribution",
                label="릴스 오디오 표기",
                value="Ella Mai - Trying",
                provenance="fact",
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
            Evidence(
                item_id=row.id,
                type="guess",
                label="x",
                value="y",
                provenance="vibes",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()

    def test_rejects_a_run_outcome_the_collector_cannot_produce(self, session: Session) -> None:
        session.add(
            CollectorRun(collector_id="instagram_saved_ai", outcome="probably_fine", started_at=NOW)
        )
        with pytest.raises(IntegrityError):
            session.commit()


class TestCheckpoints:
    def test_one_row_per_collection_never_a_union(self, session: Session) -> None:
        for collector in ("instagram_saved_ai", "instagram_saved_music"):
            session.add(Checkpoint(collector_id=collector, last_seen_code="AAA", updated_at=NOW))
        session.commit()
        assert len(session.scalars(select(Checkpoint)).all()) == 2

    def test_a_collection_cannot_have_two_checkpoints(self, session: Session) -> None:
        session.add(Checkpoint(collector_id="instagram_saved_ai", updated_at=NOW))
        session.commit()
        session.add(Checkpoint(collector_id="instagram_saved_ai", updated_at=NOW))
        with pytest.raises(IntegrityError):
            session.commit()

    def test_a_never_run_collector_has_no_code_yet(self, session: Session) -> None:
        session.add(Checkpoint(collector_id="instagram_saved_ai", updated_at=NOW))
        session.commit()
        stored = session.scalar(select(Checkpoint))
        assert stored is not None
        assert stored.last_seen_code is None
        assert stored.last_outcome == "never_run"

    def test_records_whether_a_run_was_allowed_to_advance_the_checkpoint(
        self, session: Session
    ) -> None:
        # The blocked run keeps repeating work on purpose; without this column that looks
        # like a bug and gets optimised back into data loss.
        session.add(
            CollectorRun(
                collector_id="instagram_saved_ai",
                outcome="blocked",
                started_at=NOW,
                advanced_checkpoint=0,
                stopped_because="restriction text",
            )
        )
        session.commit()
        stored = session.scalar(select(CollectorRun))
        assert stored is not None
        assert bool(stored.advanced_checkpoint) is False


class TestMediaAndTags:
    def test_keeps_the_expiring_url_beside_its_expiry(self, session: Session) -> None:
        row = item()
        session.add(row)
        session.flush()
        session.add(
            MediaAsset(
                item_id=row.id,
                role="thumbnail",
                remote_url="https://scontent.cdninstagram.com/v/t51/x.jpg?oe=68AB1234",
                remote_expires_at="2026-08-12T18:38:24Z",
                width=640,
                height=1136,
            )
        )
        session.commit()
        stored = session.scalar(select(MediaAsset))
        assert stored is not None
        assert stored.remote_expires_at == "2026-08-12T18:38:24Z"
        assert stored.local_path is None

    def test_stores_a_landscape_thumbnail(self, session: Session) -> None:
        # One of the 126 is 640x360. A schema or grid that assumes portrait is wrong.
        row = item()
        session.add(row)
        session.flush()
        session.add(MediaAsset(item_id=row.id, width=640, height=360))
        session.commit()
        stored = session.scalar(select(MediaAsset))
        assert stored is not None
        assert stored.width is not None and stored.height is not None
        assert stored.width > stored.height

    def test_a_carousel_keeps_one_row_per_photo(self, session: Session) -> None:
        # The reason `media_assets` is a table rather than three columns on `items`: a
        # carousel is one post with up to twenty photos, and the board renders all of them.
        row = item()
        session.add(row)
        session.flush()
        for role in ("thumbnail", "image_02", "image_03"):
            session.add(
                MediaAsset(
                    item_id=row.id,
                    role=role,
                    remote_url=f"https://scontent.cdninstagram.com/v/t51/{role}.jpg",
                )
            )
        session.commit()

        assert len(session.scalars(select(MediaAsset)).all()) == 3

    def test_one_position_cannot_be_stored_twice_for_one_item(self, session: Session) -> None:
        # `(item_id, role)` is what makes re-ingesting a capture update rows instead of
        # adding them, so a daily re-read cannot grow a five-photo post into fifteen.
        row = item()
        session.add(row)
        session.flush()
        for _ in range(2):
            session.add(MediaAsset(item_id=row.id, role="image_02"))
        with pytest.raises(IntegrityError):
            session.commit()

    def test_tags_are_indexable_and_ordered(self, session: Session) -> None:
        row = item()
        session.add(row)
        session.flush()
        for ordinal, tag in enumerate(["#여름코디", "#데일리룩"]):
            session.add(ItemTag(item_id=row.id, tag=tag, ordinal=ordinal))
        session.commit()
        assert len(session.scalars(select(ItemTag)).all()) == 2

    def test_the_same_tag_is_not_stored_twice_for_one_item(self, session: Session) -> None:
        row = item()
        session.add(row)
        session.flush()
        session.add(ItemTag(item_id=row.id, tag="#ootd", ordinal=0))
        session.add(ItemTag(item_id=row.id, tag="#ootd", ordinal=1))
        with pytest.raises(IntegrityError):
            session.commit()


class TestRawEvents:
    def test_one_row_per_item_per_run(self, session: Session) -> None:
        run = CollectorRun(collector_id="instagram_saved_ai", outcome="ok", started_at=NOW)
        session.add(run)
        session.flush()
        session.add(
            RawEvent(
                run_id=run.id,
                platform="instagram",
                platform_item_id="DAaaaaaaaaa",
                payload='{"code":"DAaaaaaaaaa"}',
                observed_at=NOW,
            )
        )
        session.commit()

        session.add(
            RawEvent(
                run_id=run.id,
                platform="instagram",
                platform_item_id="DAaaaaaaaaa",
                payload="{}",
                observed_at=NOW,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()

    def test_the_same_item_may_be_observed_again_by_a_later_run(self, session: Session) -> None:
        # Re-collection is normal — an interrupted run deliberately walks the same ground.
        for _ in range(2):
            run = CollectorRun(collector_id="instagram_saved_ai", outcome="ok", started_at=NOW)
            session.add(run)
            session.flush()
            session.add(
                RawEvent(
                    run_id=run.id,
                    platform="instagram",
                    platform_item_id="DAaaaaaaaaa",
                    payload="{}",
                    observed_at=NOW,
                )
            )
        session.commit()
        assert len(session.scalars(select(RawEvent)).all()) == 2
