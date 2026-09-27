"""The local service, exercised against a database built from real capture shapes.

The property that matters most is that the JSON matches the zod schemas the frontend
validates against. When it does not, the frontend refuses the whole board — which is the
designed behaviour, and which is exactly how the first three missing fields were found.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from importlib import import_module
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from taste_inbox.api.app import app, get_session
from taste_inbox.db.models import Base, MediaAsset
from taste_inbox.distribution import distribution_profile
from taste_inbox.ingest import ingest_all

#: Every field the shared zod schemas require. Copied from
#: `packages/shared/src/domain/{ai,style,music}.ts` — a name that drifts here is a board
#: that stops rendering, so the list is asserted rather than trusted.
AI_FIELDS = {
    "id",
    "kind",
    "title",
    "source",
    "summary",
    "checkedAt",
    "tags",
    "links",
    "preview",
}
STYLE_FIELDS = {
    "id",
    "source",
    "author",
    "media",
    "descriptor",
    "caption",
    "checkedAt",
    "tags",
    "links",
}
MUSIC_FIELDS = {
    "id",
    "source",
    "collectionName",
    "caption",
    "media",
    "candidates",
    "coverText",
    "coverCheckedAt",
    "links",
    "handledAt",
}
SOURCE_FIELDS = {"platform", "label", "originalUrl", "author", "actionType", "firstSeenAt"}
PERSONAL_WORKSPACE_ONLY = pytest.mark.skipif(
    distribution_profile().edition == "community",
    reason="the community edition intentionally has no browser collection schedule",
)


def instagram(code: str, *, caption: str, audio: tuple[str, str] | None = None) -> dict[str, Any]:
    return {
        "code": code,
        "media_type": "video",
        "product_type": "clips",
        "taken_at": 1757736341,
        "owner": "sample_owner",
        "caption": caption,
        "accessibility_caption": None,
        "audio_title": audio[1] if audio else None,
        "audio_artist": audio[0] if audio else None,
        "is_original_audio": True,
        "product_tag_count": 0,
        "user_tag_count": 0,
        "source_endpoint": "/api/v1/feed/",
        "thumbnail_url": "https://scontent.cdninstagram.com/v/t51/x.jpg?oe=6A7CCD0F",
        "thumbnail_width": 640,
        "thumbnail_height": 1136,
    }


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    # One shared connection for the whole test. The default in-memory pool hands each
    # thread its own empty database, and `TestClient` runs the app on another thread — so
    # the tables created here were invisible to every request.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)

    captures = tmp_path / "captures"
    captures.mkdir()
    (captures / "saved-ai.json").write_text(
        json.dumps([instagram("AI1", caption="바이브코딩 하는 법 #클로드코드")]), "utf-8"
    )
    (captures / "saved-fashion.json").write_text(
        json.dumps([instagram("ST1", caption="이렇게 입고 카페에 #여름코디")]), "utf-8"
    )
    (captures / "saved-music.json").write_text(
        json.dumps(
            [
                instagram("MU1", caption="Ella Mai - Trying", audio=("Ella Mai", "Trying")),
                instagram("MU2", caption="친구들 앞에서 틀어보세요"),
                instagram("MU3", caption="다른 곡", audio=("Unrelated Band", "Some Track")),
            ]
        ),
        "utf-8",
    )

    with factory() as session:
        ingest_all(session, captures)

    # FastAPI's own seam, rather than reaching into a module global: the app keeps its
    # production wiring and only the session is swapped for this test.
    def session_override() -> Iterator[Session]:
        with factory() as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


class TestContract:
    def test_every_response_is_wrapped_in_data(self, client: TestClient) -> None:
        for path in (
            "/api/health",
            "/api/trends/items",
            "/api/style/items",
            "/api/music/items",
            "/api/places/items",
        ):
            assert "data" in client.get(path).json()

    def test_a_missing_item_is_a_typed_error_not_a_crash(self, client: TestClient) -> None:
        response = client.get("/api/items/nope")
        assert response.status_code == 404
        error = response.json()["error"]
        assert error["code"] == "item_not_found"
        assert error["recoverable"] is False

    def test_ai_cards_carry_every_field_the_frontend_validates(self, client: TestClient) -> None:
        card = client.get("/api/trends/items").json()["data"]["items"][0]
        assert set(card) == AI_FIELDS
        assert set(card["source"]) == SOURCE_FIELDS

    def test_style_cards_carry_every_field(self, client: TestClient) -> None:
        card = client.get("/api/style/items").json()["data"]["items"][0]
        assert set(card) == STYLE_FIELDS

    def test_music_cards_carry_every_field(self, client: TestClient) -> None:
        card = client.get("/api/music/items").json()["data"]["items"][0]
        assert set(card) == MUSIC_FIELDS

    def test_a_page_says_where_its_items_came_from(self, client: TestClient) -> None:
        page = client.get("/api/style/items").json()["data"]
        assert page["origin"] == "collected"
        assert page["nextCursor"] is None


class TestRemovedFieldsLeaveNoFilters:
    def test_a_stale_filter_does_not_answer_with_a_crash(self, client: TestClient) -> None:
        """`?status=` used to 500.

        `AIItemCardModel` lost `status` when the sandbox runner was removed on 2026-08-09,
        and the endpoint's filter went on reading `card["status"]`. Nothing in the frontend
        had sent it since that day, so the only way to reach it was by hand — a stale
        bookmark, or someone trying the API. `unknownFilterValues` exists precisely so an
        old link opens the board instead of breaking it; a 500 is the opposite of that.
        """
        response = client.get("/api/trends/items?status=ready_local")

        assert response.status_code == 200
        assert response.json()["data"]["items"], "an unknown filter narrows nothing"


class TestHonesty:
    def test_nothing_is_reported_as_checked(self, client: TestClient) -> None:
        for path in ("/api/trends/items", "/api/style/items"):
            for card in client.get(path).json()["data"]["items"]:
                assert card["checkedAt"] is None

    def test_a_style_card_claims_no_product(self, client: TestClient) -> None:
        card = client.get("/api/style/items").json()["data"]["items"][0]
        assert "brand" not in card

    def test_an_ai_card_makes_no_claim_about_running_anything(self, client: TestClient) -> None:
        # The sandbox runner is gone, so a field that promised an answer would be a lie
        # rather than a placeholder (docs/DECISIONS.md, 2026-08-09).
        card = client.get("/api/trends/items").json()["data"]["items"][0]
        for gone in (
            "status",
            "compatibility",
            "peakMemoryGb",
            "diskGb",
            "supportsArm64",
            "requiresCuda",
            "requiredSecrets",
            "whyItMatters",
        ):
            assert gone not in card

    def test_an_ai_card_carries_the_post_whole(self, client: TestClient) -> None:
        # It used to be cut at 400 characters here; the card clamps and can un-clamp.
        card = client.get("/api/trends/items").json()["data"]["items"][0]
        assert card["summary"]

    def test_an_instagram_save_is_a_post(self, client: TestClient) -> None:
        assert client.get("/api/trends/items").json()["data"]["items"][0]["kind"] == "post"

    def test_the_account_that_posted_it_is_named(self, client: TestClient) -> None:
        card = client.get("/api/style/items").json()["data"]["items"][0]
        assert card["source"]["author"] == "sample_owner"


class TestMusicGrading:
    def test_a_track_the_caption_confirms_is_exact(self, client: TestClient) -> None:
        cards = {c["id"]: c for c in client.get("/api/music/items").json()["data"]["items"]}
        confirmed = next(c for c in cards.values() if c["caption"].startswith("Ella Mai"))
        assert confirmed["candidates"][0]["matchGrade"] == "exact"
        assert "youtube" in confirmed["candidates"][0]["searchUrl"]

    def test_attribution_alone_stays_likely(self, client: TestClient) -> None:
        # Background music on a Reel that never mentions it is not a recommendation.
        cards = client.get("/api/music/items").json()["data"]["items"]
        unconfirmed = next(c for c in cards if c["caption"] == "다른 곡")
        assert unconfirmed["candidates"][0]["matchGrade"] == "likely"

    def test_no_attribution_means_no_candidate(self, client: TestClient) -> None:
        cards = client.get("/api/music/items").json()["data"]["items"]
        bare = next(c for c in cards if c["caption"].startswith("친구들"))
        assert bare["candidates"] == []


class TestFilters:
    def test_filters_on_the_same_vocabulary_the_url_uses(self, client: TestClient) -> None:
        # The Style board's only axis is where the item came from. `match` and `stock`
        # filtered a resolved product and went with the resolver (docs/DECISIONS.md).
        assert client.get("/api/style/items?source=instagram").json()["data"]["items"] != []
        assert client.get("/api/style/items?source=github").json()["data"]["items"] == []

    def test_the_music_board_takes_the_same_source_filter(self, client: TestClient) -> None:
        # `/music` never offers this — every saved Reel is Instagram, so the facet cannot
        # narrow that board. `/library` is why it exists: the merged board applies one
        # `?source=` across all three lists, and a parameter accepted here and ignored would
        # answer `?source=github` with Instagram Reels.
        assert client.get("/api/music/items?source=instagram").json()["data"]["items"] != []
        assert client.get("/api/music/items?source=github").json()["data"]["items"] == []

    def test_the_music_source_filter_composes_with_the_inbox_default(
        self, client: TestClient
    ) -> None:
        # Two independent narrowings, not one replacing the other: the board is an inbox
        # first, and `?source=` narrows whatever the inbox is currently showing.
        inbox = client.get("/api/music/items?source=instagram").json()["data"]["items"]
        archive = client.get("/api/music/items?handled=shown&source=instagram").json()["data"][
            "items"
        ]
        assert all(card["handledAt"] is None for card in inbox)
        assert len(archive) >= len(inbox)

    def test_the_day_filter_reads_the_local_calendar_day(self, client: TestClient) -> None:
        """`?day=` is the rail's calendar, and it filters on the *Seoul* day.

        `first_seen_at` is stamped in UTC and the app reasons nine hours ahead of it, so
        for nine hours out of every twenty-four the two spell different dates. This asserts
        the endpoint agrees with `_local_day` — the same function `/api/today` groups its
        per-day history with — rather than with the string prefix, which is the comparison
        that looks right until someone saves something before nine in the morning.
        """
        from zoneinfo import ZoneInfo

        from taste_inbox.api.today import _local_day

        cards = client.get("/api/style/items").json()["data"]["items"]
        stamp = cards[0]["source"]["firstSeenAt"]
        local = _local_day(stamp, ZoneInfo("Asia/Seoul"))
        assert local is not None

        same_day = client.get(f"/api/style/items?day={local}").json()["data"]["items"]
        assert [card["id"] for card in same_day] == [card["id"] for card in cards]
        assert client.get("/api/style/items?day=2000-01-01").json()["data"]["items"] == []

        # The rule itself, on a fixed instant rather than on whatever the clock said when
        # these rows were ingested: 15:30 UTC is half past midnight the next day in Seoul.
        assert _local_day("2026-08-08T15:30:00Z", ZoneInfo("Asia/Seoul")) == "2026-08-09"
        assert _local_day("2026-08-08T14:59:59Z", ZoneInfo("Asia/Seoul")) == "2026-08-08"

        # And when the two spellings differ for these rows, the UTC one matches nothing.
        if stamp[:10] != local:
            assert client.get(f"/api/style/items?day={stamp[:10]}").json()["data"]["items"] == []

    def test_every_board_takes_the_day_filter(self, client: TestClient) -> None:
        # `/library` applies one `?day=` across every list. A board that accepted the
        # parameter and ignored it would answer a day-filtered link with every day it has —
        # the failure docs/DECISIONS.md (2026-08-08) calls worse than not offering it.
        for board in ("trends", "style", "music", "places"):
            response = client.get(f"/api/{board}/items?day=1999-12-31")
            assert response.status_code == 200
            assert response.json()["data"]["items"] == []

    def test_the_day_filter_composes_with_the_music_inbox_default(self, client: TestClient) -> None:
        from zoneinfo import ZoneInfo

        from taste_inbox.api.today import _local_day

        cards = client.get("/api/music/items").json()["data"]["items"]
        local = _local_day(cards[0]["source"]["firstSeenAt"], ZoneInfo("Asia/Seoul"))
        narrowed = client.get(f"/api/music/items?day={local}").json()["data"]["items"]
        assert [card["id"] for card in narrowed] == [card["id"] for card in cards]
        assert all(card["handledAt"] is None for card in narrowed)

    def test_a_malformed_day_matches_nothing_rather_than_raising(self, client: TestClient) -> None:
        # A stale bookmark must still open the board. The frontend drops the value at the
        # parser and says which one it dropped; the service simply matches nothing.
        response = client.get("/api/style/items?day=yesterday")
        assert response.status_code == 200
        assert response.json()["data"]["items"] == []

    def test_an_unknown_filter_value_matches_nothing_rather_than_raising(
        self, client: TestClient
    ) -> None:
        # A stale bookmark must still open the board.
        response = client.get("/api/style/items?source=in-sta")
        assert response.status_code == 200
        assert response.json()["data"]["items"] == []

    def test_a_retired_filter_is_ignored_rather_than_raising(self, client: TestClient) -> None:
        # `?match=exact` is in bookmarks and in the old docs. FastAPI drops an undeclared
        # query parameter, so the board opens showing everything — which is the honest
        # answer now that nothing grades a match.
        response = client.get("/api/style/items?match=exact&stock=available")
        assert response.status_code == 200
        assert response.json()["data"]["items"] != []


class TestBoardsAndSources:
    def test_each_board_sees_only_its_own_collection(self, client: TestClient) -> None:
        counts = client.get("/api/health").json()["data"]["boards"]
        # `none` sits beside the four and is never one of them. Zero here because these
        # fixtures are Saved captures, which carry the user's own filing — nothing has been
        # declined by anybody.
        assert counts == {"trends": 1, "style": 1, "music": 3, "places": 0, "none": 0}

    def test_jobs_is_an_empty_list_not_a_rejection(self, client: TestClient) -> None:
        # Rejecting took down every page in the workspace: the shell asks for this on each
        # render, so an unimplemented endpoint became an unrelated screen's failure.
        response = client.get("/api/jobs")
        assert response.status_code == 200
        assert response.json()["data"]["jobs"] == []


def _file_a_place(client: TestClient, *, code: str = "PL1") -> str:
    """Put one collected post onto the places board, the only way anything ever will.

    A row in `item_sources` with `collection_name = "places"` — no new table, no new column,
    no new `kind`. This is exactly what the classifier will write in a later phase, and
    writing it by hand here is what proves the board works before that phase exists.
    """
    from taste_inbox.db.models import Item, ItemSource, SourceAccount

    session = next(iter(app.dependency_overrides[get_session]()))
    account = session.scalar(select(SourceAccount))
    assert account is not None
    stamp = "2026-08-08T07:00:00Z"
    item = Item(
        id=f"ig-{code}",
        # `post`, which the `items` CHECK already allows. A place is not a new kind of
        # thing — it is a saved Instagram post that happens to be about a restaurant.
        kind="post",
        platform="instagram",
        platform_item_id=code,
        canonical_url=f"https://www.instagram.com/p/{code}/",
        title=None,
        body_text="성수동 이 카페 진짜 좋았어요 #카페추천",
        author="sample_owner",
        first_seen_at=stamp,
        updated_at=stamp,
    )
    session.add(item)
    session.add(
        ItemSource(
            item_id=item.id,
            source_account_id=account.id,
            action_type="save",
            collection_name="places",
            position=0,
            first_seen_at=stamp,
        )
    )
    session.commit()
    return item.id


class TestPlacesBoard:
    """The fourth board — saved restaurants, cafés and travel spots.

    It is empty in this fixture for the same reason it is empty in the product: nothing
    writes `collection_name = "places"` yet, and no platform routes there by rule. So most
    of these tests file one row by hand and check that the board built for it actually
    works, rather than waiting for the classifier to exist before anything is verified.
    """

    def test_is_empty_and_says_so_rather_than_404ing(self, client: TestClient) -> None:
        response = client.get("/api/places/items")
        assert response.status_code == 200
        assert response.json()["data"]["items"] == []

    def test_no_platform_routes_to_it_by_rule(self, client: TestClient) -> None:
        # A GitHub star is never a restaurant. `PLATFORM_BOARDS` deliberately names no
        # target for this board, so membership is the only way onto it — which is what
        # keeps a starred repository from turning up under Places.
        from taste_inbox.api.cards import PLATFORM_BOARDS

        assert "places" not in PLATFORM_BOARDS.values()

    def test_a_filed_post_appears_on_it(self, client: TestClient) -> None:
        item_id = _file_a_place(client)
        items = client.get("/api/places/items").json()["data"]["items"]
        assert [card["id"] for card in items] == [item_id]

    def test_a_filed_post_appears_on_no_other_board(self, client: TestClient) -> None:
        # The rule the whole design rests on: one membership, one board. If `board_filter`
        # ever widened, this is where a place would start showing up under Trends.
        item_id = _file_a_place(client)
        for board in ("trends", "style", "music"):
            cards = client.get(f"/api/{board}/items").json()["data"]["items"]
            assert item_id not in [card["id"] for card in cards]

    def test_it_serves_the_trends_card_model(self, client: TestClient) -> None:
        """The card decision, asserted rather than left to a comment.

        A saved place is a post: a caption, a photo and its links. `to_ai_card` already
        describes exactly that, so this board reuses it — and the fields a "place card"
        would appear to want (a rating, an address, a map) are absent because nothing here
        collects them. If a fourth model is ever added, this test is what has to be
        rewritten deliberately.
        """
        _file_a_place(client)
        card = client.get("/api/places/items").json()["data"]["items"][0]
        assert set(card) == AI_FIELDS
        assert card["kind"] == "post"

    def test_the_board_count_moves_with_it(self, client: TestClient) -> None:
        assert client.get("/api/health").json()["data"]["boards"]["places"] == 0
        _file_a_place(client)
        assert client.get("/api/health").json()["data"]["boards"]["places"] == 1

    def test_the_detail_page_agrees_about_which_board_it_is_on(self, client: TestClient) -> None:
        # `board_of` asks the same rules the boards use. A detail page that denied the board
        # an item is visibly on is the disagreement that rule exists to prevent.
        item_id = _file_a_place(client)
        payload = client.get(f"/api/items/{item_id}").json()["data"]
        assert payload["board"] == "places"
        # Not "Instagram Saved · Places": no collection on Instagram is called that, and
        # naming one would invent a collection the user never made.
        assert payload["source"]["label"] == "Places"

    def test_it_takes_the_source_filter_library_applies(self, client: TestClient) -> None:
        # Never rendered on `/places` — one source cannot narrow a one-source board — but
        # `/library` applies one `?source=` across every list, and a parameter accepted and
        # ignored here would answer `?source=github` with Instagram posts.
        _file_a_place(client)
        assert client.get("/api/places/items?source=instagram").json()["data"]["items"] != []
        assert client.get("/api/places/items?source=github").json()["data"]["items"] == []

    def test_today_counts_it_as_its_own_board(self, client: TestClient) -> None:
        # Not folded into the anonymous `기타` remainder the Saved card computes. A board
        # present in the meter and named nowhere is the bug `musicCount` was added to fix.
        summary = client.get("/api/today").json()["data"]["savedSummary"]
        assert "placesCount" in summary
        assert summary["placesCount"] == 0


class TestManualRefresh:
    """The button in the UI. It used to download the whole media backlog inside the POST.

    `cache_pending` has always accepted a limit and this endpoint passed none, so with a
    20 s socket timeout per asset the worst case for the collected 126 thumbnails was a
    42-minute request. Both halves are asserted here: the batch is bounded, and the
    response says how many are still waiting so the screen can offer the button again
    instead of implying the cache is complete.
    """

    def test_bounds_the_media_batch_and_reports_what_is_still_pending(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from taste_inbox import ingest as ingest_module
        from taste_inbox.api.app import REFRESH_MEDIA_BATCH
        from taste_inbox.ingest.captures import IngestReport
        from taste_inbox.ingest.media import MediaReport

        asked_for: dict[str, int | None] = {}

        def no_downloads(_session: Session, **kwargs: Any) -> MediaReport:
            asked_for["limit"] = kwargs.get("limit")
            return MediaReport()

        # Stubbed rather than run: the real call reads the machine's capture directory and
        # would fetch from the CDN, which no test is allowed to do.
        monkeypatch.setattr(ingest_module, "ingest_all", lambda _session: IngestReport())
        monkeypatch.setattr(ingest_module, "cache_pending", no_downloads)

        data = client.post("/api/collection/refresh").json()["data"]

        assert asked_for["limit"] == REFRESH_MEDIA_BATCH
        # Five saved Reels, none of them on disk yet.
        assert data["mediaPending"] == 5


@pytest.fixture
def cached_asset(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> int:
    """One asset whose bytes are really on disk, with the cache root moved under tmp_path.

    The handler resolves `local_path` against `REPO_ROOT` and refuses anything outside
    `var/media`, so the root is redirected rather than the containment check bypassed —
    otherwise every test below would be exercising the 404 branch.
    """
    # By name, because the package re-exports the FastAPI instance as `taste_inbox.api.app`
    # and the attribute of that name is therefore not the module.
    module = import_module("taste_inbox.api.app")

    root = tmp_path / "var" / "media" / "ab"
    root.mkdir(parents=True)
    path = root / "thumb.jpg"
    path.write_bytes(b"\xff\xd8\xff\xd9")
    monkeypatch.setattr(module, "REPO_ROOT", tmp_path)

    session: Session = next(app.dependency_overrides[get_session]())
    asset = session.scalar(select(MediaAsset).order_by(MediaAsset.id))
    assert asset is not None
    asset.local_path = str(path.relative_to(tmp_path))
    asset.checksum = "a" * 64
    session.commit()
    return asset.id


class TestMedia:
    def test_an_uncached_asset_is_a_recoverable_error(self, client: TestClient) -> None:
        response = client.get("/api/media/1")
        assert response.status_code == 404
        assert response.json()["error"]["recoverable"] is True

    def test_a_missing_asset_id_does_not_leak_a_path(self, client: TestClient) -> None:
        body = client.get("/api/media/99999").text
        assert "/Users/" not in body
        assert "var/media" not in body

    def test_a_client_that_already_has_the_bytes_is_told_so(
        self, client: TestClient, cached_asset: int
    ) -> None:
        # There was no conditional path at all: `If-None-Match` with the right etag came
        # back 200 with the whole body, measured at 207,876 bytes for one thumbnail, on
        # every board render.
        first = client.get(f"/api/media/{cached_asset}")
        assert first.status_code == 200

        again = client.get(
            f"/api/media/{cached_asset}", headers={"If-None-Match": first.headers["etag"]}
        )
        assert again.status_code == 304
        assert again.content == b""

    def test_a_weakened_etag_is_the_same_validator(
        self, client: TestClient, cached_asset: int
    ) -> None:
        # A cache is allowed to weaken a tag it stores, so `W/"x"` has to match `"x"`.
        etag = client.get(f"/api/media/{cached_asset}").headers["etag"]
        response = client.get(f"/api/media/{cached_asset}", headers={"If-None-Match": f"W/{etag}"})
        assert response.status_code == 304

    def test_a_stale_etag_still_gets_the_file(self, client: TestClient, cached_asset: int) -> None:
        response = client.get(f"/api/media/{cached_asset}", headers={"If-None-Match": '"old"'})
        assert response.status_code == 200
        assert response.content == b"\xff\xd8\xff\xd9"

    def test_never_tells_the_browser_the_bytes_are_immutable(
        self, client: TestClient, cached_asset: int
    ) -> None:
        # `asset_id` is an integer rowid, and re-collection points the same rowid at
        # different bytes — the orphan sweep in `ingest/media.py` exists because of it.
        # `immutable` would keep a stale thumbnail through a reload.
        cache_control = client.get(f"/api/media/{cached_asset}").headers["cache-control"]
        assert cache_control.startswith("private")
        assert "must-revalidate" in cache_control
        assert "immutable" not in cache_control


class TestToday:
    """Half of this payload describes work that does not exist yet.

    Those parts come back empty rather than filled with plausible activity — the screen
    already has designed states for empty, and a fabricated working queue would be the
    product inventing its own progress.
    """

    def test_counts_only_what_the_database_knows(self, client: TestClient) -> None:
        data = client.get("/api/today").json()["data"]
        assert data["counts"]["newItems"] == 5
        # Nothing can be acted on until an enricher or a runner exists.
        assert data["counts"]["readyActions"] == 0

    def test_a_day_of_stars_and_reposts_still_has_highlights(self, client: TestClient) -> None:
        """A heading that announces a count must have something under it.

        `previousDays` renders its heading from `itemCount` and its cards from `highlights`,
        so the two disagreeing leaves a labelled empty space on the screen. It did: the
        highlight query mapped `item_sources.collection_name` through `BOARD_COLLECTIONS`,
        and GitHub, Threads and LinkedIn items are filed into no collection *by design* —
        they are routed to Trends by rule with `collection_name` left NULL. Every one of
        them was dropped, so a day of nothing but stars and reposts showed 어제 over nothing.
        """
        from datetime import UTC, datetime, timedelta

        from taste_inbox.db.models import Item, ItemSource, SourceAccount

        yesterday = (datetime.now(UTC) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        session = next(iter(app.dependency_overrides[get_session]()))
        account = session.scalar(select(SourceAccount))
        assert account is not None
        item = Item(
            id="gh-yesterday",
            kind="repo",
            platform="github",
            platform_item_id="owner/repo",
            canonical_url="https://github.com/owner/repo",
            title="owner/repo",
            first_seen_at=yesterday,
            updated_at=yesterday,
        )
        session.add(item)
        session.add(
            # `collection_name=None` is the point: this is what a star actually looks like.
            ItemSource(
                item_id=item.id,
                source_account_id=account.id,
                action_type="star",
                collection_name=None,
                first_seen_at=yesterday,
            )
        )
        session.commit()

        days = client.get("/api/today").json()["data"]["previousDays"]
        row = next(day for day in days if day["label"] == "어제")
        assert row["itemCount"] == 1
        assert len(row["highlights"]) == 1, "a counted day with no highlights is a blank section"
        assert row["highlights"][0]["domain"] == "trends"

    def test_the_saved_split_adds_up_to_the_headline(self, client: TestClient) -> None:
        """The chips are parts of `newItemCount`, and the card does that arithmetic.

        `SavedItemsSummaryCard` computes `기타 = newItemCount - ai - style - music - places`
        and draws a meter from the parts, so these are a division of today rather than board
        totals. Serving whole-board counts put `10 새 항목` over `AI 41` and `Style 76`, with
        `Math.max(0, …)` clamping the impossible remainder to zero so the card looked right.

        The frontend asserted this invariant — against its own fixture, which honoured it.
        Nothing asked the service, which did not.
        """
        summary = client.get("/api/today").json()["data"]["savedSummary"]
        parts = (
            summary["aiCount"]
            + summary["styleCount"]
            + summary["musicCount"]
            + summary["placesCount"]
        )
        assert parts <= summary["newItemCount"], (
            f"the split ({parts}) cannot exceed the total it divides ({summary['newItemCount']})"
        )

    def test_the_saved_split_counts_today_and_not_the_whole_board(self, client: TestClient) -> None:
        """An item from an earlier day must not inflate today's chip.

        Every fixture item is stamped on one day, so "today's count" and "the board's count"
        are the same number there — which is why the first version of this test passed with
        the bug still in place. The distinguishing case has to be built.
        """
        from datetime import UTC, datetime, timedelta

        from taste_inbox.db.models import Item, ItemSource, SourceAccount

        before = client.get("/api/today").json()["data"]["savedSummary"]["styleCount"]

        old = (datetime.now(UTC) - timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        session = next(iter(app.dependency_overrides[get_session]()))
        account = session.scalar(select(SourceAccount))
        assert account is not None
        item = Item(
            id="style-last-week",
            kind="post",
            platform="instagram",
            platform_item_id="OLD1",
            canonical_url="https://www.instagram.com/reel/OLD1/",
            first_seen_at=old,
            updated_at=old,
        )
        session.add(item)
        session.add(
            ItemSource(
                item_id=item.id,
                source_account_id=account.id,
                action_type="save",
                collection_name="fashion",
                first_seen_at=old,
            )
        )
        session.commit()

        data = client.get("/api/today").json()["data"]
        assert len(client.get("/api/style/items").json()["data"]["items"]) == before + 1, (
            "the board grew, so the boards and the chip now have different answers to give"
        )
        assert data["savedSummary"]["styleCount"] == before, (
            "a five-day-old save is not one of today's new items"
        )
        parts = (
            data["savedSummary"]["aiCount"]
            + data["savedSummary"]["styleCount"]
            + data["savedSummary"]["musicCount"]
            + data["savedSummary"]["placesCount"]
        )
        assert parts <= data["counts"]["newItems"]

    def test_the_saved_card_links_to_the_day_it_counted(self, client: TestClient) -> None:
        # The card is headed "N 새 항목" over today's number, so a link answering with the
        # whole board contradicts the figure the person just clicked.
        data = client.get("/api/today").json()["data"]
        assert data["savedSummary"]["href"] == f"/library?day={data['date']}"

    def test_saved_previews_are_real_items_from_today_in_newest_order(
        self, client: TestClient
    ) -> None:
        """The overview must not pin an old asset beside a count of today's arrivals."""
        from datetime import UTC, datetime, timedelta
        from zoneinfo import ZoneInfo

        from taste_inbox.db.models import Item

        session = next(iter(app.dependency_overrides[get_session]()))
        assets = list(session.scalars(select(MediaAsset).order_by(MediaAsset.id)))
        assert len(assets) >= 5
        local_noon = datetime.now(ZoneInfo("Asia/Seoul")).replace(
            hour=12, minute=0, second=0, microsecond=0
        )

        for index, asset in enumerate(assets[:4]):
            item = session.get(Item, asset.item_id)
            assert item is not None
            item.first_seen_at = (
                (local_noon + timedelta(minutes=index))
                .astimezone(UTC)
                .isoformat(timespec="seconds")
                .replace("+00:00", "Z")
            )
            asset.local_path = f"var/media/{asset.id}.jpg"

        old_asset = assets[4]
        old_item = session.get(Item, old_asset.item_id)
        assert old_item is not None
        old_item.first_seen_at = (
            (local_noon - timedelta(days=1))
            .astimezone(UTC)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        )
        old_asset.local_path = f"var/media/{old_asset.id}.jpg"
        session.commit()

        summary = client.get("/api/today").json()["data"]["savedSummary"]
        expected = [f"saved-preview-{asset.id}" for asset in reversed(assets[1:4])]
        assert [preview["id"] for preview in summary["previews"]] == expected
        assert summary["preview"] == summary["previews"][0], "legacy field mirrors the newest"
        assert f"saved-preview-{old_asset.id}" not in expected

    def test_the_saved_card_counts_the_same_board_the_board_does(self, client: TestClient) -> None:
        # `aiCount` used to count only items filed into the Instagram `ai` collection, so it
        # read 9 while `/api/trends/items` served 31. One rule, asked in one place.
        data = client.get("/api/today").json()["data"]
        trends = client.get("/api/trends/items").json()["data"]["items"]
        style = client.get("/api/style/items").json()["data"]["items"]
        assert data["savedSummary"]["aiCount"] == len(trends)
        assert data["savedSummary"]["styleCount"] == len(style)

    def test_invents_no_connection_and_no_queue(self, client: TestClient) -> None:
        data = client.get("/api/today").json()["data"]
        assert data["leadConnection"] is None
        assert data["relatedConnections"] == []
        assert data["workingQueue"] == []
        assert data["suggestedQueries"] == []

    def test_summarises_the_boards_from_rows(self, client: TestClient) -> None:
        summary = client.get("/api/today").json()["data"]["savedSummary"]
        assert summary["aiCount"] == 1
        assert summary["styleCount"] == 1
        assert summary["sources"] == ["instagram"]

    def test_reports_per_source_collection_state(self, client: TestClient) -> None:
        sources = client.get("/api/today").json()["data"]["sourceStatusSummary"]["sources"]
        assert [row["platform"] for row in sources] == ["instagram"]
        assert sources[0]["collectedCount"] == 5

    def test_greets_by_the_hour_rather_than_at_random(self) -> None:
        from datetime import UTC, datetime

        from taste_inbox.api.today import _greeting

        assert _greeting(datetime(2026, 8, 8, 9, tzinfo=UTC)) == "좋은 아침이에요"
        assert _greeting(datetime(2026, 8, 8, 14, tzinfo=UTC)) == "좋은 오후예요"
        assert _greeting(datetime(2026, 8, 8, 22, tzinfo=UTC)) == "오늘 하루 어땠나요"

    def test_today_starts_at_local_midnight_not_utc_midnight(self) -> None:
        """ "오늘" is the 24 hours from 밤 12시 in the configured timezone.

        Seoul is UTC+9, so 2026-08-09T15:00:00Z *is* local midnight. Counting the UTC date
        prefix put everything saved between 00:00 and 09:00 KST on the previous day — the
        early-morning likes this product exists to catch were the ones it mislabelled.

        A fresh database rather than the shared fixture: those five items are stamped with
        the real clock, and whether they land in this window depends on when the suite runs.
        """
        from datetime import UTC, datetime

        from taste_inbox.api.today import build_today
        from taste_inbox.db.models import Item

        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(engine)

        with Session(engine) as session:
            for name, stamp in (
                ("before", "2026-08-09T14:59:59Z"),  # 23:59:59 KST, still yesterday
                ("after", "2026-08-09T15:00:01Z"),  # 00:00:01 KST, today
            ):
                session.add(
                    Item(
                        id=f"boundary-{name}",
                        kind="post",
                        platform="instagram",
                        platform_item_id=f"BOUNDARY{name}",
                        canonical_url=f"https://www.instagram.com/reel/BOUNDARY{name}/",
                        first_seen_at=stamp,
                        updated_at=stamp,
                    )
                )
            session.commit()

            # 01:00 KST on the 10th — one hour into the window.
            payload = build_today(session, now=datetime(2026, 8, 9, 16, 0, tzinfo=UTC))

        assert payload["date"] == "2026-08-10"
        assert payload["counts"]["newItems"] == 1
        # The other one is not lost, only yesterday's.
        assert [row["date"] for row in payload["previousDays"]] == ["2026-08-09"]

    def test_a_blocked_collector_is_the_one_thing_that_asks_for_a_person(
        self, client: TestClient
    ) -> None:
        from taste_inbox.api.app import get_session
        from taste_inbox.db.models import Checkpoint

        override = client.app.dependency_overrides[get_session]  # type: ignore[attr-defined]
        session = next(override())
        session.add(
            Checkpoint(
                collector_id="instagram_saved_ai",
                last_outcome="blocked",
                updated_at="2026-08-08T00:00:00Z",
            )
        )
        session.commit()

        assert client.get("/api/today").json()["data"]["counts"]["attention"] == 1


class TestCollectorStatus:
    """`GET /api/system/collectors` — the only place a stopped collector explains itself.

    It used to iterate `checkpoints`, which is a position a *successful* run leaves
    behind. A collector whose first run was blocked had no such row, so the endpoint
    answered as though that collector did not exist — the one state worth reporting was
    the one state it could not report.
    """

    def _ingest_run(self, directory: Path, run: dict[str, Any]) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "github_stars.json").write_text(
            json.dumps({"run": run, "items": []}, ensure_ascii=False), "utf-8"
        )
        ingest_all(next(app.dependency_overrides[get_session]()), directory)

    def _blocked_run(self) -> dict[str, Any]:
        return {
            "surface": "github_stars",
            "outcome": "blocked",
            "started_at": "2026-08-09T12:00:00Z",
            "scroll_passes": 2,
            "exhausted": False,
            "checkpoint": None,
            "advanced_checkpoint": False,
            "stopped_because": "로그인 화면이 떠서 멈췄어요",
            "notes": ["challenge detected on pass 2"],
        }

    def _github(self, client: TestClient) -> dict[str, Any]:
        rows = client.get("/api/system/collectors").json()["data"]["collectors"]
        return next(row for row in rows if row["collectorId"] == "github_stars")

    def test_a_collector_whose_only_run_was_blocked_still_appears(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        self._ingest_run(tmp_path / "blocked", self._blocked_run())

        row = self._github(client)
        assert row["lastOutcome"] == "blocked"
        # Nothing was collected, so the next run must still start from the top.
        assert row["lastSeenCode"] is None
        assert row["lastRun"]["advancedCheckpoint"] is False

    def test_reports_the_notes_the_run_wrote(self, client: TestClient, tmp_path: Path) -> None:
        # `collector_runs.notes` has been written since ingestion existed and read by
        # nothing, so a stopped run could only ever explain itself in one line.
        self._ingest_run(tmp_path / "blocked-notes", self._blocked_run())

        assert self._github(client)["lastRun"]["notes"] == ["challenge detected on pass 2"]

    def test_a_run_with_no_checkpoint_behind_it_is_still_a_collector(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        # `collector_runs` is what this endpoint enumerates and the checkpoint is only a
        # position a run left behind, so the join has to survive the checkpoint being
        # absent: clearing one to force a full re-collection must not delete the collector
        # from the screen that would show the re-collection failing.
        from taste_inbox.db.models import Checkpoint

        self._ingest_run(tmp_path / "no-checkpoint", self._blocked_run())
        session: Session = next(app.dependency_overrides[get_session]())
        checkpoint = session.get(Checkpoint, "github_stars")
        assert checkpoint is not None
        session.delete(checkpoint)
        session.commit()

        row = self._github(client)
        assert row["lastOutcome"] is None
        assert row["lastRun"]["outcome"] == "blocked"

    def test_a_collector_with_no_run_at_all_is_not_invented(self, client: TestClient) -> None:
        # Instagram Saved has items but no browser run on record. Listing it with a null
        # outcome would claim a collection attempt nobody made.
        rows = client.get("/api/system/collectors").json()["data"]["collectors"]
        assert rows == []


class TestSchedule:
    """`GET /api/collection/schedule` — an interval, not a time of day.

    The 20:00 run assumed likes arrive during the day. They do not: one left at 02:00 sat
    unseen until the evening, which is the eighteen-hour wait this endpoint now bounds at
    four hours.
    """

    def test_the_interval_reaches_the_payload(self, client: TestClient) -> None:
        data = client.get("/api/collection/schedule").json()["data"]

        assert data["intervalHours"] == 4
        assert data["dailySlots"] == ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"]
        # The stagger outlived the clock time it used to offset: two sources opening the
        # same account minute is still the thing it prevents.
        assert data["staggerMinutes"] == 3
        assert data["allowManualRefresh"] is True
        assert "dailyTime" not in data

    @PERSONAL_WORKSPACE_ONLY
    def test_still_answers_when_each_source_runs_next(self) -> None:
        # The UI reads this to say "다음 수집". An interval has to answer it as plainly as a
        # clock time did.
        from datetime import UTC, datetime

        from taste_inbox.api.schedule import describe

        # 11:30 in Seoul: past the 08:00 slot, before the 12:00 one.
        payload = describe(now=datetime(2026, 8, 9, 2, 30, tzinfo=UTC))
        first, second = payload["sources"][0], payload["sources"][1]

        assert first["runsAt"] == "12:00"
        assert first["nextRunAt"].startswith("2026-08-09T12:00:00")
        assert second["runsAt"] == "12:03"

    @PERSONAL_WORKSPACE_ONLY
    def test_after_the_days_last_slot_the_cycle_restarts_at_midnight(self) -> None:
        from datetime import UTC, datetime

        from taste_inbox.api.schedule import describe

        # 21:00 in Seoul, past the 20:00 slot.
        payload = describe(now=datetime(2026, 8, 9, 12, 0, tzinfo=UTC))

        assert payload["sources"][0]["nextRunAt"].startswith("2026-08-10T00:00:00")

    def test_the_schema_bounds_the_stagger_by_the_sources_that_exist(self) -> None:
        # `config/schema.py` refuses a stagger that outruns the interval, and it counts the
        # sources by a number because config validation must not import this module. If a
        # seventh collector is added, that number is what silently stops being true.
        from taste_inbox.api.schedule import SOURCE_ORDER
        from taste_inbox.config.schema import STAGGERED_SOURCES

        assert len(SOURCE_ORDER) == STAGGERED_SOURCES


@PERSONAL_WORKSPACE_ONLY
class TestLaunchd:
    """The scheduled jobs. Written, never installed.

    Loading a job that opens four logged-in accounts on a timer has consequences for those
    accounts, so the product produces the plists and the commands and stops there
    (CLAUDE.md §10).
    """

    def test_writes_one_job_per_source_offset_from_a_single_interval(self, tmp_path: Path) -> None:
        from taste_inbox.api.launchd import generate

        jobs = generate(tmp_path)
        # Seven since `instagram_likes` joined `SOURCE_ORDER` on 2026-08-12.
        assert [job.runs_at for job in jobs] == [
            "4시간마다",
            "4시간마다 (+3분)",
            "4시간마다 (+6분)",
            "4시간마다 (+9분)",
            "4시간마다 (+12분)",
            "4시간마다 (+15분)",
            "4시간마다 (+18분)",
        ]
        assert all(job.path.exists() for job in jobs)

    def test_the_plist_carries_an_interval_in_seconds(self, tmp_path: Path) -> None:
        # `StartCalendarInterval` is a clock time and cannot express "every four hours";
        # `StartInterval` is seconds, counted from when the job is loaded.
        import plistlib

        from taste_inbox.api.launchd import generate

        for job in generate(tmp_path):
            parsed = plistlib.loads(job.path.read_bytes())
            assert parsed["StartInterval"] == 4 * 3600
            assert "StartCalendarInterval" not in parsed

    def test_the_stagger_is_the_wait_between_installs(self, tmp_path: Path) -> None:
        """launchd has no "first run at T+3분, then every four hours".

        The interval starts counting when the job is loaded, so the only thing that
        separates two collectors is how far apart a person loads them — which is why the
        printed block interleaves `sleep 180` and why the docstring calls it approximate.
        """
        from taste_inbox.api.launchd import generate, install_commands
        from taste_inbox.api.schedule import SOURCE_ORDER

        lines = install_commands(generate(tmp_path))
        bootstraps = [line for line in lines if line.startswith("launchctl bootstrap")]
        sleeps = [line for line in lines if line.startswith("sleep ")]

        assert len(bootstraps) == len(SOURCE_ORDER)
        # One gap per job after the first, three minutes each.
        assert len(sleeps) == len(SOURCE_ORDER) - 1
        assert all(line.startswith("sleep 180") for line in sleeps)
        # The first job is loaded immediately; nothing waits before it.
        assert lines.index(bootstraps[0]) < lines.index(sleeps[0])

    def test_every_plist_is_valid(self, tmp_path: Path) -> None:
        import plistlib

        from taste_inbox.api.launchd import generate

        for job in generate(tmp_path):
            parsed = plistlib.loads(job.path.read_bytes())
            assert parsed["Label"] == job.label
            assert parsed["ProgramArguments"][1:3] == ["-m", "taste_inbox.ingest.collect"]

    def test_the_job_runs_the_driver_that_collects_not_the_one_that_only_ingests(self) -> None:
        # `ingest.cli` reads capture files already on disk and opens no browser. Six jobs
        # running it every four hours collected nothing, forever, while looking healthy.
        from taste_inbox.api.launchd import build_plist

        plist = build_plist(
            label="x", collector_id="github_stars", interval_hours=4, timezone="Asia/Seoul"
        )
        argv = plist["ProgramArguments"]
        assert isinstance(argv, list)
        assert "taste_inbox.ingest.collect" in argv
        assert "taste_inbox.ingest.cli" not in argv

    def test_the_plist_names_the_interpreter_that_can_import_a_collector(self) -> None:
        # `_python()` is the API venv, which has no playwright in it. Without this the
        # driver's subprocess would fail every cycle inside launchd's empty environment.
        from taste_inbox.api.launchd import build_plist

        plist = build_plist(
            label="x", collector_id="github_stars", interval_hours=4, timezone="Asia/Seoul"
        )
        environment = plist["EnvironmentVariables"]
        assert isinstance(environment, dict)
        assert str(environment["TASTE_INBOX_COLLECTOR_PYTHON"]).endswith(
            "services/collectors/.venv/bin/python"
        )

    def test_installing_a_job_does_not_start_a_session_there_and_then(self) -> None:
        from taste_inbox.api.launchd import build_plist

        plist = build_plist(
            label="x", collector_id="github_stars", interval_hours=4, timezone="Asia/Seoul"
        )
        assert plist["RunAtLoad"] is False

    def test_a_stopped_collector_stays_stopped(self) -> None:
        # No `KeepAlive`: restarting a collector that hit a challenge is the aggressive
        # retry CLAUDE.md §7 forbids.
        from taste_inbox.api.launchd import build_plist

        plist = build_plist(
            label="x", collector_id="github_stars", interval_hours=4, timezone="Asia/Seoul"
        )
        assert "KeepAlive" not in plist

    def test_runs_in_the_configured_timezone(self) -> None:
        from taste_inbox.api.launchd import build_plist

        plist = build_plist(
            label="x", collector_id="github_stars", interval_hours=4, timezone="Asia/Seoul"
        )
        env = plist["EnvironmentVariables"]
        assert isinstance(env, dict)
        assert env["TZ"] == "Asia/Seoul"

    def test_the_job_carries_the_installing_users_home(self) -> None:
        """Chrome and Playwright need HOME even though launchd does not provide it."""
        from pathlib import Path

        from taste_inbox.api.launchd import build_plist

        plist = build_plist(
            label="x", collector_id="github_stars", interval_hours=4, timezone="Asia/Seoul"
        )
        env = plist["EnvironmentVariables"]
        assert isinstance(env, dict)
        assert env["HOME"] == str(Path.home())

    def test_launchd_opens_logs_outside_a_desktop_checkout(self) -> None:
        """launchd preflights its log paths and cannot open them inside Desktop."""
        from pathlib import Path

        from taste_inbox.api.launchd import build_plist

        plist = build_plist(
            label="x", collector_id="github_stars", interval_hours=4, timezone="Asia/Seoul"
        )
        expected = Path.home() / "Library" / "Logs" / "Taste Inbox"
        assert Path(str(plist["StandardOutPath"])).parent == expected
        assert Path(str(plist["StandardErrorPath"])).parent == expected

    def test_the_endpoint_hands_back_commands_rather_than_running_them(
        self, client: TestClient
    ) -> None:
        data = client.get("/api/collection/launchd").json()["data"]
        assert data["installed"] is False
        assert any(line.startswith("launchctl bootstrap") for line in data["commands"])
        assert any(line.startswith("launchctl bootout") for line in data["commands"])

    def test_describing_the_jobs_does_not_write_them(self, client: TestClient) -> None:
        # This endpoint used to call `generate()`, which rewrites six plists. Harmless while
        # nothing called it — then the System screen started rendering it, so *opening a
        # page* rewrote them, and so did every `uv run pytest` (this very test, into the
        # developer's real `var/launchd/`). Reading is not writing.
        from taste_inbox.api.launchd import LAUNCHD_DIR

        before = {path: path.stat().st_mtime_ns for path in sorted(LAUNCHD_DIR.glob("*.plist"))}
        client.get("/api/collection/launchd")
        after = {path: path.stat().st_mtime_ns for path in sorted(LAUNCHD_DIR.glob("*.plist"))}
        assert after == before

    def test_the_install_block_writes_the_plists_before_loading_them(
        self, client: TestClient
    ) -> None:
        # Since the endpoint no longer writes, the commands have to — otherwise a person who
        # changed the interval would bootstrap whatever stale file happened to be on disk.
        data = client.get("/api/collection/launchd").json()["data"]
        commands: list[str] = data["commands"]
        writes = next(i for i, line in enumerate(commands) if "-m taste_inbox.api.launchd" in line)
        loads = next(i for i, line in enumerate(commands) if line.startswith("launchctl bootstrap"))
        assert writes < loads

    def test_the_interval_is_written_in_seconds(self) -> None:
        # `StartInterval` is documented in seconds; handing launchd `6` would run every six
        # seconds against four logged-in accounts.
        from taste_inbox.api.launchd import build_plist

        plist = build_plist(label="x", collector_id="a", interval_hours=6, timezone="Asia/Seoul")
        assert plist["StartInterval"] == 21600
        assert "StartCalendarInterval" not in plist


class TestManualItems:
    def test_stores_only_the_user_supplied_fields(self, client: TestClient) -> None:
        response = client.post(
            "/api/items/manual",
            json={
                "url": "https://www.instagram.com/reel/MANUAL_123/?utm_source=share#caption",
                "board": "music",
                "title": "나중에 들을 곡",
                "note": "사용자가 적은 메모",
            },
        )

        assert response.status_code == 200
        result = response.json()["data"]
        assert result["created"] is True
        item = result["item"]
        assert item["board"] == "music"
        assert item["title"] == "나중에 들을 곡"
        assert item["body"] == "사용자가 적은 메모"
        assert item["source"]["platform"] == "instagram"
        assert item["source"]["originalUrl"] == (
            "https://www.instagram.com/reel/MANUAL_123/?utm_source=share"
        )
        assert item["photos"] == []

    def test_duplicate_link_is_refiled_instead_of_copied(self, client: TestClient) -> None:
        first = client.post(
            "/api/items/manual",
            json={"url": "https://example.com/article#first", "board": "trends"},
        ).json()["data"]
        second = client.post(
            "/api/items/manual",
            json={"url": "https://example.com/article#second", "board": "places"},
        ).json()["data"]

        assert first["created"] is True
        assert second["created"] is False
        assert second["item"]["id"] == first["item"]["id"]
        assert second["item"]["board"] == "places"

    @pytest.mark.parametrize(
        "url",
        [
            "javascript:alert(1)",
            "https://name:secret@example.com/private",
            "https://example.com:not-a-port/path",
            "https://example.com/line\nbreak",
        ],
    )
    def test_rejects_unsafe_or_malformed_links(self, client: TestClient, url: str) -> None:
        response = client.post("/api/items/manual", json={"url": url, "board": "trends"})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "manual_item_rejected"


class TestItemDetail:
    """`GET /api/items/{id}` — the payload behind every "이 항목" link.

    It used to answer with `to_ai_card`, which described a saved Reel as though it were a
    repository. Today links to items from every board, so the detail payload is
    board-agnostic and says which board it belongs to.
    """

    def _first(self, client: TestClient, board: str) -> str:
        return str(client.get(f"/api/{board}/items").json()["data"]["items"][0]["id"])

    def test_answers_for_an_item_from_every_board(self, client: TestClient) -> None:
        for board in ("trends", "style", "music"):
            item_id = self._first(client, board)
            payload = client.get(f"/api/items/{item_id}").json()["data"]
            assert payload["id"] == item_id
            assert payload["board"] == board

    def test_carries_the_body_whole(self, client: TestClient) -> None:
        # The screen someone opens *because* the card was too short.
        item_id = self._first(client, "trends")
        payload = client.get(f"/api/items/{item_id}").json()["data"]
        assert "body" in payload
        assert isinstance(payload["body"], str)

    def test_lists_every_observation_with_its_provenance(self, client: TestClient) -> None:
        item_id = self._first(client, "music")
        payload = client.get(f"/api/items/{item_id}").json()["data"]
        for row in payload["evidence"]:
            assert row["provenance"] in {"fact", "inference", "external"}
            assert row["value"].strip()

    def test_does_not_repeat_links_as_observations(self, client: TestClient) -> None:
        # `links` already renders them as clickable chips; a second copy in the evidence
        # table would be the same fact twice.
        item_id = self._first(client, "trends")
        payload = client.get(f"/api/items/{item_id}").json()["data"]
        assert not any("link" in row["type"] for row in payload["evidence"])

    def test_makes_no_claim_about_running_anything(self, client: TestClient) -> None:
        item_id = self._first(client, "trends")
        payload = client.get(f"/api/items/{item_id}").json()["data"]
        for gone in ("status", "compatibility", "peakMemoryGb", "requiredSecrets"):
            assert gone not in payload

    def test_carries_every_photo_not_just_the_cover(self, client: TestClient) -> None:
        # The board went plural and this route is where someone lands from it. Showing one
        # of five here is the surprise they hit the moment the feature works.
        item_id = self._first(client, "style")
        payload = client.get(f"/api/items/{item_id}").json()["data"]
        assert isinstance(payload["photos"], list)
        if payload["photos"]:
            assert payload["media"] == payload["photos"][0]

    def test_a_missing_item_is_still_a_typed_404(self, client: TestClient) -> None:
        response = client.get("/api/items/not-a-real-id")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "item_not_found"


def _first_style_item(client: TestClient) -> str:
    return str(client.get("/api/style/items").json()["data"]["items"][0]["id"])


def _set_board(client: TestClient, item_id: str, board: object) -> Any:
    return client.patch(f"/api/items/{item_id}/board", json={"board": board})


class TestChangingAnItemsBoard:
    """`PATCH /api/items/{id}/board` — the first write that touches collected data.

    It exists because the classifier is right about 120 of 126 items and the user declined a
    filed-versus-inferred badge in favour of one editable field:

        "그냥 카테고리를 수정할 수 있는 기능만 추가해줘. 그럼 인스타그램 카테고리에 포함된
         것만 내가 훑어보다 수정하면 되잖아."

    So what these assert is not that a column changed — it is that the *boards* changed,
    read back through the same queries the screens use. A write that stored `music` while
    `/api/music/items` went on omitting the item would pass a column-level test and be
    exactly the failure this endpoint exists to prevent.
    """

    def test_the_item_leaves_the_board_it_was_on_and_arrives_on_the_other(
        self, client: TestClient
    ) -> None:
        item_id = _first_style_item(client)

        assert _set_board(client, item_id, "music").status_code == 200

        style = [card["id"] for card in client.get("/api/style/items").json()["data"]["items"]]
        music = [card["id"] for card in client.get("/api/music/items").json()["data"]["items"]]
        assert item_id not in style
        assert item_id in music

    def test_the_response_is_the_refreshed_item_read_back_from_the_database(
        self, client: TestClient
    ) -> None:
        # Not an acknowledgement, and not an echo of the request. `PATCH /api/settings`
        # answers with the whole refreshed document for the same reason: a change that was
        # accepted and a change that had no effect must not look the same from here.
        item_id = _first_style_item(client)

        body = _set_board(client, item_id, "places").json()["data"]

        assert body["id"] == item_id
        assert body["board"] == "places"
        assert body["board"] == client.get(f"/api/items/{item_id}").json()["data"]["board"]

    def test_none_is_a_destination_rather_than_clearing_the_field(self, client: TestClient) -> None:
        """`none` is a decision; null is the absence of one.

        Clearing the column would hand the item back to `classification_targets`, which
        selects on `collection_name IS NULL` — so the classifier would re-ask on its next
        run for an answer the user has just overruled, and pay to do it.
        """
        from taste_inbox.db.models import ItemSource

        item_id = _first_style_item(client)

        assert _set_board(client, item_id, "none").status_code == 200

        session = next(iter(app.dependency_overrides[get_session]()))
        stored = session.scalars(select(ItemSource).where(ItemSource.item_id == item_id)).all()
        assert [row.collection_name for row in stored] == ["none"]

    def test_a_declined_item_is_on_no_board_and_on_the_shelf(self, client: TestClient) -> None:
        item_id = _first_style_item(client)
        _set_board(client, item_id, "none")

        for board in ("trends", "style", "music", "places"):
            listed = [c["id"] for c in client.get(f"/api/{board}/items").json()["data"]["items"]]
            assert item_id not in listed
        shelf = [c["id"] for c in client.get("/api/none/items").json()["data"]["items"]]
        assert shelf == [item_id]

    def test_moving_an_item_back_off_the_shelf_works_the_same_way(self, client: TestClient) -> None:
        # The shelf is a place to correct from, so the round trip has to close. A one-way
        # move would make `none` a delete with extra steps.
        item_id = _first_style_item(client)
        _set_board(client, item_id, "none")

        assert _set_board(client, item_id, "style").status_code == 200

        assert client.get("/api/none/items").json()["data"]["items"] == []
        listed = [c["id"] for c in client.get("/api/style/items").json()["data"]["items"]]
        assert item_id in listed

    def test_an_unknown_board_is_refused_by_name_rather_than_stored(
        self, client: TestClient
    ) -> None:
        item_id = _first_style_item(client)

        response = _set_board(client, item_id, "kitchen")

        assert response.status_code == 422
        error = response.json()["error"]
        assert error["code"] == "board_rejected"
        # The envelope carries only code, message and recoverable, so a refusal that does
        # not say what was wrong is not actionable (`settings.py::_rejected`).
        assert "kitchen" in error["message"]
        assert error["recoverable"] is True
        # And nothing moved.
        listed = [c["id"] for c in client.get("/api/style/items").json()["data"]["items"]]
        assert item_id in listed

    def test_a_body_with_no_board_at_all_is_the_same_refusal(self, client: TestClient) -> None:
        response = client.patch(f"/api/items/{_first_style_item(client)}/board", json={})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "board_rejected"

    def test_a_missing_item_is_the_same_404_the_read_answers(self, client: TestClient) -> None:
        # A stale card and a stale bookmark have to fail identically; the frontend maps one
        # code to one sentence.
        response = _set_board(client, "not-a-real-id", "music")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "item_not_found"

    def test_an_item_never_appears_on_two_boards_after_a_move(self, client: TestClient) -> None:
        """`item_sources` is unique on `(item_id, source_account_id, collection_name)`.

        An item can hold more than one membership — one Instagram post can sit in two Saved
        collections — and moving only one of them would leave it on two boards at once,
        because `board_query` joins `item_sources` and returns a row per match.
        """
        from taste_inbox.db.models import ItemSource

        item_id = _first_style_item(client)
        session = next(iter(app.dependency_overrides[get_session]()))
        first = session.scalar(select(ItemSource).where(ItemSource.item_id == item_id))
        assert first is not None
        session.add(
            ItemSource(
                item_id=item_id,
                source_account_id=first.source_account_id,
                action_type="like",
                collection_name="music",
                position=None,
                first_seen_at=first.first_seen_at,
            )
        )
        session.commit()

        assert _set_board(client, item_id, "trends").status_code == 200

        session.expire_all()
        rows = session.scalars(select(ItemSource).where(ItemSource.item_id == item_id)).all()
        assert [row.collection_name for row in rows] == ["ai"]
        trends = [c["id"] for c in client.get("/api/trends/items").json()["data"]["items"]]
        assert trends.count(item_id) == 1

    def test_moving_onto_an_existing_membership_does_not_violate_the_unique_key(
        self, client: TestClient
    ) -> None:
        """The destination row must be deleted before the oldest row is renamed.

        A commit may flush UPDATE before DELETE. That exact ordering used to answer 500
        with ``UNIQUE constraint failed`` whenever an item had already been seen in the
        destination collection — the real category-change failure this test reproduces.
        """
        from taste_inbox.db.models import ItemSource

        item_id = _first_style_item(client)
        session = next(iter(app.dependency_overrides[get_session]()))
        first = session.scalar(select(ItemSource).where(ItemSource.item_id == item_id))
        assert first is not None
        session.add(
            ItemSource(
                item_id=item_id,
                source_account_id=first.source_account_id,
                action_type="save",
                collection_name="music",
                position=None,
                first_seen_at=first.first_seen_at,
            )
        )
        session.commit()
        oldest_id = first.id

        response = _set_board(client, item_id, "music")

        assert response.status_code == 200
        session.expire_all()
        rows = session.scalars(select(ItemSource).where(ItemSource.item_id == item_id)).all()
        assert [(row.id, row.collection_name) for row in rows] == [(oldest_id, "music")]


class TestTheDeclinedShelf:
    """`/api/none/items` — the visible inbox for items with no board yet.

    It contains both explicit `none` decisions and pending Instagram Likes. The pending
    rows stay null in storage so classification can resume; visibility is a query rule.
    """

    def test_is_empty_and_says_so_rather_than_404ing(self, client: TestClient) -> None:
        response = client.get("/api/none/items")
        assert response.status_code == 200
        assert response.json()["data"]["items"] == []

    def test_health_counts_it_beside_the_boards_and_never_inside_one(
        self, client: TestClient
    ) -> None:
        before = client.get("/api/health").json()["data"]["boards"]
        _set_board(client, _first_style_item(client), "none")
        after = client.get("/api/health").json()["data"]["boards"]

        assert after["none"] == before["none"] + 1
        assert after["style"] == before["style"] - 1
        # The four still add up to the four. A shelf folded into a board total would promise
        # a card the board does not render.
        assert sum(after[board] for board in ("trends", "style", "music", "places")) == (
            sum(before[board] for board in ("trends", "style", "music", "places")) - 1
        )

    def test_a_declined_item_still_knows_where_it_is(self, client: TestClient) -> None:
        # `board: "none"` rather than null. Null means nobody has decided, which is a
        # different fact and the one that keeps the classifier asking.
        item_id = _first_style_item(client)
        _set_board(client, item_id, "none")

        assert client.get(f"/api/items/{item_id}").json()["data"]["board"] == "none"

    def test_the_shelf_serves_the_same_cards_every_ai_board_does(self, client: TestClient) -> None:
        _set_board(client, _first_style_item(client), "none")

        card = client.get("/api/none/items").json()["data"]["items"][0]

        # No extra field, and in particular no reason: the classifier answers with a label
        # and nothing else, so a "why" here would be invented.
        assert set(card) == AI_FIELDS

    def test_an_undecided_instagram_like_is_visible_without_becoming_declined(
        self, client: TestClient
    ) -> None:
        """A collected Like must not disappear while its classifier is unavailable."""
        from datetime import UTC, datetime

        from taste_inbox.api.today import build_today
        from taste_inbox.db.models import Item, ItemSource, SourceAccount

        before_none = client.get("/api/health").json()["data"]["boards"]["none"]
        session = next(iter(app.dependency_overrides[get_session]()))
        account = session.scalar(select(SourceAccount))
        assert account is not None
        stamp = "2026-08-08T07:00:00Z"
        session.add(
            Item(
                id="ig-UNDECIDED",
                kind="post",
                platform="instagram",
                platform_item_id="UNDECIDED",
                canonical_url="https://www.instagram.com/p/UNDECIDED/",
                body_text="아직 아무도 결정하지 않은 좋아요",
                first_seen_at=stamp,
                updated_at=stamp,
            )
        )
        session.add(
            ItemSource(
                item_id="ig-UNDECIDED",
                source_account_id=account.id,
                action_type="like",
                collection_name=None,
                position=None,
                first_seen_at=stamp,
            )
        )
        session.commit()

        shelf = client.get("/api/none/items").json()["data"]["items"]
        assert [item["id"] for item in shelf] == ["ig-UNDECIDED"]
        assert client.get("/api/items/ig-UNDECIDED").json()["data"]["board"] == "none"
        assert client.get("/api/health").json()["data"]["boards"]["none"] == before_none + 1

        # The day Today counted is the exact population Browse > All can render after it
        # merges the four board endpoints and this no-board endpoint.
        today = build_today(session, now=datetime(2026, 8, 8, 8, tzinfo=UTC))
        visible = []
        for route in ("trends", "style", "music", "places", "none"):
            visible.extend(client.get(f"/api/{route}/items?day=2026-08-08").json()["data"]["items"])
        assert today["savedSummary"]["newItemCount"] == 1
        assert [item["id"] for item in visible] == ["ig-UNDECIDED"]

        # Presentation does not mutate the null membership. That is what lets a later
        # classifier run still pick the item up.
        session.expire_all()
        membership = session.scalar(select(ItemSource).where(ItemSource.item_id == "ig-UNDECIDED"))
        assert membership is not None
        assert membership.collection_name is None

    def test_a_pending_like_already_filed_by_another_membership_is_not_duplicated(
        self, client: TestClient
    ) -> None:
        from taste_inbox.db.models import ItemSource

        item_id = _first_style_item(client)
        session = next(iter(app.dependency_overrides[get_session]()))
        first = session.scalar(select(ItemSource).where(ItemSource.item_id == item_id))
        assert first is not None
        session.add(
            ItemSource(
                item_id=item_id,
                source_account_id=first.source_account_id,
                action_type="like",
                collection_name=None,
                position=None,
                first_seen_at=first.first_seen_at,
            )
        )
        session.commit()

        assert item_id in {
            item["id"] for item in client.get("/api/style/items").json()["data"]["items"]
        }
        assert item_id not in {
            item["id"] for item in client.get("/api/none/items").json()["data"]["items"]
        }
