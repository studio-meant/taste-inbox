"""Reading captures into the database.

The behaviour worth protecting is idempotency: this runs every cycle against files that
mostly contain what they contained last time, so a second read must change nothing except
what actually changed. The failure it prevents is silent duplication — 135 items becoming
270 after a week, with no error anywhere.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.db.models import (
    Base,
    Checkpoint,
    Evidence,
    Item,
    ItemSource,
    ItemTag,
    RawEvent,
)
from taste_inbox.ingest import ingest_all
from taste_inbox.ingest.captures import SOURCE_SURFACES, classify_link


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as active:
        yield active


def payload(platform_item_id: str, **overrides: Any) -> dict[str, Any]:
    """One `github_stars_api` capture holding one starred repository."""
    item: dict[str, Any] = {
        "platform": "github",
        "platform_item_id": platform_item_id,
        "canonical_url": f"https://github.com/{platform_item_id}",
        "kind": "repo",
        "title": platform_item_id,
        "body_text": "설명",
        "owner": platform_item_id.split("/")[0],
        "source_published_at": None,
        "action_at": "2026-09-27T10:00:00Z",
        "tags": [],
        "outbound_urls": [],
        "evidence": [],
    }
    item.update(overrides)
    return {
        "run": {
            "surface": "github_stars_api",
            "outcome": "ok",
            "started_at": "2026-09-28T01:00:00Z",
            "scroll_passes": 1,
            "exhausted": False,
            "checkpoint": platform_item_id,
            "advanced_checkpoint": True,
            "stopped_because": "",
            "notes": [],
        },
        "items": [item],
    }


def write(directory: Path, name: str, document: object) -> None:
    (directory / f"{name}.json").write_text(json.dumps(document, ensure_ascii=False), "utf-8")


def stars(directory: Path, document: object) -> None:
    write(directory, "github_stars_api", document)


def count(session: Session, table: type[Any]) -> int:
    return session.scalar(select(func.count()).select_from(table)) or 0


class TestSurfaces:
    def test_reads_exactly_the_three_collectors(self) -> None:
        assert SOURCE_SURFACES == {
            "github_stars_api": ("github", "star"),
            "huggingface_activity": ("huggingface", "like"),
            "huggingface_upvotes": ("huggingface", "upvote"),
        }

    def test_a_file_from_the_instagram_era_is_not_read(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Left in `var/captures` by an older checkout, it is somebody's old data — and
        # nothing this version can store.
        write(tmp_path, "saved-ai", [{"code": "AAA", "caption": "x"}])
        write(tmp_path, "linkedin_reactions", payload("a/b"))

        report = ingest_all(session, tmp_path)

        assert report.files_read == 0
        assert count(session, Item) == 0


class TestIngestion:
    def test_one_paper_reached_by_a_like_and_an_upvote_is_one_item(
        self, session: Session, tmp_path: Path
    ) -> None:
        paper = {
            "platform": "huggingface",
            "platform_item_id": "paper:2501.12948",
            "canonical_url": "https://huggingface.co/papers/2501.12948",
            "kind": "paper",
            "title": "A Paper",
        }
        for surface in ("huggingface_activity", "huggingface_upvotes"):
            document = payload("x")
            document["run"]["surface"] = surface
            document["items"] = [paper]
            write(tmp_path, surface, document)

        ingest_all(session, tmp_path)

        assert count(session, Item) == 1
        actions = sorted(row.action_type or "" for row in session.scalars(select(ItemSource)))
        assert actions == ["like", "upvote"]

    def test_running_twice_changes_nothing(self, session: Session, tmp_path: Path) -> None:
        stars(tmp_path, payload("a/b", tags=["agents"], outbound_urls=["https://x.dev"]))
        ingest_all(session, tmp_path)
        before = [count(session, table) for table in (Item, ItemSource, ItemTag, Evidence)]

        second = ingest_all(session, tmp_path)

        assert second.items_new == 0
        assert second.memberships_new == 0
        assert [count(session, table) for table in (Item, ItemSource, ItemTag, Evidence)] == before

    def test_never_restates_when_an_item_was_first_seen(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The first time Taste Inbox saw something is a fact about the past. Re-reading
        # the same file tomorrow must not move it to tomorrow.
        stars(tmp_path, payload("a/b"))
        ingest_all(session, tmp_path)
        stored = session.scalar(select(Item))
        assert stored is not None
        original = stored.first_seen_at

        ingest_all(session, tmp_path)
        again = session.scalar(select(Item))
        assert again is not None
        assert again.first_seen_at == original

    def test_picks_up_an_edited_description_and_topics(
        self, session: Session, tmp_path: Path
    ) -> None:
        stars(tmp_path, payload("a/b", body_text="처음", tags=["old"]))
        ingest_all(session, tmp_path)

        stars(tmp_path, payload("a/b", body_text="고침", tags=["new"]))
        ingest_all(session, tmp_path)

        item = session.scalar(select(Item))
        assert item is not None
        assert item.body_text == "고침"
        assert [tag.tag for tag in session.scalars(select(ItemTag))] == ["new"]

    def test_an_item_missing_from_a_later_capture_is_kept(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Unstarring on the platform should not erase the record that it was once
        # collected — that is history, and a page of stars cannot say "removed".
        document = payload("a/b")
        document["items"].append(
            {
                **document["items"][0],
                "platform_item_id": "c/d",
                "canonical_url": "https://github.com/c/d",
            }
        )
        stars(tmp_path, document)
        ingest_all(session, tmp_path)

        stars(tmp_path, payload("a/b"))
        ingest_all(session, tmp_path)

        assert count(session, Item) == 2

    def test_records_when_the_person_acted(self, session: Session, tmp_path: Path) -> None:
        stars(tmp_path, payload("a/b"))
        ingest_all(session, tmp_path)

        membership = session.scalar(select(ItemSource))
        assert membership is not None
        assert membership.action_type == "star"
        assert membership.action_at == "2026-09-27T10:00:00Z"

    def test_stores_the_run_and_advances_the_checkpoint(
        self, session: Session, tmp_path: Path
    ) -> None:
        stars(tmp_path, payload("a/b"))
        ingest_all(session, tmp_path)

        checkpoint = session.get(Checkpoint, "github_stars_api")
        assert checkpoint is not None
        assert checkpoint.last_seen_code == "a/b"

    def test_does_not_advance_a_checkpoint_the_run_was_not_allowed_to_move(
        self, session: Session, tmp_path: Path
    ) -> None:
        document = payload("a/b")
        document["run"]["advanced_checkpoint"] = False
        document["run"]["outcome"] = "rate_limited"
        stars(tmp_path, document)

        ingest_all(session, tmp_path)

        checkpoint = session.get(Checkpoint, "github_stars_api")
        assert checkpoint is not None
        # How the run ended is recorded — Today counts exactly this field. Where the next
        # run resumes from is not, so the run after this one still looks below where this
        # one stopped.
        assert checkpoint.last_outcome == "rate_limited"
        assert checkpoint.last_seen_code is None

    def test_keeps_the_raw_observation(self, session: Session, tmp_path: Path) -> None:
        stars(tmp_path, payload("a/b"))
        ingest_all(session, tmp_path)
        raw = session.scalar(select(RawEvent))
        assert raw is not None
        assert json.loads(raw.payload)["platform_item_id"] == "a/b"

    def test_an_absent_capture_directory_is_not_an_error(
        self, session: Session, tmp_path: Path
    ) -> None:
        assert ingest_all(session, tmp_path / "nope").files_read == 0


class TestStatedEvidence:
    def test_what_the_paper_page_named_is_kept_with_its_provenance(
        self, session: Session, tmp_path: Path
    ) -> None:
        stated = [
            {
                "type": "paper.github_repo",
                "label": "코드",
                "value": "https://github.com/a/code",
                "provenance": "huggingface",
            }
        ]
        stars(tmp_path, payload("a/b", evidence=stated))
        ingest_all(session, tmp_path)

        row = session.scalar(select(Evidence).where(Evidence.type == "paper.github_repo"))
        assert row is not None
        assert (row.value, row.provenance) == ("https://github.com/a/code", "huggingface")

    def test_a_newer_reading_replaces_the_last_one(self, session: Session, tmp_path: Path) -> None:
        # A paper gains linked models over time; appending would list one demo four times.
        first = [{"type": "paper.linked_model", "value": "m1", "provenance": "huggingface"}]
        later = [
            {"type": "paper.linked_model", "value": "m1", "provenance": "huggingface"},
            {"type": "paper.linked_model", "value": "m2", "provenance": "huggingface"},
        ]
        stars(tmp_path, payload("a/b", evidence=first))
        ingest_all(session, tmp_path)
        stars(tmp_path, payload("a/b", evidence=later))
        ingest_all(session, tmp_path)

        values = sorted(
            row.value
            for row in session.scalars(
                select(Evidence).where(Evidence.type == "paper.linked_model")
            )
        )
        assert values == ["m1", "m2"]


class TestFailedRunReachesToday:
    """A collection that stopped has to be visible on the screen built to show it."""

    def _failed(self) -> dict[str, Any]:
        document = payload("a/b")
        document["run"].update(
            outcome="failed",
            advanced_checkpoint=False,
            checkpoint=None,
            started_at="2026-09-28T12:57:14Z",
        )
        document["items"] = []
        return document

    def test_a_failed_run_after_a_good_one_asks_for_a_person(
        self, session: Session, tmp_path: Path
    ) -> None:
        from taste_inbox.api.today import build_today

        stars(tmp_path, payload("a/b"))
        ingest_all(session, tmp_path)
        stars(tmp_path, self._failed())
        ingest_all(session, tmp_path)

        today = build_today(session)
        assert today["counts"]["attention"] == 1
        github = next(
            row for row in today["sourceStatusSummary"]["sources"] if row["platform"] == "github"
        )
        assert github["state"] == "failed"

        checkpoint = session.get(Checkpoint, "github_stars_api")
        assert checkpoint is not None
        # The good run's position survives the bad run, so nothing above it is skipped.
        assert checkpoint.last_seen_code == "a/b"

    def test_a_quiet_run_still_moves_the_stamp(self, session: Session, tmp_path: Path) -> None:
        # A cycle that found nothing new is still a cycle this collector ran.
        document = payload("a/b")
        document["run"].update(advanced_checkpoint=False, outcome="empty")
        document["items"] = []
        stars(tmp_path, document)

        ingest_all(session, tmp_path)

        checkpoint = session.get(Checkpoint, "github_stars_api")
        assert checkpoint is not None
        assert checkpoint.updated_at
        assert checkpoint.last_outcome == "empty"


class TestThinnerRecapture:
    """A later capture can be thinner than an earlier one without the item having changed."""

    def test_a_null_does_not_erase_a_stored_value(self, session: Session, tmp_path: Path) -> None:
        stars(
            tmp_path,
            payload("a/b", body_text="진짜 설명", source_published_at="2026-01-01T00:00:00Z"),
        )
        ingest_all(session, tmp_path)

        stars(tmp_path, payload("a/b", body_text=None, source_published_at=None))
        ingest_all(session, tmp_path)

        item = session.scalar(select(Item))
        assert item is not None
        assert item.body_text == "진짜 설명"
        assert item.source_published_at == "2026-01-01T00:00:00Z"


class TestUpdatedAt:
    def test_a_quiet_re_read_does_not_move_updated_at(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The column means "when this row last changed". Bumping it on unchanged rows makes
        # every stale badge in the UI read as fresh.
        stars(tmp_path, payload("a/b"))
        ingest_all(session, tmp_path)
        first = session.scalar(select(Item))
        assert first is not None
        stamp = first.updated_at

        report = ingest_all(session, tmp_path)

        again = session.scalar(select(Item))
        assert again is not None
        assert again.updated_at == stamp
        assert (report.items_updated, report.items_unchanged) == (0, 1)

    def test_a_change_does_move_it(self, session: Session, tmp_path: Path) -> None:
        stars(tmp_path, payload("a/b", body_text="처음"))
        ingest_all(session, tmp_path)
        stars(tmp_path, payload("a/b", body_text="고침"))

        assert ingest_all(session, tmp_path).items_updated == 1


class TestPartialFailure:
    def test_one_unreadable_file_does_not_discard_the_others(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A collector killed mid-write leaves truncated JSON. Under one transaction that
        # rolled back the good file too, and the run still reported success.
        stars(tmp_path, payload("a/b"))
        (tmp_path / "huggingface_activity.json").write_text('{"items": [', "utf-8")

        report = ingest_all(session, tmp_path)

        assert count(session, Item) == 1
        assert any("huggingface_activity" in entry for entry in report.skipped)

    def test_a_row_the_schema_rejects_does_not_take_the_other_files_with_it(
        self, session: Session, tmp_path: Path
    ) -> None:
        stars(tmp_path, payload("a/b"))
        bad = payload("c/d", kind="outfit")  # removed from the schema on 2026-09-28
        bad["run"]["surface"] = "huggingface_activity"
        write(tmp_path, "huggingface_activity", bad)

        report = ingest_all(session, tmp_path)

        assert count(session, Item) == 1
        assert report.skipped != []

    def test_an_item_with_no_id_or_url_is_skipped_not_coerced(
        self, session: Session, tmp_path: Path
    ) -> None:
        # `str(None)` stored the literal "None"; the second such row collided on the
        # unique index and aborted the whole file.
        document = payload("a/b")
        document["items"][0]["canonical_url"] = None
        document["items"].append({**document["items"][0], "platform_item_id": ""})
        stars(tmp_path, document)

        report = ingest_all(session, tmp_path)

        assert count(session, Item) == 0
        assert len(report.skipped) == 2


class TestLinks:
    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("https://github.com/a/b", "artifact_link"),
            ("https://huggingface.co/meta/x", "artifact_link"),
            ("https://arxiv.org/abs/2401.1", "artifact_link"),
            ("https://bit.ly/abc", "outbound_link"),
            ("https://youtube.com/@x", "outbound_link"),
        ],
    )
    def test_classifies_a_link_by_what_it_can_actually_tell(self, url: str, expected: str) -> None:
        assert classify_link(url) == expected

    def test_records_a_link_once_however_often_it_is_ingested(
        self, session: Session, tmp_path: Path
    ) -> None:
        stars(tmp_path, payload("a/b", outbound_urls=["https://x.dev/a", "https://x.dev/a"]))
        ingest_all(session, tmp_path)
        ingest_all(session, tmp_path)

        assert len(session.scalars(select(Evidence)).all()) == 1


class TestIdentityRefinement:
    """A collector that learns a better id must not strand what it already collected."""

    def test_a_better_id_adopts_the_existing_row_rather_than_adding_one(
        self, session: Session, tmp_path: Path
    ) -> None:
        stars(tmp_path, payload("old/name", outbound_urls=["https://x.dev/a"]))
        ingest_all(session, tmp_path)
        original = session.scalar(select(Item))
        assert original is not None
        original_id = original.id

        renamed = payload("new/name", outbound_urls=["https://x.dev/a"])
        renamed["items"][0]["list_id"] = "old/name"
        stars(tmp_path, renamed)
        ingest_all(session, tmp_path)

        assert count(session, Item) == 1
        adopted = session.scalar(select(Item))
        assert adopted is not None
        # Same row — so nothing referencing it has to move.
        assert adopted.id == original_id
        assert adopted.platform_item_id == "new/name"
        assert count(session, Evidence) == 1

    def test_adoption_never_reaches_across_platforms(
        self, session: Session, tmp_path: Path
    ) -> None:
        # An id is only meaningful within the platform that issued it.
        stars(tmp_path, payload("same"))
        ingest_all(session, tmp_path)

        document = payload(
            "model:same", platform="huggingface", canonical_url="https://huggingface.co/same"
        )
        document["items"][0]["list_id"] = "same"
        document["run"]["surface"] = "huggingface_activity"
        write(tmp_path, "huggingface_activity", document)
        ingest_all(session, tmp_path)

        assert count(session, Item) == 2
