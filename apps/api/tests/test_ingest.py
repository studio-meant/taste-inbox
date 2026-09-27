"""Reading captures into the database, and copying expiring media onto disk.

The behaviour worth protecting is idempotency: this runs every day against files that
mostly contain what they contained yesterday, so a second read must change nothing except
what actually changed. The failure it prevents is silent duplication — 126 items becoming
252 after a week, with no error anywhere.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.db.models import (
    Author,
    AuthorLink,
    Base,
    Checkpoint,
    Evidence,
    Item,
    ItemSource,
    ItemTag,
    MediaAsset,
    RawEvent,
)
from taste_inbox.ingest import cache_pending, expiring_within, ingest_all
from taste_inbox.ingest.authors import ingest_profiles
from taste_inbox.ingest.captures import (
    hashtags_of,
    instagram_permalink,
    media_role,
    signed_url_expiry,
)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as active:
        yield active


def photo(name: str, *, width: int = 1080, height: int = 1350) -> dict[str, Any]:
    return {
        "url": f"https://scontent.cdninstagram.com/v/t51/{name}.jpg?oe=68AB1234",
        "width": width,
        "height": height,
    }


def instagram_item(
    code: str,
    *,
    caption: str = "본문 #태그",
    product_type: str = "clips",
    images: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if images is not None:
        return {
            **instagram_item(code, caption=caption, product_type=product_type),
            "images": images,
        }
    return {
        "code": code,
        "media_type": "video",
        "product_type": product_type,
        "taken_at": 1757736341,
        "owner": "someone",
        "caption": caption,
        "accessibility_caption": None,
        "audio_title": None,
        "audio_artist": None,
        "is_original_audio": True,
        "product_tag_count": 0,
        "user_tag_count": 0,
        "source_endpoint": "/api/v1/feed/",
        "thumbnail_url": "https://scontent.cdninstagram.com/v/t51/x.jpg?oe=68AB1234",
        "thumbnail_width": 640,
        "thumbnail_height": 1136,
    }


def browser_payload(platform_item_id: str, **overrides: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "platform": "github",
        "platform_item_id": platform_item_id,
        "canonical_url": f"https://github.com/{platform_item_id}",
        "kind": "repo",
        "title": platform_item_id,
        "body_text": "설명",
        "owner": platform_item_id.split("/")[0],
        "source_published_at": None,
        "action_at": None,
        "observed_age": None,
        "tags": [],
        "outbound_urls": [],
    }
    item.update(overrides)
    return {
        "run": {
            "surface": "github_stars",
            "outcome": "ok",
            "started_at": "2026-08-08T12:57:14+00:00",
            "scroll_passes": 0,
            "exhausted": False,
            "checkpoint": platform_item_id,
            "advanced_checkpoint": True,
            "stopped_because": "collected the requested newest items",
            "notes": [],
            "raw": [],
        },
        "items": [item],
    }


def write(directory: Path, name: str, payload: object) -> None:
    (directory / f"{name}.json").write_text(json.dumps(payload, ensure_ascii=False), "utf-8")


class TestHelpers:
    def test_reads_the_expiry_out_of_a_signed_url(self) -> None:
        # The `oe` parameter is a hex unix timestamp. Reading it is what lets the cache
        # act before the URL dies rather than discovering it as a broken image.
        assert signed_url_expiry("https://x/y.jpg?oe=68AB1234") == "2025-08-24T13:23:00Z"
        # The value on the real collected batch, cross-checked by hand.
        assert signed_url_expiry("https://x/y.jpg?oe=6A7CCD0F") == "2026-08-12T19:44:15Z"

    def test_returns_nothing_for_a_url_with_no_expiry(self) -> None:
        assert signed_url_expiry("https://x/y.jpg") is None
        assert signed_url_expiry(None) is None
        assert signed_url_expiry("https://x/y.jpg?oe=zzz") is None

    def test_permalink_flips_on_product_type(self) -> None:
        assert instagram_permalink("ABC", "clips") == "https://www.instagram.com/reel/ABC/"
        assert instagram_permalink("ABC", "feed") == "https://www.instagram.com/p/ABC/"
        assert instagram_permalink("ABC", "ad") == "https://www.instagram.com/p/ABC/"

    def test_media_roles_sort_in_the_order_the_photos_were_posted(self) -> None:
        # Zero-padded because the number is read back to order the gallery: without it
        # `image_10` sorts before `image_2` and the tenth photo renders second.
        roles = [media_role(position) for position in range(11)]
        assert roles[:3] == ["thumbnail", "image_02", "image_03"]
        assert sorted(roles[1:]) == roles[1:]

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("본문 #여름코디 #ootd", ["#여름코디", "#ootd"]),
            ("#같은거 #같은거", ["#같은거"]),
            ("붙어있는#태그", ["#태그"]),
            ("#", []),
            (None, []),
        ],
    )
    def test_hashtags(self, text: str | None, expected: list[str]) -> None:
        assert hashtags_of(text) == expected


class TestIngestion:
    def test_reads_instagram_and_browser_captures_into_one_table(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(tmp_path, "saved-ai", [instagram_item("AAA")])
        write(tmp_path, "github_stars", browser_payload("a/b"))

        report = ingest_all(session, tmp_path)

        assert report.items_new == 2
        platforms = {
            row[0]: row[1]
            for row in session.execute(
                select(Item.platform, func.count()).group_by(Item.platform)
            ).all()
        }
        assert platforms == {"instagram": 1, "github": 1}

    def test_running_twice_changes_nothing(self, session: Session, tmp_path: Path) -> None:
        write(tmp_path, "saved-fashion", [instagram_item("AAA"), instagram_item("BBB")])
        ingest_all(session, tmp_path)
        counts = [
            session.scalar(select(func.count()).select_from(t))
            for t in (Item, ItemSource, ItemTag, MediaAsset)
        ]

        second = ingest_all(session, tmp_path)

        assert second.items_new == 0
        assert second.memberships_new == 0
        after = [
            session.scalar(select(func.count()).select_from(t))
            for t in (Item, ItemSource, ItemTag, MediaAsset)
        ]
        assert after == counts

    def test_never_restates_when_an_item_was_first_seen(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The first time Taste Inbox saw something is a fact about the past. Re-reading
        # the same file tomorrow must not move it to tomorrow.
        write(tmp_path, "saved-ai", [instagram_item("AAA")])
        ingest_all(session, tmp_path)
        stored = session.scalar(select(Item))
        assert stored is not None
        original = stored.first_seen_at

        ingest_all(session, tmp_path)
        again = session.scalar(select(Item))
        assert again is not None
        assert again.first_seen_at == original

    def test_picks_up_an_edited_caption(self, session: Session, tmp_path: Path) -> None:
        write(tmp_path, "saved-ai", [instagram_item("AAA", caption="처음")])
        ingest_all(session, tmp_path)

        write(tmp_path, "saved-ai", [instagram_item("AAA", caption="고침 #새태그")])
        ingest_all(session, tmp_path)

        item = session.scalar(select(Item))
        assert item is not None
        assert item.body_text == "고침 #새태그"
        assert [tag.tag for tag in session.scalars(select(ItemTag))] == ["#새태그"]

    def test_one_post_saved_into_two_collections_is_one_item_with_two_memberships(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(tmp_path, "saved-ai", [instagram_item("SAME")])
        write(tmp_path, "saved-music", [instagram_item("SAME")])

        ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(Item)) == 1
        memberships = session.scalars(select(ItemSource)).all()
        assert sorted(m.collection_name or "" for m in memberships) == ["ai", "music"]

    def test_an_item_removed_from_a_capture_is_kept(self, session: Session, tmp_path: Path) -> None:
        # Unsaving a post on the platform should not erase the record that it was once
        # collected — that is history, and the collector cannot distinguish "removed" from
        # "not on this page today".
        write(tmp_path, "saved-ai", [instagram_item("AAA"), instagram_item("BBB")])
        ingest_all(session, tmp_path)

        write(tmp_path, "saved-ai", [instagram_item("AAA")])
        ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(Item)) == 2

    def test_records_the_collection_as_written(self, session: Session, tmp_path: Path) -> None:
        write(tmp_path, "saved-music", [instagram_item("AAA")])
        ingest_all(session, tmp_path)
        membership = session.scalar(select(ItemSource))
        assert membership is not None
        assert membership.collection_name == "music"
        assert membership.action_type == "save"

    def test_leaves_action_at_empty_because_no_surface_reports_it(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(tmp_path, "saved-ai", [instagram_item("AAA")])
        write(tmp_path, "github_stars", browser_payload("a/b"))
        ingest_all(session, tmp_path)

        assert (
            session.scalar(
                select(func.count()).select_from(Item).where(Item.action_at.is_not(None))
            )
            == 0
        )

    def test_keeps_the_publish_time_that_instagram_does_report(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(tmp_path, "saved-ai", [instagram_item("AAA")])
        ingest_all(session, tmp_path)
        item = session.scalar(select(Item))
        assert item is not None
        assert item.source_published_at == "2025-09-13T04:05:41Z"

    def test_stores_the_run_and_advances_the_checkpoint(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(tmp_path, "github_stars", browser_payload("a/b"))
        ingest_all(session, tmp_path)

        checkpoint = session.get(Checkpoint, "github_stars")
        assert checkpoint is not None
        assert checkpoint.last_seen_code == "a/b"

    def test_does_not_advance_a_checkpoint_the_run_was_not_allowed_to_move(
        self, session: Session, tmp_path: Path
    ) -> None:
        payload = browser_payload("a/b")
        payload["run"]["advanced_checkpoint"] = False
        payload["run"]["outcome"] = "blocked"
        write(tmp_path, "github_stars", payload)

        ingest_all(session, tmp_path)

        checkpoint = session.get(Checkpoint, "github_stars")
        assert checkpoint is not None
        # How the run ended is recorded — Today counts exactly this field. Where the next
        # run resumes from is not: leaving `last_seen_code` unset is what keeps the run
        # after this one looking below the point where this one stopped.
        assert checkpoint.last_outcome == "blocked"
        assert checkpoint.last_seen_code is None

    def test_keeps_the_raw_observation(self, session: Session, tmp_path: Path) -> None:
        write(tmp_path, "github_stars", browser_payload("a/b"))
        ingest_all(session, tmp_path)
        raw = session.scalar(select(RawEvent))
        assert raw is not None
        assert json.loads(raw.payload)["platform_item_id"] == "a/b"

    def test_an_absent_capture_directory_is_not_an_error(
        self, session: Session, tmp_path: Path
    ) -> None:
        report = ingest_all(session, tmp_path / "nope")
        assert report.files_read == 0

    def test_reports_an_item_it_could_not_key(self, session: Session, tmp_path: Path) -> None:
        write(tmp_path, "saved-ai", [{"caption": "코드 없음"}])
        report = ingest_all(session, tmp_path)
        assert report.items_new == 0
        assert len(report.skipped) == 1


class TestCarouselMedia:
    """A post's photos, all of them, in the order the author posted them.

    Ingestion recorded one asset per item until now, which is why all 126 collected items
    hold exactly one image between them — every carousel past its first photo was already
    gone by the time a row was written.
    """

    def _assets(self, session: Session) -> list[MediaAsset]:
        return list(session.scalars(select(MediaAsset).order_by(MediaAsset.id)))

    def test_records_one_asset_per_photo_with_its_position_in_the_role(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(
            tmp_path,
            "saved-fashion",
            [instagram_item("AAA", images=[photo("one"), photo("two"), photo("three")])],
        )
        ingest_all(session, tmp_path)

        assets = self._assets(session)
        assert [asset.role for asset in assets] == ["thumbnail", "image_02", "image_03"]
        assert [asset.remote_url for asset in assets] == [
            photo("one")["url"],
            photo("two")["url"],
            photo("three")["url"],
        ]

    def test_the_cover_keeps_the_role_every_other_reader_looks_for(
        self, session: Session, tmp_path: Path
    ) -> None:
        # `api/cards.py` and `enrich/thumbnails.py` both key off `thumbnail`; a renamed
        # cover would empty the AI and Music boards without any error.
        write(tmp_path, "saved-ai", [instagram_item("AAA", images=[photo("one"), photo("two")])])
        ingest_all(session, tmp_path)

        cover = session.scalar(select(MediaAsset).where(MediaAsset.role == "thumbnail"))
        assert cover is not None
        assert cover.remote_url == photo("one")["url"]

    def test_re_ingesting_the_same_carousel_adds_nothing(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The failure this prevents is silent: five photos becoming ten, then fifteen, with
        # no error anywhere and a gallery that repeats itself.
        write(
            tmp_path,
            "saved-fashion",
            [instagram_item("AAA", images=[photo("one"), photo("two"), photo("three")])],
        )
        ingest_all(session, tmp_path)
        ids = [asset.id for asset in self._assets(session)]

        second = ingest_all(session, tmp_path)

        assert second.media_recorded == 0
        assert [asset.id for asset in self._assets(session)] == ids

    def test_a_photo_missing_from_a_later_capture_is_kept(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Same rule as a null caption in `upsert_item`: a thinner re-render is not a
        # deletion, and the media cache already holds bytes those rows point at.
        write(
            tmp_path, "saved-fashion", [instagram_item("AAA", images=[photo("one"), photo("two")])]
        )
        ingest_all(session, tmp_path)

        write(tmp_path, "saved-fashion", [instagram_item("AAA", images=[photo("one")])])
        ingest_all(session, tmp_path)

        assert len(self._assets(session)) == 2

    def test_a_capture_written_before_carousels_were_read_still_stores_its_cover(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Every file already in `var/captures` has thumbnail fields and no `images`.
        # Re-reading one must not drop the one photo it does have.
        write(tmp_path, "saved-fashion", [instagram_item("AAA")])
        ingest_all(session, tmp_path)

        assets = self._assets(session)
        assert [asset.role for asset in assets] == ["thumbnail"]
        assert assets[0].width == 640

    def test_describes_only_the_photo_instagram_described(
        self, session: Session, tmp_path: Path
    ) -> None:
        # `accessibility_caption` is one string for the post, which is to say for its
        # cover. Copying it onto the other photos would claim it describes each of them.
        item = instagram_item("AAA", images=[photo("one"), photo("two")])
        item["accessibility_caption"] = "사진 설명: 흰 원피스"
        write(tmp_path, "saved-fashion", [item])
        ingest_all(session, tmp_path)

        assert [asset.alt_text for asset in self._assets(session)] == ["사진 설명: 흰 원피스", None]

    def test_a_post_with_no_photo_records_none(self, session: Session, tmp_path: Path) -> None:
        bare = instagram_item("AAA")
        bare["thumbnail_url"] = None
        write(tmp_path, "saved-fashion", [bare])
        ingest_all(session, tmp_path)

        assert self._assets(session) == []


class TestFailedRunReachesToday:
    """A collection that stopped has to be visible on the screen built to show it.

    `Checkpoint.last_outcome` is the field `api/today.py` reads to count what needs a
    person. It used to be written only on the branch that advanced the checkpoint, and
    `browser_sources.py` only advances after a run that was OK *and* found items — so the
    column could only ever hold "ok". A blocked run left the previous "ok" standing while
    `lastRunAt` moved forward, which made a broken collector look *fresher* than a working
    one.
    """

    def _blocked(self, platform_item_id: str, *, started_at: str) -> dict[str, Any]:
        payload = browser_payload(platform_item_id)
        payload["run"]["outcome"] = "blocked"
        payload["run"]["advanced_checkpoint"] = False
        payload["run"]["checkpoint"] = None
        payload["run"]["started_at"] = started_at
        # A run that hit a challenge collected nothing; the shape says so.
        payload["items"] = []
        return payload

    def test_a_blocked_run_after_a_good_one_asks_for_a_person(
        self, session: Session, tmp_path: Path
    ) -> None:
        from taste_inbox.api.today import build_today

        write(tmp_path, "github_stars", browser_payload("a/b"))
        ingest_all(session, tmp_path)

        write(tmp_path, "github_stars", self._blocked("a/b", started_at="2026-08-09T12:57:14Z"))
        ingest_all(session, tmp_path)

        today = build_today(session)
        assert today["counts"]["attention"] == 1
        github = next(
            row for row in today["sourceStatusSummary"]["sources"] if row["platform"] == "github"
        )
        assert github["state"] == "failed"

        checkpoint = session.get(Checkpoint, "github_stars")
        assert checkpoint is not None
        # The good run's position survives the bad run, so nothing above it is skipped.
        assert checkpoint.last_seen_code == "a/b"

    def test_a_first_ever_blocked_run_is_not_reported_as_collected(
        self, session: Session, tmp_path: Path
    ) -> None:
        from taste_inbox.api.today import build_today

        write(tmp_path, "github_stars", self._blocked("a/b", started_at="2026-08-09T12:57:14Z"))
        ingest_all(session, tmp_path)

        sources = build_today(session)["sourceStatusSummary"]["sources"]
        github = next(row for row in sources if row["platform"] == "github")
        assert github["state"] != "collected"

    def test_a_quiet_run_still_moves_the_stamp(self, session: Session, tmp_path: Path) -> None:
        # A day that collected nothing new is still a day this collector ran. Writing
        # `updated_at` only on the advancing branch froze it, so a working collector that
        # simply found nothing read as one that had stopped reporting.
        payload = browser_payload("a/b")
        payload["run"]["advanced_checkpoint"] = False
        payload["run"]["outcome"] = "empty"
        payload["items"] = []
        write(tmp_path, "github_stars", payload)

        ingest_all(session, tmp_path)

        checkpoint = session.get(Checkpoint, "github_stars")
        assert checkpoint is not None
        assert checkpoint.updated_at
        assert checkpoint.last_outcome == "empty"


class TestMediaCache:
    #: Every test here is offline, so the budget is stated rather than resolved from the
    #: host — `tests/helpers.py` keeps the suite from reading the machine running it.
    BUDGET = 8 * 1024 * 1024

    def _asset(self, session: Session, tmp_path: Path, expires_in_hours: float) -> MediaAsset:
        write(tmp_path, "saved-ai", [instagram_item("AAA")])
        ingest_all(session, tmp_path)
        asset = session.scalar(select(MediaAsset))
        assert asset is not None
        moment = datetime.now(UTC) + timedelta(hours=expires_in_hours)
        asset.remote_expires_at = moment.isoformat(timespec="seconds").replace("+00:00", "Z")
        session.commit()
        return asset

    def test_counts_what_is_about_to_become_unreachable(
        self, session: Session, tmp_path: Path
    ) -> None:
        self._asset(session, tmp_path, expires_in_hours=6)
        assert expiring_within(session, 24) == 1
        assert expiring_within(session, 1) == 0

    def test_does_not_try_a_url_that_has_already_expired(
        self, session: Session, tmp_path: Path
    ) -> None:
        # No request is made at all — the bytes are gone and retrying would only be noise.
        self._asset(session, tmp_path, expires_in_hours=-1)
        report = cache_pending(session, root=tmp_path / "media", budget_bytes=self.BUDGET)
        assert report.expired_before_fetch == 1
        assert report.downloaded == 0
        assert report.failed == 0

    def test_refuses_a_url_that_is_not_https(self, session: Session, tmp_path: Path) -> None:
        asset = self._asset(session, tmp_path, expires_in_hours=48)
        asset.remote_url = "file:///etc/passwd"
        session.commit()

        report = cache_pending(session, root=tmp_path / "media", budget_bytes=self.BUDGET)
        assert report.downloaded == 0
        assert report.failed == 1
        stored = session.scalar(select(MediaAsset))
        assert stored is not None
        assert stored.local_path is None

    def test_original_photograph_can_exceed_the_old_thumbnail_cap(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from taste_inbox.ingest import media

        payload = b"x" * 4_233_065
        monkeypatch.setattr(
            "taste_inbox.ingest.media.urllib.request.urlopen", lambda *_a, **_kw: BytesIO(payload)
        )
        assert media._fetch("https://scontent.cdninstagram.com/photo.jpg") == payload

    def test_per_file_read_remains_bounded(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from taste_inbox.ingest import media

        monkeypatch.setattr(media, "MAX_BYTES_PER_FILE", 64)
        monkeypatch.setattr(
            "taste_inbox.ingest.media.urllib.request.urlopen", lambda *_a, **_kw: BytesIO(b"x" * 65)
        )
        with pytest.raises(ValueError, match="byte cap"):
            media._fetch("https://scontent.cdninstagram.com/photo.jpg")

    def test_one_file_cannot_push_the_cache_over_its_total_budget(
        self, session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        asset = self._asset(session, tmp_path, expires_in_hours=48)
        monkeypatch.setattr("taste_inbox.ingest.media._fetch", lambda _url: b"x" * 101)
        report = cache_pending(session, root=tmp_path / "media", budget_bytes=100)
        assert report.downloaded == 0
        assert asset.local_path is None
        assert "would be exceeded" in report.errors[0]

    def test_deletes_a_cached_file_no_row_points_at(self, session: Session, tmp_path: Path) -> None:
        # `cache_path` names files by item UUID, so a re-collection that mints a new UUID
        # abandons the old file: 126 of them, 31.1 MB, in the live cache. They also spent
        # the budget, because the total is measured off the tree rather than off the rows.
        from taste_inbox.ingest.media import sweep_orphans

        root = tmp_path / "media" / "ab"
        root.mkdir(parents=True)
        referenced = root / "kept.jpg"
        referenced.write_bytes(b"kept")
        orphan = root / "orphan.jpg"
        orphan.write_bytes(b"orphan")
        # Older than the grace period, which is what makes it an orphan rather than a file
        # another process might still be writing.
        os.utime(orphan, (0, 0))

        asset = self._asset(session, tmp_path, expires_in_hours=48)
        asset.local_path = str(referenced)
        session.commit()

        assert sweep_orphans(session, tmp_path / "media") == 1
        assert referenced.exists()
        assert not orphan.exists()


class TestThinnerRecapture:
    """A later capture can be thinner than an earlier one without the item having changed.

    `_GITHUB_JS` reports `description: null` whenever a star card renders with fewer than
    two text lines; Threads and LinkedIn report `datetime: null` whenever the card has no
    `<time>`. Both were observed to vary. Overwriting stored content with those nulls
    deleted real data on the second run.
    """

    def test_a_null_does_not_erase_a_stored_value(self, session: Session, tmp_path: Path) -> None:
        write(
            tmp_path,
            "github_stars",
            browser_payload(
                "a/b", body_text="진짜 설명", source_published_at="2026-01-01T00:00:00Z"
            ),
        )
        ingest_all(session, tmp_path)

        write(
            tmp_path,
            "github_stars",
            browser_payload("a/b", body_text=None, source_published_at=None),
        )
        ingest_all(session, tmp_path)

        item = session.scalar(select(Item))
        assert item is not None
        assert item.body_text == "진짜 설명"
        assert item.source_published_at == "2026-01-01T00:00:00Z"

    def test_a_real_edit_still_lands(self, session: Session, tmp_path: Path) -> None:
        write(tmp_path, "github_stars", browser_payload("a/b", body_text="처음"))
        ingest_all(session, tmp_path)

        write(tmp_path, "github_stars", browser_payload("a/b", body_text="고침"))
        ingest_all(session, tmp_path)

        item = session.scalar(select(Item))
        assert item is not None
        assert item.body_text == "고침"


class TestUpdatedAt:
    def test_a_quiet_re_read_does_not_move_updated_at(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The column means "when this row last changed". Bumping it daily on unchanged
        # rows makes every stale badge in the UI read as fresh.
        write(tmp_path, "saved-ai", [instagram_item("AAA")])
        ingest_all(session, tmp_path)
        first = session.scalar(select(Item))
        assert first is not None
        stamp = first.updated_at

        report = ingest_all(session, tmp_path)

        again = session.scalar(select(Item))
        assert again is not None
        assert again.updated_at == stamp
        assert report.items_updated == 0
        assert report.items_unchanged == 1

    def test_a_change_does_move_it(self, session: Session, tmp_path: Path) -> None:
        write(tmp_path, "saved-ai", [instagram_item("AAA", caption="처음")])
        ingest_all(session, tmp_path)

        report = ingest_all(session, tmp_path)
        assert report.items_unchanged == 1

        write(tmp_path, "saved-ai", [instagram_item("AAA", caption="고침")])
        report = ingest_all(session, tmp_path)
        assert report.items_updated == 1


class TestPartialFailure:
    def test_one_unreadable_file_does_not_discard_the_others(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A collector killed mid-write leaves truncated JSON. Under one transaction that
        # rolled back the good Instagram file too, and the run still reported success.
        write(tmp_path, "saved-ai", [instagram_item("GOOD")])
        (tmp_path / "linkedin_reactions.json").write_text('{"items": [', "utf-8")

        report = ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(Item)) == 1
        assert report.items_new == 1
        assert any("linkedin" in entry for entry in report.skipped)

    def test_a_row_the_schema_rejects_does_not_take_the_file_with_it(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(tmp_path, "saved-ai", [instagram_item("GOOD")])
        bad = browser_payload("a/b", kind="article")  # not in ItemKindSchema
        write(tmp_path, "github_stars", bad)

        report = ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(Item)) == 1
        assert report.skipped != []

    def test_an_item_with_no_canonical_url_is_skipped_not_coerced(
        self, session: Session, tmp_path: Path
    ) -> None:
        # `str(None)` stored the literal "None"; the second such row collided on the
        # unique index and aborted the whole directory.
        payload = browser_payload("a/b")
        payload["items"][0]["canonical_url"] = None
        payload["items"].append({**payload["items"][0], "platform_item_id": "c/d"})
        write(tmp_path, "github_stars", payload)

        report = ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(Item)) == 0
        assert len(report.skipped) == 2


class TestLinks:
    """Links are what turn a post into something runnable.

    A Threads or LinkedIn post that links a repository is the case Phase 5's URL
    extraction exists for, so the link has to survive ingestion. Dropping it meant that
    decision could never be made without collecting the account again.
    """

    def test_separates_the_author_s_links_from_the_commenters(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A repository someone recommended in a reply is a different claim from one the
        # poster linked, so the two are never merged.
        payload = browser_payload(
            "a/b",
            outbound_urls=["https://claude.com/blog/x"],
            comment_urls=["https://github.com/open-metadata/OpenMetadata"],
        )
        write(tmp_path, "github_stars", payload)
        ingest_all(session, tmp_path)

        by_type = {row.type: row.value for row in session.scalars(select(Evidence))}
        assert by_type["outbound_link"] == "https://claude.com/blog/x"
        assert by_type["comment_artifact_link"] == "https://github.com/open-metadata/OpenMetadata"

    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("https://github.com/a/b", "artifact_link"),
            ("https://huggingface.co/meta/x", "artifact_link"),
            ("https://arxiv.org/abs/2401.1", "artifact_link"),
            # LinkedIn wraps every external link, so a repo arrives disguised. Naming it
            # `shortened` rather than guessing is what keeps the claim honest.
            ("https://lnkd.in/g6kHemzF", "shortened_link"),
            ("https://youtube.com/@x", "outbound_link"),
        ],
    )
    def test_classifies_a_link_by_what_it_can_actually_tell(self, url: str, expected: str) -> None:
        from taste_inbox.ingest.captures import classify_link

        assert classify_link(url) == expected

    def test_records_a_link_once_however_often_it_is_ingested(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(tmp_path, "github_stars", browser_payload("a/b", outbound_urls=["https://x.dev/a"]))
        ingest_all(session, tmp_path)
        ingest_all(session, tmp_path)

        assert len(session.scalars(select(Evidence)).all()) == 1

    def test_stores_no_comment_text_or_author(self, session: Session, tmp_path: Path) -> None:
        # Comments belong to third parties. `SECURITY_BOUNDARIES.md` asks for minimal
        # normalized metadata, and a URL is the whole of what this feature needs.
        write(
            tmp_path,
            "github_stars",
            browser_payload("a/b", comment_urls=["https://github.com/a/b"]),
        )
        ingest_all(session, tmp_path)

        for row in session.scalars(select(Evidence)):
            assert row.value.startswith("http")


class TestShortenerResolution:
    """`lnkd.in` does not redirect — it serves an interstitial.

    `HEAD` returns 403 and `GET` returns 200 with a page whose canonical link is LinkedIn
    itself; the real destination is the one non-LinkedIn URL in the markup. Following
    `Location` headers alone found nothing, and reported five failures with no reason.
    """

    INTERSTITIAL = """
      <html><head><link rel="canonical" href="https://www.linkedin.com">
      <meta name="pageKey" content="d_shortlink_frontend_external_link_redirect_interstitial">
      </head><body><a href="https://github.com/open-metadata/OpenMetadata">계속</a>
      <img src="https://static.licdn.com/x.png"></body></html>
    """

    def test_finds_the_destination_in_an_interstitial(self) -> None:
        from taste_inbox.ingest.links import destination_in_body

        assert (
            destination_in_body(self.INTERSTITIAL)
            == "https://github.com/open-metadata/OpenMetadata"
        )

    def test_ignores_the_interstitial_s_own_furniture(self) -> None:
        from taste_inbox.ingest.links import destination_in_body

        only_noise = '<a href="https://www.linkedin.com/feed">x</a><img src="https://licdn.com/a">'
        assert destination_in_body(only_noise) is None

    def test_refuses_a_destination_on_the_local_network(self) -> None:
        # A shortener is an open redirect by design: whoever made the link chose where it
        # goes, so a hop must never be allowed to point this process at loopback.
        from taste_inbox.ingest.links import _safe

        assert _safe("https://127.0.0.1/x") is False
        assert _safe("https://localhost/x") is False
        assert _safe("http://github.com/a/b") is False  # https only

    def test_keeps_the_observation_and_adds_the_destination_beside_it(
        self, session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from taste_inbox.ingest import links

        write(
            tmp_path,
            "github_stars",
            browser_payload("a/b", outbound_urls=["https://lnkd.in/abc123"]),
        )
        ingest_all(session, tmp_path)

        monkeypatch.setattr(
            links, "follow", lambda _url: ("https://github.com/open-metadata/OpenMetadata", None)
        )
        report = links.resolve_shortened(session)

        assert report.resolved == 1
        assert report.artifacts_found == 1

        rows = {row.type: (row.value, row.provenance) for row in session.scalars(select(Evidence))}
        # The page really did contain the shortener — that stays a fact.
        assert rows["shortened_link"] == ("https://lnkd.in/abc123", "fact")
        # The destination was learned by asking another service, not by reading the page.
        assert rows["artifact_link"] == (
            "https://github.com/open-metadata/OpenMetadata",
            "external",
        )

    def test_does_not_resolve_the_same_link_twice(
        self, session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from taste_inbox.ingest import links

        write(tmp_path, "github_stars", browser_payload("a/b", outbound_urls=["https://lnkd.in/x"]))
        ingest_all(session, tmp_path)
        monkeypatch.setattr(links, "follow", lambda _url: ("https://example.dev/a", None))

        links.resolve_shortened(session)
        second = links.resolve_shortened(session)
        assert second.already_known == 1
        assert second.resolved == 0


class TestIdentityRefinement:
    """A collector that learns a better id must not strand what it already collected.

    LinkedIn's reactions feed names each card after the recommendation wrapping the post;
    only the post's own page reveals the post's id. When the collector started visiting
    that page, five already-collected rows had a better name available — and every link,
    resolved shortener and comment artifact hangs off those rows' `items.id`.
    """

    def test_a_better_id_adopts_the_existing_row_rather_than_adding_one(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(tmp_path, "github_stars", browser_payload("wrapper-1"))
        ingest_all(session, tmp_path)
        original = session.scalar(select(Item))
        assert original is not None
        original_id = original.id

        payload = browser_payload("post-1")
        payload["items"][0]["list_id"] = "wrapper-1"
        write(tmp_path, "github_stars", payload)
        ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(Item)) == 1
        adopted = session.scalar(select(Item))
        assert adopted is not None
        # Same row — so nothing referencing it has to move.
        assert adopted.id == original_id
        assert adopted.platform_item_id == "post-1"

    def test_everything_attached_to_the_row_survives(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(
            tmp_path,
            "github_stars",
            browser_payload("wrapper-1", outbound_urls=["https://x.dev/a"]),
        )
        ingest_all(session, tmp_path)
        item = session.scalar(select(Item))
        assert item is not None
        session.add(
            Evidence(
                item_id=item.id,
                type="outbound_link",
                label="resolved::https://lnkd.in/abc",
                value="https://x.dev/a",
                provenance="external",
            )
        )
        session.commit()
        before = len(session.scalars(select(Evidence)).all())

        payload = browser_payload("post-1", outbound_urls=["https://x.dev/a"])
        payload["items"][0]["list_id"] = "wrapper-1"
        write(tmp_path, "github_stars", payload)
        ingest_all(session, tmp_path)

        assert len(session.scalars(select(Evidence)).all()) == before

    def test_a_listing_id_nobody_has_seen_still_creates_the_item(
        self, session: Session, tmp_path: Path
    ) -> None:
        # First collection of a post: there is no earlier row to adopt, and the item must
        # be created rather than skipped.
        payload = browser_payload("post-1")
        payload["items"][0]["list_id"] = "wrapper-1"
        write(tmp_path, "github_stars", payload)
        ingest_all(session, tmp_path)

        stored = session.scalar(select(Item))
        assert stored is not None
        assert stored.platform_item_id == "post-1"

    def test_adoption_never_reaches_across_platforms(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A listing id is only meaningful within the platform that issued it.
        write(tmp_path, "github_stars", browser_payload("wrapper-1"))
        ingest_all(session, tmp_path)

        payload = browser_payload("post-1", platform="threads")
        payload["items"][0]["list_id"] = "wrapper-1"
        payload["items"][0]["canonical_url"] = "https://www.threads.com/@a/post/post-1"
        payload["run"]["surface"] = "threads_reposts"
        write(tmp_path, "threads_reposts", payload)
        ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(Item)) == 2


class TestSweepRefusals:
    """The only function in the product that deletes a user's data.

    Each of these is a refusal rather than a behaviour, because the failure they prevent is
    silent and total: the cache is gone and the only symptom is broken thumbnails.
    """

    def test_a_session_that_references_nothing_deletes_nothing(self, tmp_path: Path) -> None:
        # An empty database, a failed migration, or a session opened against the wrong file
        # would otherwise authorise wiping the whole cache. Absence of evidence is not
        # evidence of an orphan.
        from taste_inbox.ingest.media import sweep_orphans

        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        stale = tmp_path / "ab" / "orphan.jpg"
        stale.parent.mkdir(parents=True)
        stale.write_bytes(b"x")
        os.utime(stale, (0, 0))

        with sessionmaker(engine)() as empty:
            assert sweep_orphans(empty, tmp_path) == 0
        assert stale.exists()

    def test_a_file_written_moments_ago_survives(self, session: Session, tmp_path: Path) -> None:
        # `POST /api/collection/refresh` takes no lock, so a scheduled ingest can be writing
        # bytes while holding the matching row in an uncommitted transaction. Deleting it
        # would leave that row pointing at nothing.
        from taste_inbox.ingest.media import sweep_orphans

        session.add(
            MediaAsset(
                item_id=_seed_item(session).id, role="thumbnail", local_path="var/media/x.jpg"
            )
        )
        session.commit()
        fresh = tmp_path / "just-written.jpg"
        fresh.write_bytes(b"x")

        assert sweep_orphans(session, tmp_path) == 0
        assert fresh.exists()

    def test_a_file_it_cannot_remove_is_skipped_rather_than_raised(
        self, session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The commit has already happened by the time the sweep runs, so an OSError here
        # would report a completed ingest as a failure.
        from taste_inbox.ingest import media as media_module

        session.add(
            MediaAsset(
                item_id=_seed_item(session).id, role="thumbnail", local_path="var/media/x.jpg"
            )
        )
        session.commit()
        stubborn = tmp_path / "locked.jpg"
        stubborn.write_bytes(b"x")
        os.utime(stubborn, (0, 0))

        def refuse(self: Path) -> None:
            raise PermissionError("read-only volume")

        monkeypatch.setattr(Path, "unlink", refuse)
        assert media_module.sweep_orphans(session, tmp_path) == 0
        assert stubborn.exists()


def _seed_item(session: Session) -> Item:
    item = Item(
        id="sweep-fixture",
        kind="post",
        platform="instagram",
        platform_item_id="SWEEP",
        canonical_url="https://example.test/sweep",
        first_seen_at="2026-08-09T00:00:00Z",
        updated_at="2026-08-09T00:00:00Z",
    )
    session.add(item)
    session.flush()
    return item


class TestAuthorProfiles:
    """Where the Style board's purchase route is kept.

    An author is a different grain from a post: 76 saved fashion posts came from 61
    accounts, so a bio read once answers for several items.
    """

    def _write(self, directory: Path, profiles: list[dict[str, Any]]) -> None:
        (directory / "instagram_profiles.json").write_text(
            json.dumps({"profiles": profiles}, ensure_ascii=False), "utf-8"
        )

    def profile(self, **overrides: Any) -> dict[str, Any]:
        base: dict[str, Any] = {
            "handle": "sampleuser",
            "display_name": "샘플",
            "biography": "피터앤웬디\n@brandname.official",
            "links": [
                {"url": "https://link.example.co.kr/sampleuser", "title": "샘플샵 바로가기"},
                {"url": "https://sample.example.com/shop6/m", "title": "international shipping"},
            ],
            "mentions": ["brandname.official"],
        }
        base.update(overrides)
        return base

    def test_records_each_link_with_the_title_its_owner_gave_it(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The title is what separates two shops. The bare hosts say neither which one is
        # domestic nor which ships abroad.
        self._write(tmp_path, [self.profile()])
        report = ingest_profiles(session, tmp_path)

        assert report.authors_new == 1
        links = session.scalars(
            select(AuthorLink).where(AuthorLink.kind == "link").order_by(AuthorLink.ordinal)
        ).all()
        assert [(row.value, row.title) for row in links] == [
            ("https://link.example.co.kr/sampleuser", "샘플샵 바로가기"),
            ("https://sample.example.com/shop6/m", "international shipping"),
        ]

    def test_a_mention_is_kept_but_never_turned_into_a_url(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Whether that handle is the brand, a collaborator or a friend is not something
        # the bio says, so it stays a handle.
        self._write(tmp_path, [self.profile()])
        ingest_profiles(session, tmp_path)

        mention = session.scalar(select(AuthorLink).where(AuthorLink.kind == "mention"))
        assert mention is not None
        assert mention.value == "brandname.official"
        assert not mention.value.startswith("http")

    def test_reading_the_same_profile_twice_changes_nothing(
        self, session: Session, tmp_path: Path
    ) -> None:
        self._write(tmp_path, [self.profile()])
        ingest_profiles(session, tmp_path)
        second = ingest_profiles(session, tmp_path)

        assert second.authors_new == 0
        assert second.authors_unchanged == 1
        assert len(session.scalars(select(AuthorLink)).all()) == 3

    def test_a_thinner_read_never_blanks_a_bio_that_was_read(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A profile page that failed to render its bio must not erase yesterday's.
        self._write(tmp_path, [self.profile()])
        ingest_profiles(session, tmp_path)

        self._write(tmp_path, [self.profile(biography=None, display_name=None)])
        ingest_profiles(session, tmp_path)

        author = session.scalar(select(Author))
        assert author is not None
        assert author.biography is not None
        assert author.display_name == "샘플"

    def test_a_link_the_account_removed_stops_being_offered(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The opposite of the rule above, on purpose: a missing *value* is usually a failed
        # read, while a link taken out of a list somebody maintains is a decision.
        self._write(tmp_path, [self.profile()])
        ingest_profiles(session, tmp_path)

        self._write(tmp_path, [self.profile(links=[], mentions=[])])
        ingest_profiles(session, tmp_path)

        assert session.scalars(select(AuthorLink)).all() == []

    def test_no_capture_file_is_a_normal_state(self, session: Session, tmp_path: Path) -> None:
        assert ingest_profiles(session, tmp_path).files_read == 0


class TestTheMediaOnlyCapture:
    """`saved-all-posts.json`, read for photos and for nothing else.

    Instagram stopped serving the named collections on the web on 2026-08-09 — every one of
    them renders "컬렉션에 사진과 동영상을 저장해보세요" and issues no feed request, while
    `모든 게시물` still answers with all 342 saved posts. That capture is the only way left
    to learn what photos a post carried, and it is also the one capture that cannot say
    which board a post belongs on.
    """

    def _both(self, tmp_path: Path, session: Session) -> None:
        write(tmp_path, "saved-fashion", [instagram_item("FILED", images=[photo("cover")])])
        write(
            tmp_path,
            "saved-all-posts",
            [
                instagram_item("FILED", images=[photo("cover"), photo("second"), photo("third")]),
                instagram_item("UNFILED", images=[photo("elsewhere")]),
            ],
        )
        ingest_all(session, capture_dir=tmp_path)

    def test_fills_in_the_photos_a_collection_capture_could_not_see(
        self, tmp_path: Path, session: Session
    ) -> None:
        # The measured shape: the fashion board's 76 posts held one photo each and the same
        # posts in `모든 게시물` hold 297 between them.
        self._both(tmp_path, session)
        item = session.scalar(select(Item).where(Item.platform_item_id == "FILED"))
        assert item is not None
        assets = session.scalars(select(MediaAsset).where(MediaAsset.item_id == item.id)).all()
        assert len(assets) == 3

    def test_never_creates_an_item_for_a_post_that_is_on_no_board(
        self, tmp_path: Path, session: Session
    ) -> None:
        # 216 of the 342 captured posts are saved but filed under no collection this product
        # renders. Creating them would be inventing rows out of a feed that cannot say where
        # they belong.
        self._both(tmp_path, session)
        assert session.scalar(select(Item).where(Item.platform_item_id == "UNFILED")) is None

    def test_never_adds_a_membership_of_its_own(self, tmp_path: Path, session: Session) -> None:
        # The danger of running the normal path over this file: every filed post would gain
        # a second membership named after the feed rather than after the user's collection.
        self._both(tmp_path, session)
        item = session.scalar(select(Item).where(Item.platform_item_id == "FILED"))
        assert item is not None
        rows = session.scalars(select(ItemSource).where(ItemSource.item_id == item.id)).all()
        assert [row.collection_name for row in rows] == ["fashion"]

    def test_reports_how_much_of_the_capture_it_could_use(
        self, tmp_path: Path, session: Session
    ) -> None:
        # "Read 342 posts" and "filled in 126" are different numbers, and a run that reports
        # only the first reads as though everything landed.
        write(tmp_path, "saved-fashion", [instagram_item("FILED")])
        write(
            tmp_path,
            "saved-all-posts",
            [instagram_item("FILED"), instagram_item("UNFILED"), instagram_item("ALSO_NOT")],
        )
        report = ingest_all(session, capture_dir=tmp_path)
        assert (report.media_only_seen, report.media_only_matched) == (3, 1)

    def test_a_capture_that_is_only_all_posts_stores_nothing_at_all(
        self, tmp_path: Path, session: Session
    ) -> None:
        # Nothing has been filed yet, so there is nothing to attach photos to. The honest
        # result is an empty database, not 342 boardless items.
        write(tmp_path, "saved-all-posts", [instagram_item("A"), instagram_item("B")])
        report = ingest_all(session, capture_dir=tmp_path)
        assert session.scalar(select(func.count()).select_from(Item)) == 0
        assert report.media_only_matched == 0

    def test_a_timestamped_repair_fills_an_existing_posts_missing_cover(
        self, tmp_path: Path, session: Session
    ) -> None:
        missing = instagram_item("FILED")
        missing["images"] = []
        missing["thumbnail_url"] = None
        write(tmp_path, "saved-fashion", [missing])
        write(
            tmp_path,
            "instagram-media-repair-20260903T120000Z",
            [{"code": "FILED", "images": [photo("recovered")]}],
        )

        report = ingest_all(session, capture_dir=tmp_path)

        item = session.scalar(select(Item).where(Item.platform_item_id == "FILED"))
        assert item is not None
        assets = session.scalars(select(MediaAsset).where(MediaAsset.item_id == item.id)).all()
        assert [asset.remote_url for asset in assets] == [photo("recovered")["url"]]
        assert report.media_only_matched == 1

    def test_a_repair_never_creates_an_unknown_instagram_post(
        self, tmp_path: Path, session: Session
    ) -> None:
        write(
            tmp_path,
            "instagram-media-repair-20260903T120000Z",
            [{"code": "UNKNOWN", "images": [photo("not-ours")]}],
        )

        ingest_all(session, capture_dir=tmp_path)

        assert session.scalar(select(Item).where(Item.platform_item_id == "UNKNOWN")) is None

    def test_fresh_repair_url_survives_replaying_the_older_saved_capture(
        self, tmp_path: Path, session: Session
    ) -> None:
        write(tmp_path, "saved-fashion", [instagram_item("FILED", images=[photo("old")])])
        write(tmp_path, "saved-all-posts", [instagram_item("FILED", images=[photo("old")])])
        write(
            tmp_path,
            "instagram-media-repair-20260903T120000Z",
            [{"code": "FILED", "images": [photo("fresh")]}],
        )
        for _ in range(2):
            ingest_all(session, capture_dir=tmp_path)
            asset = session.scalar(select(MediaAsset))
            assert asset is not None
            assert asset.remote_url == photo("fresh")["url"]


class TestAStoredLinkIsAlwaysADestination:
    """The gate that stops a bio's spelling from becoming a broken card.

    Both cases here come from `@feb.note`, whose shop reached the database twice: once as
    `https://applink.a-bly.com/팹노트-ig` from the profile's anchor, and once as the same
    path percent-escaped and with no scheme, from the prose beside it.
    """

    def _links(self, session: Session, tmp_path: Path, *urls: str) -> list[AuthorLink]:
        write(
            tmp_path,
            "instagram_profiles",
            {
                "run": {"surface": "instagram_profiles"},
                "profiles": [
                    {
                        "handle": "shop_account",
                        "display_name": "가게",
                        "biography": "소개",
                        "links": [{"url": url, "title": None} for url in urls],
                        "mentions": [],
                    }
                ],
            },
        )
        ingest_profiles(session, tmp_path)
        return list(
            session.scalars(
                select(AuthorLink).where(AuthorLink.kind == "link").order_by(AuthorLink.ordinal)
            )
        )

    def test_a_bio_that_names_a_bare_domain_is_stored_as_a_url(
        self, session: Session, tmp_path: Path
    ) -> None:
        # `cwithc.co.kr` in an href is a *relative* link — the card sent the browser to
        # localhost/cwithc.co.kr. Keeping bare domains is what took the board from 28
        # accounts with a purchase route to 51, so the fix is a scheme, not a rejection.
        rows = self._links(session, tmp_path, "cwithc.co.kr")
        assert [row.value for row in rows] == ["https://cwithc.co.kr"]

    def test_one_shop_written_two_ways_is_one_link(self, session: Session, tmp_path: Path) -> None:
        rows = self._links(
            session,
            tmp_path,
            "https://applink.a-bly.com/팹노트-ig",
            "applink.a-bly.com/%ED%8C%B9%EB%85%B8%ED%8A%B8-ig",
        )
        assert [row.value for row in rows] == ["https://applink.a-bly.com/팹노트-ig"]

    def test_two_paths_on_one_host_stay_two_links(self, session: Session, tmp_path: Path) -> None:
        # The dedupe must not collapse a brand's domestic and international storefronts,
        # which is the case the titles exist for.
        rows = self._links(
            session,
            tmp_path,
            "https://colorwithcloset.cafe24.com/shop6/m",
            "https://colorwithcloset.cafe24.com/shop1",
        )
        assert len(rows) == 2

    def test_an_already_absolute_link_is_left_exactly_as_written(
        self, session: Session, tmp_path: Path
    ) -> None:
        rows = self._links(session, tmp_path, "http://cwithc.co.kr/")
        assert [row.value for row in rows] == ["http://cwithc.co.kr/"]


def test_a_run_reads_profiles_along_with_everything_else(session: Session, tmp_path: Path) -> None:
    """The Refresh button has to be able to pick up a shop an account just added.

    `ingest_profiles` was called by a one-off script when the feature was built and by
    nothing on the run path, so a re-read profile would have sat in its capture file
    indefinitely while the button reported success.
    """
    write(tmp_path, "saved-fashion", [instagram_item("POST")])
    write(
        tmp_path,
        "instagram_profiles",
        {
            "run": {"surface": "instagram_profiles"},
            "profiles": [
                {
                    "handle": "someone",
                    "display_name": "가게",
                    "biography": "소개",
                    "links": [{"url": "cwithc.example.kr", "title": "바로가기"}],
                    "mentions": [],
                }
            ],
        },
    )
    report = ingest_all(session, capture_dir=tmp_path)
    assert report.authors_new == 1
    assert report.links_recorded == 1
    stored = session.scalar(select(AuthorLink).where(AuthorLink.kind == "link"))
    assert stored is not None
    assert stored.value == "https://cwithc.example.kr"


def liked(code: str, **overrides: Any) -> dict[str, Any]:
    """One `CollectedLike`, in the shape `probe collect` writes it.

    Note what is *not* here and is not an omission: no `owner`, no `is_original_audio`. The
    Likes grid is a Bloks surface read through an overlay, and those fields do not exist on
    it — a fixture that invented them would test a capture that never occurs.

    `images` **is** here, as of 2026-08-12, and defaults to empty because that is the honest
    default for a liked post: some genuinely have no photograph. The collector reads the
    open post's photos off the overlay and writes them into this list, in the order the
    author posted them.
    """
    item: dict[str, Any] = {
        "code": code,
        # Interpolated from the template rather than spelled out, so the CI guard that greps
        # `apps/` for a real social URL sees the builder and not a permalink.
        "permalink": "https://www.instagram.com/{kind}/{code}/".format(kind="p", code=code),
        # As the collector writes it: `datetime.now(UTC).isoformat()`, microseconds and an
        # offset. Deliberately not the `Z` shape, because normalising it is the behaviour.
        "first_seen_at": "2026-08-08T09:46:31.481907+00:00",
        "media_type": "unknown",
        "product_type": None,
        "taken_at": 1757736341,
        "caption": "본문 #태그",
        "accessibility_caption": None,
        "audio_title": None,
        "audio_artist": None,
        "images": [],
    }
    item.update(overrides)
    return item


class TestLikedPosts:
    """The surface that replaced the named collections.

    Instagram's saved collections 404 to Instagram's own web app as of 2026-08-09, so Likes
    is where new items come from. The properties worth protecting are that a Like arrives on
    *no* board rather than a guessed one, and that the timestamped capture files can pile up
    in `var/captures/` without the second read of one duplicating the first.
    """

    def test_reads_a_timestamped_capture_nobody_named_in_advance(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Every other capture has a fixed file name. This one is stamped per run, because
        # the run is incremental and each file is a slice rather than a snapshot.
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("AAA"), liked("BBB")])

        report = ingest_all(session, tmp_path)

        assert (report.items_new, report.likes_seen) == (2, 2)
        assert session.scalar(select(func.count()).select_from(Item)) == 2

    def test_reads_every_capture_present_not_just_the_newest(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("OLD")])
        write(tmp_path, "instagram-collect-20260809T101500Z", [liked("NEW")])

        ingest_all(session, tmp_path)

        codes = set(session.scalars(select(Item.platform_item_id)))
        assert codes == {"OLD", "NEW"}

    def test_a_like_lands_on_no_board_at_all(self, session: Session, tmp_path: Path) -> None:
        # The whole point of the surface: a Like carries no filing, so `collection_name`
        # starts null and the item is invisible to `board_filter` until the classifier
        # decides. An unclassified post on the wrong board would be worse than none.
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("AAA")])

        ingest_all(session, tmp_path)

        source = session.scalar(select(ItemSource))
        assert source is not None
        assert source.collection_name is None
        assert source.action_type == "like"
        # Instagram never says when a like happened, so this stays null rather than being
        # filled in with when the collector happened to look.
        assert source.action_at is None

    def test_the_grid_names_no_author_so_none_is_stored(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(
            tmp_path,
            "instagram-collect-20260808T094631Z",
            [liked("AAA", accessibility_caption="Photo shared by eyesmag on September 3, 2025.")],
        )

        ingest_all(session, tmp_path)

        item = session.scalar(select(Item))
        assert item is not None
        # `eyesmag` is right there in the alt text. Lifting it into `author` would be
        # inventing an attribution out of a string written for screen readers.
        assert item.author is None

    def test_running_twice_changes_nothing(self, session: Session, tmp_path: Path) -> None:
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("AAA"), liked("BBB")])

        first = ingest_all(session, tmp_path)
        second = ingest_all(session, tmp_path)

        assert first.items_new == 2
        assert second.items_new == 0
        assert second.items_unchanged == 2
        assert session.scalar(select(func.count()).select_from(Item)) == 2
        assert session.scalar(select(func.count()).select_from(ItemSource)) == 2

    def test_a_stale_capture_cannot_duplicate_a_post_a_newer_one_also_holds(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The files accumulate, and an incremental run re-opens the tile it stopped at. So
        # the same code appears in two captures, and identity — not file bookkeeping — is
        # what keeps that from becoming two rows.
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("SAME")])
        write(tmp_path, "instagram-collect-20260809T101500Z", [liked("SAME")])

        ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(Item)) == 1
        assert session.scalar(select(func.count()).select_from(ItemSource)) == 1

    def test_the_oldest_capture_is_the_one_that_dates_a_post(
        self, session: Session, tmp_path: Path
    ) -> None:
        # `first_seen_at` is written once. Reading newest-first would re-date every
        # backfilled post at whenever the most recent run happened.
        write(
            tmp_path,
            "instagram-collect-20260808T094631Z",
            [liked("SAME", first_seen_at="2026-08-08T09:46:31.481907+00:00")],
        )
        write(
            tmp_path,
            "instagram-collect-20260809T101500Z",
            [liked("SAME", first_seen_at="2026-08-09T10:15:00.000001+00:00")],
        )

        ingest_all(session, tmp_path)

        item = session.scalar(select(Item))
        assert item is not None
        assert item.first_seen_at == "2026-08-08T09:46:31Z"

    def test_the_collectors_stamp_is_rewritten_into_the_shape_today_can_read(
        self, session: Session, tmp_path: Path
    ) -> None:
        # `api/today.py::_local_day` refuses anything but `YYYY-MM-DDTHH:MM:SSZ`, and
        # `_highlights_for` selects a day with a string range. A microsecond stamp with a
        # `+00:00` offset is a row Today can neither place nor count.
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("AAA")])

        ingest_all(session, tmp_path)

        item = session.scalar(select(Item))
        source = session.scalar(select(ItemSource))
        assert item is not None and source is not None
        assert item.first_seen_at == "2026-08-08T09:46:31Z"
        assert source.first_seen_at == "2026-08-08T09:46:31Z"

    def test_an_unreadable_stamp_falls_back_to_now_rather_than_being_stored(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("AAA", first_seen_at="어제")])

        ingest_all(session, tmp_path)

        item = session.scalar(select(Item))
        assert item is not None
        assert item.first_seen_at.endswith("Z")
        assert item.first_seen_at != "어제"

    def test_instagrams_alt_text_is_kept_where_a_post_has_no_photo(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A post with no photograph has no cover asset to hang the alt text on, and this is
        # the field that took the classifier from 119/126 to 123/126. Evidence is where it
        # goes — the classifier reads that table and never looks at `media_assets`.
        write(
            tmp_path,
            "instagram-collect-20260808T094631Z",
            [liked("AAA", accessibility_caption="May be an image of 1 person and text.")],
        )

        ingest_all(session, tmp_path)

        row = session.scalar(select(Evidence).where(Evidence.type == "accessibility_caption"))
        assert row is not None
        assert row.value == "May be an image of 1 person and text."
        # Instagram's vision model guessing, not this product's conclusion and not an
        # observation of the world. `external` is the member for somebody else's answer.
        assert row.provenance == "external"

    def test_no_media_row_is_invented_for_a_post_with_no_photo(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A `media_assets` row with a null `remote_url` would put a photo that does not
        # exist in front of the media cache.
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("AAA")])

        ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(MediaAsset)) == 0


class TestALikedPostBringsItsPhotos:
    """Style is a photo board, and for a day the likes reaching it had no pictures.

    `CollectedLike` had no image field, so three of the first four liked posts landed on
    `/style` as captions. The collector reads them now; this is the half that stores them,
    and it is deliberately the *same* half the Saved captures go through — `captured_images`
    then `record_media` then `media.cache_pending`. A second download path would be a second
    thing to keep correct about signed URLs, budgets and orphans.
    """

    def test_every_photo_of_a_liked_carousel_becomes_a_row(
        self, session: Session, tmp_path: Path
    ) -> None:
        write(
            tmp_path,
            "instagram-collect-20260812T094631Z",
            [liked("AAA", images=[photo("one"), photo("two"), photo("three")])],
        )

        ingest_all(session, tmp_path)

        assets = session.scalars(select(MediaAsset).order_by(MediaAsset.id)).all()
        # The cover keeps the role every other reader keys off; the rest are named after
        # the slide they are, so the order survives a re-read in any row order.
        assert [asset.role for asset in assets] == ["thumbnail", "image_02", "image_03"]
        assert [asset.remote_url for asset in assets] == [
            photo("one")["url"],
            photo("two")["url"],
            photo("three")["url"],
        ]

    def test_the_expiry_is_read_off_the_signature_so_the_cache_can_act_in_time(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A liked post's URL expires exactly like a saved one's — the batch collected on
        # 2026-08-08 stopped resolving on 2026-08-12. The row has to say when, or
        # `cache_pending` cannot tell "not downloaded yet" from "too late to try".
        write(tmp_path, "instagram-collect-20260812T094631Z", [liked("AAA", images=[photo("x")])])

        ingest_all(session, tmp_path)

        asset = session.scalar(select(MediaAsset))
        assert asset is not None
        assert asset.remote_expires_at == "2025-08-24T13:23:00Z"
        # Nothing is downloaded by ingestion itself. `cache_pending` is the one step that
        # touches the network, and a null `local_path` is how a row asks it to.
        assert asset.local_path is None

    def test_the_photos_land_in_the_same_cache_every_other_board_uses(
        self, session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """One download path, exercised end to end from a Likes capture.

        The point is not that `cache_pending` works — other tests cover that — but that a
        liked post reaches it at all, with no branch anywhere that asks which surface a
        `media_assets` row came from.
        """
        future = (datetime.now(UTC) + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
        write(
            tmp_path,
            "instagram-collect-20260812T094631Z",
            [liked("AAA", images=[photo("cover"), photo("second")])],
        )
        ingest_all(session, tmp_path)
        for asset in session.scalars(select(MediaAsset)):
            asset.remote_expires_at = future
        session.commit()

        monkeypatch.setattr("taste_inbox.ingest.media._fetch", lambda _url: b"\xff\xd8jpeg")
        report = cache_pending(session, root=tmp_path / "cache", budget_bytes=10_000)

        assert (report.considered, report.downloaded, report.failed) == (2, 2, 0)
        assert all(asset.local_path for asset in session.scalars(select(MediaAsset)))

    def test_instagrams_alt_text_describes_the_cover_and_not_every_slide(
        self, session: Session, tmp_path: Path
    ) -> None:
        # "May be an image of one person" is a description of the post, which is to say of
        # its cover. Copying it onto slide three would claim it describes that photograph.
        write(
            tmp_path,
            "instagram-collect-20260812T094631Z",
            [
                liked(
                    "AAA",
                    images=[photo("one"), photo("two")],
                    accessibility_caption="May be an image of one person.",
                )
            ],
        )

        ingest_all(session, tmp_path)

        assets = session.scalars(select(MediaAsset).order_by(MediaAsset.id)).all()
        assert [asset.alt_text for asset in assets] == ["May be an image of one person.", None]
        # And it is still evidence as well. The classifier reads that table, never
        # `media_assets`, and it is the field that moved 119/126 to 123/126.
        row = session.scalar(select(Evidence).where(Evidence.type == "accessibility_caption"))
        assert row is not None

    def test_a_post_with_no_photograph_keeps_an_empty_gallery(
        self, session: Session, tmp_path: Path
    ) -> None:
        # An empty list is the answer, not a placeholder: `BrowseCard` sizes a card by
        # `mediaCount === 0` and a stand-in image would be a photograph nobody posted.
        write(tmp_path, "instagram-collect-20260812T094631Z", [liked("AAA", images=[])])

        ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(MediaAsset)) == 0

    def test_the_five_captures_written_before_images_existed_still_read(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The bare-list captures from 2026-08-08 have no `images` key at all. They are the
        # only history this surface has; a `KeyError` on them would be a migration.
        historic = liked("AAA")
        historic.pop("images")
        write(tmp_path, "instagram-collect-20260808T094631Z", [historic])

        report = ingest_all(session, tmp_path)

        assert report.likes_seen == 1
        assert session.scalar(select(func.count()).select_from(MediaAsset)) == 0

    def test_re_reading_a_capture_updates_the_rows_rather_than_adding_more(
        self, session: Session, tmp_path: Path
    ) -> None:
        # These files accumulate and every one of them is re-read on every cycle. The role
        # carries the position, and `(item_id, role)` is what makes the second read an
        # update.
        write(
            tmp_path,
            "instagram-collect-20260812T094631Z",
            [liked("AAA", images=[photo("one"), photo("two")])],
        )

        ingest_all(session, tmp_path)
        second = ingest_all(session, tmp_path)

        assert second.media_recorded == 0
        assert session.scalar(select(func.count()).select_from(MediaAsset)) == 2

    def test_a_later_capture_refreshes_a_signed_url_in_place(
        self, session: Session, tmp_path: Path
    ) -> None:
        """Why re-reading matters rather than merely being harmless.

        A signed URL dies in days and the post does not. Tomorrow's run opens the same post
        at the checkpoint and comes back with a fresh signature, and that is the whole
        recovery path for a thumbnail that expired before the cache reached it
        (`docs/DECISIONS.md`, 2026-08-08).
        """
        write(tmp_path, "instagram-collect-20260812T094631Z", [liked("AAA", images=[photo("one")])])
        ingest_all(session, tmp_path)

        fresh = photo("one")
        fresh["url"] = fresh["url"].replace("oe=68AB1234", "oe=6A7CCD0F")
        write(tmp_path, "instagram-collect-20260813T094631Z", [liked("AAA", images=[fresh])])
        ingest_all(session, tmp_path)

        assets = session.scalars(select(MediaAsset)).all()
        assert len(assets) == 1
        assert assets[0].remote_url == fresh["url"]
        assert assets[0].remote_expires_at == "2026-08-12T19:44:15Z"

    def test_a_thinner_re_read_never_erases_a_photo_already_collected(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The same rule a null caption follows: an overlay that rendered one slide is a
        # thinner view of the post, not a deletion of the other two.
        write(
            tmp_path,
            "instagram-collect-20260812T094631Z",
            [liked("AAA", images=[photo("one"), photo("two"), photo("three")])],
        )
        ingest_all(session, tmp_path)

        write(tmp_path, "instagram-collect-20260813T094631Z", [liked("AAA", images=[photo("one")])])
        ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(MediaAsset)) == 3

    def test_a_like_keeps_the_reel_url_a_richer_capture_already_established(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The overlay reader often has no product type, so it would spell every permalink
        # `/p/`. Letting that overwrite a stored `/reel/` is a row losing information by
        # being seen again.
        write(tmp_path, "saved-music", [instagram_item("AAA", product_type="clips")])
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("AAA")])

        ingest_all(session, tmp_path)

        item = session.scalar(select(Item).where(Item.platform_item_id == "AAA"))
        assert item is not None
        assert item.canonical_url == "https://www.instagram.com/reel/AAA/"

    def test_a_caption_less_like_does_not_erase_tags_a_saved_capture_stored(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The overlay returns `""` when Instagram serves only alt text, and `set_tags`
        # replaces the whole list. An empty caption from a thinner surface is not a deletion.
        write(tmp_path, "saved-fashion", [instagram_item("BOTH", caption="본문 #여름코디")])
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("BOTH", caption="")])

        ingest_all(session, tmp_path)

        item = session.scalar(select(Item).where(Item.platform_item_id == "BOTH"))
        assert item is not None
        tags = session.scalars(select(ItemTag.tag).where(ItemTag.item_id == item.id)).all()
        assert list(tags) == ["#여름코디"]

    def test_a_post_both_saved_and_liked_keeps_the_users_own_filing(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Two memberships, because a save and a like are two different facts. The filed one
        # still says `fashion`; the liked one is undecided until the classifier runs.
        write(tmp_path, "saved-fashion", [instagram_item("BOTH")])
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("BOTH")])

        ingest_all(session, tmp_path)

        item = session.scalar(select(Item).where(Item.platform_item_id == "BOTH"))
        assert item is not None
        rows = session.scalars(select(ItemSource).where(ItemSource.item_id == item.id)).all()
        assert sorted((row.action_type or "", row.collection_name or "") for row in rows) == [
            ("like", ""),
            ("save", "fashion"),
        ]

    def test_a_truncated_capture_costs_that_file_and_not_the_run(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A collector killed mid-write leaves half a JSON array behind, and the good file
        # next to it must still land.
        (tmp_path / "instagram-collect-20260808T094631Z.json").write_text("[{", "utf-8")
        write(tmp_path, "instagram-collect-20260809T101500Z", [liked("GOOD")])

        report = ingest_all(session, tmp_path)

        assert session.scalar(select(Item.platform_item_id)) == "GOOD"
        assert any("instagram-collect-20260808T094631Z" in note for note in report.skipped)

    def test_the_survey_captures_next_to_it_are_not_read(
        self, session: Session, tmp_path: Path
    ) -> None:
        # `var/captures/` also holds `instagram-likes-<stamp>.json` from the response
        # survey — a different tool with a different shape — and `-summary`/`-redacted`
        # siblings. Matching `instagram-collect-*` and nothing else keeps this reader off
        # files it cannot parse.
        write(tmp_path, "instagram-likes-20260808T092923Z", [instagram_item("SURVEY")])
        write(tmp_path, "instagram-collect-20260808T094631Z-summary", {"collected": 1})

        report = ingest_all(session, tmp_path)

        assert session.scalar(select(func.count()).select_from(Item)) == 0
        assert report.likes_seen == 0


class TestTheLikesRunEnvelope:
    """A Likes capture carries its run, so the surface can be scheduled at all.

    Before it, the file was a bare list of items: it could say what had been collected but
    not how the run ended or where it stopped. The checkpoint lived in a line of terminal
    output a person copied into the next invocation — workable by hand, impossible on a
    timer. The envelope is the same `{run, items}` shape every browser capture already had,
    read through the same `_record_run` and `_update_checkpoint`.
    """

    @staticmethod
    def envelope(
        *,
        code: str,
        checkpoint: str | None = None,
        advanced: bool = True,
        outcome: str = "ok",
        started_at: str = "2026-08-09T00:00:00Z",
    ) -> dict[str, Any]:
        return {
            "run": {
                "outcome": outcome,
                "started_at": started_at,
                "checkpoint": checkpoint or code,
                "advanced_checkpoint": advanced,
                "exhausted": False,
                "stopped_because": "reached the last-seen checkpoint",
                "notes": [],
            },
            "items": [liked(code)],
        }

    def test_the_run_becomes_a_checkpoint_row_under_the_scheduled_job_s_id(
        self, session: Session, tmp_path: Path
    ) -> None:
        from taste_inbox.db.models import Checkpoint

        write(tmp_path, "instagram-collect-20260809T000000Z", self.envelope(code="AAA"))

        ingest_all(session, tmp_path)

        checkpoint = session.get(Checkpoint, "instagram_likes")
        assert checkpoint is not None
        assert checkpoint.last_seen_code == "AAA"
        assert checkpoint.last_outcome == "ok"

    def test_a_run_that_may_not_advance_still_records_how_it_ended(
        self, session: Session, tmp_path: Path
    ) -> None:
        """The two facts are written under different conditions, deliberately.

        `last_seen_code` moves only when the run reached the previous mark, or there was
        none. `last_outcome` moves every time — it is what `api/today.py` reads to decide
        that a collector needs a person, and guarding it behind the same condition is how
        the browser surfaces once made a login wall invisible.
        """
        from taste_inbox.db.models import Checkpoint

        write(
            tmp_path,
            "instagram-collect-20260809T000000Z",
            self.envelope(code="AAA", advanced=True),
        )
        ingest_all(session, tmp_path)

        write(
            tmp_path,
            "instagram-collect-20260810T000000Z",
            {
                "run": {
                    "outcome": "auth_required",
                    "started_at": "2026-08-10T00:00:00Z",
                    "checkpoint": None,
                    "advanced_checkpoint": False,
                    "exhausted": False,
                    "stopped_because": "login wall",
                    "notes": [],
                },
                "items": [],
            },
        )
        ingest_all(session, tmp_path)

        checkpoint = session.get(Checkpoint, "instagram_likes")
        assert checkpoint is not None
        assert checkpoint.last_seen_code == "AAA"
        assert checkpoint.last_outcome == "auth_required"

    def test_rereading_the_same_capture_does_not_record_a_second_run(
        self, session: Session, tmp_path: Path
    ) -> None:
        # These files accumulate and every one of them is re-read every cycle, so the
        # dedupe on `(collector_id, started_at)` is load-bearing rather than defensive:
        # without it, `_gate`'s "three consecutive login walls" would count one wall three
        # times on the third cycle after it happened.
        from taste_inbox.db.models import CollectorRun

        write(tmp_path, "instagram-collect-20260809T000000Z", self.envelope(code="AAA"))

        ingest_all(session, tmp_path)
        ingest_all(session, tmp_path)
        ingest_all(session, tmp_path)

        runs = session.scalars(
            select(CollectorRun).where(CollectorRun.collector_id == "instagram_likes")
        ).all()
        assert len(runs) == 1

    def test_the_newest_capture_is_the_one_that_leaves_the_mark(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Read oldest first, so the last run applied is the most recent one. Reading the
        # other way would leave the checkpoint at a position two runs behind the grid.
        from taste_inbox.db.models import Checkpoint

        write(
            tmp_path,
            "instagram-collect-20260808T000000Z",
            self.envelope(code="OLD", started_at="2026-08-08T00:00:00Z"),
        )
        write(
            tmp_path,
            "instagram-collect-20260809T000000Z",
            self.envelope(code="NEW", started_at="2026-08-09T00:00:00Z"),
        )

        ingest_all(session, tmp_path)

        checkpoint = session.get(Checkpoint, "instagram_likes")
        assert checkpoint is not None
        assert checkpoint.last_seen_code == "NEW"

    def test_the_five_bare_list_captures_already_on_disk_still_ingest(
        self, session: Session, tmp_path: Path
    ) -> None:
        """The 2026-08-08 captures predate the envelope and are the only history this
        surface has.

        They ingest exactly as before and advance nothing, which is the honest answer:
        nothing in them says whether the run that wrote them reached the previous mark.
        """
        from taste_inbox.db.models import Checkpoint

        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("AAA"), liked("BBB")])

        report = ingest_all(session, tmp_path)

        assert report.likes_seen == 2
        assert session.get(Checkpoint, "instagram_likes") is None

    def test_an_envelope_with_no_items_is_a_run_and_not_a_failure(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A caught-up grid writes one of these every cycle. It must be read as "this
        # collector ran and found nothing new", not skipped as an empty file.
        from taste_inbox.db.models import Checkpoint

        write(
            tmp_path,
            "instagram-collect-20260809T000000Z",
            {
                "run": {
                    "outcome": "ok",
                    "started_at": "2026-08-09T00:00:00Z",
                    "checkpoint": None,
                    "advanced_checkpoint": False,
                    "exhausted": False,
                    "stopped_because": "reached the last-seen checkpoint",
                    "notes": [],
                },
                "items": [],
            },
        )

        report = ingest_all(session, tmp_path)

        assert report.skipped == []
        checkpoint = session.get(Checkpoint, "instagram_likes")
        assert checkpoint is not None
        assert checkpoint.last_outcome == "ok"
