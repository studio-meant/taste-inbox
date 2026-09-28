"""The local service, exercised against a database built from real capture shapes.

The property that matters most is that the JSON matches the zod schemas the frontend
validates against. When it does not, the frontend refuses the whole Inbox — which is the
designed behaviour, and which is exactly how the first three missing fields were found.

The captures below are the documents `services/collectors` writes (`capture_file.py`): one
file per surface — GitHub Stars, Hugging Face likes, Hugging Face paper upvotes.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from taste_inbox.api.app import app, get_session
from taste_inbox.db.models import Base
from taste_inbox.ingest import ingest_all

#: Every field the shared zod schema requires (`packages/shared/src/domain/ai.ts`). A name
#: that drifts here is an Inbox that stops rendering, so the list is asserted, not trusted.
AI_FIELDS = {"id", "kind", "title", "source", "summary", "checkedAt", "tags", "links"}
SOURCE_FIELDS = {"platform", "label", "originalUrl", "author", "actionType", "firstSeenAt"}
LINK_FIELDS = {"id", "url", "label", "kind"}


def _run(surface: str) -> dict[str, Any]:
    return {
        "surface": surface,
        "started_at": "2026-09-28T01:00:00Z",
        "outcome": "ok",
        "scroll_passes": 1,
        "exhausted": True,
        "advanced_checkpoint": True,
        "checkpoint": None,
        "stopped_because": "",
        "notes": [],
    }


def _item(**fields: Any) -> dict[str, Any]:
    return {
        "title": None,
        "body_text": None,
        "owner": None,
        "source_published_at": None,
        "action_at": None,
        "tags": [],
        "outbound_urls": [],
        "evidence": [],
        **fields,
    }


CAPTURES: dict[str, list[dict[str, Any]]] = {
    "github_stars_api": [
        _item(
            platform="github",
            platform_item_id="1001",
            canonical_url="https://github.com/sample-org/agent-kit",
            kind="repo",
            title="sample-org/agent-kit",
            body_text="A small toolkit for agents.",
            owner="sample-org",
            action_at="2026-09-27T10:00:00Z",
            tags=["agents", "llm"],
            outbound_urls=["https://agent-kit.example.dev/docs"],
        ),
        _item(
            platform="github",
            platform_item_id="1002",
            canonical_url="https://github.com/sample-org/tiny-vision",
            kind="repo",
            title="sample-org/tiny-vision",
            owner="sample-org",
            action_at="2026-09-26T10:00:00Z",
        ),
    ],
    "huggingface_activity": [
        _item(
            platform="huggingface",
            platform_item_id="model:sample-org/tiny-model",
            canonical_url="https://huggingface.co/sample-org/tiny-model",
            kind="model",
            title="sample-org/tiny-model",
            owner="sample-org",
            action_at="2026-09-27T09:00:00Z",
            tags=["text-generation"],
        ),
        _item(
            platform="huggingface",
            platform_item_id="dataset:sample-org/tiny-set",
            canonical_url="https://huggingface.co/datasets/sample-org/tiny-set",
            kind="dataset",
            title="sample-org/tiny-set",
            owner="sample-org",
        ),
    ],
    "huggingface_upvotes": [
        _item(
            platform="huggingface",
            platform_item_id="paper:2501.12948",
            canonical_url="https://huggingface.co/papers/2501.12948",
            kind="paper",
            title="A Sample Paper",
            body_text="The abstract, whole.",
            action_at="2026-09-27T08:00:00Z",
            outbound_urls=[
                "https://huggingface.co/papers/2501.12948",
                "https://project.example.org/",
                "https://github.com/sample-org/paper-code",
            ],
            evidence=[
                {
                    "type": "paper.github_repo",
                    "label": "코드",
                    "value": "https://github.com/sample-org/paper-code",
                    "provenance": "huggingface",
                }
            ],
        )
    ],
}


def write_captures(directory: Path, captures: dict[str, list[dict[str, Any]]]) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for surface, items in captures.items():
        (directory / f"{surface}.json").write_text(
            json.dumps({"run": _run(surface), "items": items}, ensure_ascii=False), "utf-8"
        )
    return directory


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

    with factory() as session:
        report = ingest_all(session, write_captures(tmp_path / "captures", CAPTURES))
        assert report.skipped == []

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


def _session() -> Session:
    session: Session = next(iter(app.dependency_overrides[get_session]()))
    return session


def _items(client: TestClient, query: str = "") -> list[dict[str, Any]]:
    return list(client.get(f"/api/items{query}").json()["data"]["items"])


def _by_title(client: TestClient, title: str) -> dict[str, Any]:
    return next(card for card in _items(client) if card["title"] == title)


def _set_outcome(collector_id: str, outcome: str) -> None:
    """The checkpoint every ingested run left behind, as though the last run ended so."""
    from taste_inbox.db.models import Checkpoint

    session = _session()
    checkpoint = session.get(Checkpoint, collector_id)
    assert checkpoint is not None
    checkpoint.last_outcome = outcome
    session.commit()


class TestContract:
    def test_every_response_is_wrapped_in_data(self, client: TestClient) -> None:
        for path in ("/api/health", "/api/items", "/api/today", "/api/jobs"):
            assert "data" in client.get(path).json()

    def test_a_missing_item_is_a_typed_error_not_a_crash(self, client: TestClient) -> None:
        response = client.get("/api/items/nope")
        assert response.status_code == 404
        error = response.json()["error"]
        assert error["code"] == "item_not_found"
        assert error["recoverable"] is False

    def test_cards_carry_every_field_the_frontend_validates(self, client: TestClient) -> None:
        for card in _items(client):
            assert set(card) == AI_FIELDS
            assert set(card["source"]) == SOURCE_FIELDS
            for link in card["links"]:
                assert set(link) == LINK_FIELDS

    def test_a_page_says_where_its_items_came_from(self, client: TestClient) -> None:
        page = client.get("/api/items").json()["data"]
        assert page["origin"] == "collected"
        assert page["nextCursor"] is None


class TestTheInstagramEraIsGone:
    """Removed on 2026-09-28. A route that still answered would be a screen's worth of
    promises nothing behind it can keep."""

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("get", "/api/trends/items"),
            ("get", "/api/style/items"),
            ("get", "/api/music/items"),
            ("get", "/api/places/items"),
            ("get", "/api/none/items"),
            ("get", "/api/media/1"),
        ],
    )
    def test_the_board_and_media_routes_do_not_answer(
        self, client: TestClient, method: str, path: str
    ) -> None:
        assert getattr(client, method)(path).status_code in {404, 405}

    def test_an_item_has_no_board_to_move(self, client: TestClient) -> None:
        item_id = _items(client)[0]["id"]
        response = client.patch(f"/api/items/{item_id}/board", json={"board": "style"})
        assert response.status_code in {404, 405}

    def test_the_source_switches_are_gone_from_settings(self, client: TestClient) -> None:
        assert "sources" not in client.get("/api/settings").json()["data"]
        assert client.patch("/api/settings/sources/github", json={}).status_code in {404, 405}


class TestHonesty:
    def test_nothing_is_reported_as_checked(self, client: TestClient) -> None:
        for card in _items(client):
            assert card["checkedAt"] is None

    def test_a_card_makes_no_claim_about_running_anything(self, client: TestClient) -> None:
        # The sandbox runner is gone, so a field that promised an answer would be a lie
        # rather than a placeholder (docs/DECISIONS.md, 2026-08-09).
        for card in _items(client):
            for gone in ("status", "compatibility", "peakMemoryGb", "requiredSecrets", "preview"):
                assert gone not in card

    def test_the_kind_is_the_one_the_source_named(self, client: TestClient) -> None:
        kinds = {card["title"]: card["kind"] for card in _items(client)}
        assert kinds == {
            "sample-org/agent-kit": "repo",
            "sample-org/tiny-vision": "repo",
            "sample-org/tiny-model": "model",
            "sample-org/tiny-set": "dataset",
            "A Sample Paper": "paper",
        }

    def test_the_signal_is_the_one_the_person_gave(self, client: TestClient) -> None:
        assert _by_title(client, "sample-org/agent-kit")["source"]["actionType"] == "star"
        assert _by_title(client, "sample-org/tiny-model")["source"]["actionType"] == "like"
        assert _by_title(client, "A Sample Paper")["source"]["actionType"] == "upvote"

    def test_the_owner_is_named(self, client: TestClient) -> None:
        assert _by_title(client, "sample-org/agent-kit")["source"]["author"] == "sample-org"

    def test_the_text_is_whole_and_an_empty_one_says_so(self, client: TestClient) -> None:
        assert _by_title(client, "A Sample Paper")["summary"] == "The abstract, whole."
        assert _by_title(client, "sample-org/tiny-vision")["summary"] == "본문이 없습니다."


class TestLinks:
    def test_the_code_comes_before_the_page_and_the_items_own_host_comes_last(
        self, client: TestClient
    ) -> None:
        links = _by_title(client, "A Sample Paper")["links"]
        assert [link["label"] for link in links] == [
            "github.com",
            "project.example.org",
            "huggingface.co",
        ]
        assert [link["kind"] for link in links] == ["artifact", "outbound", "artifact"]

    def test_a_homepage_is_a_plain_link(self, client: TestClient) -> None:
        links = _by_title(client, "sample-org/agent-kit")["links"]
        assert links == [
            {
                "id": links[0]["id"],
                "url": "https://agent-kit.example.dev/docs",
                "label": "agent-kit.example.dev",
                "kind": "outbound",
            }
        ]


class TestInbox:
    def test_holds_everything_newest_first(self, client: TestClient) -> None:
        cards = _items(client)
        assert len(cards) == 5
        stamps = [card["source"]["firstSeenAt"] for card in cards]
        assert stamps == sorted(stamps, reverse=True)

    def test_health_counts_what_the_inbox_lists(self, client: TestClient) -> None:
        assert client.get("/api/health").json()["data"] == {"status": "ok", "itemCount": 5}

    def test_jobs_is_an_empty_list_not_a_rejection(self, client: TestClient) -> None:
        # Rejecting took down every page in the workspace: the shell asks for this on each
        # render, so an unimplemented endpoint became an unrelated screen's failure.
        response = client.get("/api/jobs")
        assert response.status_code == 200
        assert response.json()["data"]["jobs"] == []


class TestFilters:
    def test_kind_and_source_speak_the_urls_vocabulary(self, client: TestClient) -> None:
        assert {card["kind"] for card in _items(client, "?kind=paper,dataset")} == {
            "paper",
            "dataset",
        }
        assert {card["source"]["platform"] for card in _items(client, "?source=github")} == {
            "github"
        }
        assert len(_items(client, "?source=github&kind=model")) == 0

    def test_the_day_filter_reads_the_local_calendar_day(self, client: TestClient) -> None:
        """`?day=` is the rail's calendar, and it filters on the *Seoul* day.

        `first_seen_at` is stamped in UTC and the app reasons nine hours ahead of it, so
        for nine hours out of every twenty-four the two spell different dates. This asserts
        the endpoint agrees with `_local_day` — the same function `/api/today` groups its
        per-day history with — rather than with the string prefix.
        """
        from zoneinfo import ZoneInfo

        from taste_inbox.api.today import _local_day

        cards = _items(client)
        stamp = cards[0]["source"]["firstSeenAt"]
        local = _local_day(stamp, ZoneInfo("Asia/Seoul"))
        assert local is not None

        same_day = _items(client, f"?day={local}")
        assert [card["id"] for card in same_day] == [card["id"] for card in cards]
        assert _items(client, "?day=2000-01-01") == []

        # The rule itself, on a fixed instant: 15:30 UTC is half past midnight in Seoul.
        assert _local_day("2026-08-08T15:30:00Z", ZoneInfo("Asia/Seoul")) == "2026-08-09"
        assert _local_day("2026-08-08T14:59:59Z", ZoneInfo("Asia/Seoul")) == "2026-08-08"

    def test_a_stale_filter_opens_the_inbox_rather_than_raising(self, client: TestClient) -> None:
        # `?status=` used to 500 after the field it filtered was removed. A stale bookmark
        # must open the Inbox; the frontend says which value it dropped.
        assert client.get("/api/items?status=ready_local").status_code == 200
        assert len(_items(client, "?status=ready_local")) == 5
        assert _items(client, "?day=yesterday") == []
        assert _items(client, "?source=in-sta") == []


class TestManualRefresh:
    def test_reads_what_the_collectors_left_and_nothing_else(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from taste_inbox import ingest as ingest_module
        from taste_inbox.ingest.captures import IngestReport

        # Stubbed rather than run: the real call reads the machine's capture directory.
        monkeypatch.setattr(ingest_module, "ingest_all", lambda _session: IngestReport())

        data = client.post("/api/collection/refresh").json()["data"]

        assert set(data) == {"refreshedAt", "ingest"}


class TestToday:
    def test_counts_only_what_the_database_knows(self, client: TestClient) -> None:
        data = client.get("/api/today").json()["data"]
        assert data["counts"]["newItems"] == 5
        assert data["counts"]["readyActions"] == 0

    def test_the_kind_chips_add_up_to_the_headline(self, client: TestClient) -> None:
        summary = client.get("/api/today").json()["data"]["savedSummary"]
        assert summary["kindCounts"] == {"repo": 2, "dataset": 1, "model": 1, "paper": 1}
        assert sum(summary["kindCounts"].values()) == summary["newItemCount"]
        assert summary["sources"] == ["github", "huggingface"]

    def test_the_saved_card_carries_no_board_split_and_no_pictures(
        self, client: TestClient
    ) -> None:
        summary = client.get("/api/today").json()["data"]["savedSummary"]
        for gone in ("aiCount", "styleCount", "musicCount", "placesCount", "preview", "previews"):
            assert gone not in summary

    def test_the_saved_card_links_to_the_day_it_counted(self, client: TestClient) -> None:
        data = client.get("/api/today").json()["data"]
        assert data["savedSummary"]["href"] == f"/library?day={data['date']}"

    def test_a_counted_day_has_something_under_its_heading(self, client: TestClient) -> None:
        """`previousDays` renders its heading from `itemCount` and its cards from
        `highlights`, so the two disagreeing leaves a labelled empty space."""
        from datetime import UTC, datetime, timedelta

        from taste_inbox.db.models import Item, ItemSource, SourceAccount

        yesterday = (datetime.now(UTC) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        session = _session()
        account = session.scalar(select(SourceAccount).where(SourceAccount.platform == "github"))
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
            ItemSource(
                item_id=item.id,
                source_account_id=account.id,
                action_type="star",
                first_seen_at=yesterday,
            )
        )
        session.commit()

        days = client.get("/api/today").json()["data"]["previousDays"]
        row = next(day for day in days if day["label"] == "어제")
        assert row["itemCount"] == 1
        assert row["highlights"] == [
            {
                "id": "gh-yesterday",
                "kind": "repo",
                "platform": "github",
                "title": "owner/repo",
                "meta": "GitHub",
                "href": "/items/gh-yesterday",
            }
        ]

    def test_invents_no_connection_and_no_queue(self, client: TestClient) -> None:
        data = client.get("/api/today").json()["data"]
        assert data["leadConnection"] is None
        assert data["relatedConnections"] == []
        assert data["workingQueue"] == []
        assert data["suggestedQueries"] == []

    def test_reports_per_source_collection_state(self, client: TestClient) -> None:
        sources = client.get("/api/today").json()["data"]["sourceStatusSummary"]["sources"]
        assert [(row["platform"], row["collectedCount"]) for row in sources] == [
            ("github", 2),
            ("huggingface", 3),
        ]
        assert {row["state"] for row in sources} == {"collected"}

    def test_greets_by_the_hour_rather_than_at_random(self) -> None:
        from datetime import UTC, datetime

        from taste_inbox.api.today import _greeting

        assert _greeting(datetime(2026, 8, 8, 9, tzinfo=UTC)) == "좋은 아침이에요"
        assert _greeting(datetime(2026, 8, 8, 14, tzinfo=UTC)) == "좋은 오후예요"
        assert _greeting(datetime(2026, 8, 8, 22, tzinfo=UTC)) == "오늘 하루 어땠나요"

    def test_today_starts_at_local_midnight_not_utc_midnight(self) -> None:
        """ "오늘" is the 24 hours from 밤 12시 in the configured timezone.

        Seoul is UTC+9, so 2026-08-09T15:00:00Z *is* local midnight. Counting the UTC date
        prefix put everything starred between 00:00 and 09:00 KST on the previous day.
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
                        kind="repo",
                        platform="github",
                        platform_item_id=f"boundary/{name}",
                        canonical_url=f"https://github.com/boundary/{name}",
                        first_seen_at=stamp,
                        updated_at=stamp,
                    )
                )
            session.commit()

            # 01:00 KST on the 10th — one hour into the window.
            payload = build_today(session, now=datetime(2026, 8, 9, 16, 0, tzinfo=UTC))

        assert payload["date"] == "2026-08-10"
        assert payload["counts"]["newItems"] == 1
        assert [row["date"] for row in payload["previousDays"]] == ["2026-08-09"]

    @pytest.mark.parametrize("outcome", ["failed", "auth_required", "blocked"])
    def test_a_stopped_collector_asks_for_a_person(self, client: TestClient, outcome: str) -> None:
        """A collector that stopped says so — including the upvote reader meeting a shape
        it no longer recognises, which reports `failed` (docs/DECISIONS.md §업보트)."""
        _set_outcome("huggingface_upvotes", outcome)

        data = client.get("/api/today").json()["data"]
        assert data["counts"]["attention"] == 1
        hf = next(
            row
            for row in data["sourceStatusSummary"]["sources"]
            if row["platform"] == "huggingface"
        )
        assert hf["state"] == ("auth_required" if outcome == "auth_required" else "failed")

    def test_a_rate_limit_waits_for_the_next_cycle_quietly(self, client: TestClient) -> None:
        _set_outcome("github_stars_api", "rate_limited")

        assert client.get("/api/today").json()["data"]["counts"]["attention"] == 0


class TestCollectorStatus:
    """`GET /api/system/collectors` — the only place a stopped collector explains itself.

    Driven by `collector_runs`: a collector whose first run failed has no advanced
    checkpoint, and it must still appear, because that is the state worth reporting.
    """

    def _ingest_failed_run(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        run = {
            **_run("huggingface_upvotes"),
            "outcome": "failed",
            "started_at": "2026-09-28T12:00:00Z",
            "advanced_checkpoint": False,
            "exhausted": False,
            "stopped_because": "업보트 응답의 모양이 바뀌었어요",
            "notes": ["recentActivity missing"],
        }
        (directory / "huggingface_upvotes.json").write_text(
            json.dumps({"run": run, "items": []}, ensure_ascii=False), "utf-8"
        )
        ingest_all(_session(), directory)

    def _upvotes(self, client: TestClient) -> dict[str, Any]:
        rows = client.get("/api/system/collectors").json()["data"]["collectors"]
        return next(row for row in rows if row["collectorId"] == "huggingface_upvotes")

    def test_a_failed_run_is_reported_with_its_reason_and_notes(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        self._ingest_failed_run(tmp_path / "failed")

        row = self._upvotes(client)
        assert row["lastOutcome"] == "failed"
        assert row["lastRun"]["stoppedBecause"] == "업보트 응답의 모양이 바뀌었어요"
        assert row["lastRun"]["notes"] == ["recentActivity missing"]
        assert row["lastRun"]["advancedCheckpoint"] is False

    def test_every_collector_that_ran_is_listed(self, client: TestClient) -> None:
        rows = client.get("/api/system/collectors").json()["data"]["collectors"]
        assert [row["collectorId"] for row in rows] == [
            "github_stars_api",
            "huggingface_activity",
            "huggingface_upvotes",
        ]


class TestSchedule:
    """`GET /api/collection/schedule` — an interval, not a time of day."""

    def test_the_interval_reaches_the_payload(self, client: TestClient) -> None:
        data = client.get("/api/collection/schedule").json()["data"]

        assert data["intervalHours"] == 4
        assert data["dailySlots"] == ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"]
        assert data["staggerMinutes"] == 3
        assert data["allowManualRefresh"] is True
        assert "browserAutomationAvailable" not in data
        assert [source["collectorId"] for source in data["sources"]] == [
            "github_stars_api",
            "huggingface_activity",
            "huggingface_upvotes",
        ]

    def test_answers_when_each_source_runs_next(self) -> None:
        from datetime import UTC, datetime

        from taste_inbox.api.schedule import describe

        # 11:30 in Seoul: past the 08:00 slot, before the 12:00 one.
        payload = describe(now=datetime(2026, 8, 9, 2, 30, tzinfo=UTC))
        first, second = payload["sources"][0], payload["sources"][1]

        assert first["runsAt"] == "12:00"
        assert first["nextRunAt"].startswith("2026-08-09T12:00:00")
        assert second["runsAt"] == "12:03"

    def test_after_the_days_last_slot_the_cycle_restarts_at_midnight(self) -> None:
        from datetime import UTC, datetime

        from taste_inbox.api.schedule import describe

        # 21:00 in Seoul, past the 20:00 slot.
        payload = describe(now=datetime(2026, 8, 9, 12, 0, tzinfo=UTC))

        assert payload["sources"][0]["nextRunAt"].startswith("2026-08-10T00:00:00")

    def test_the_schema_bounds_the_stagger_by_the_sources_that_exist(self) -> None:
        # `config/schema.py` counts the sources by a number because config validation must
        # not import this module. Adding a collector is what silently stops it being true.
        from taste_inbox.api.schedule import SOURCE_ORDER
        from taste_inbox.config.schema import STAGGERED_SOURCES

        assert len(SOURCE_ORDER) == STAGGERED_SOURCES


class TestLaunchd:
    """The scheduled jobs. Written, never installed (CLAUDE.md §10)."""

    def test_writes_one_job_per_source_offset_from_a_single_interval(self, tmp_path: Path) -> None:
        from taste_inbox.api.launchd import generate

        jobs = generate(tmp_path)
        assert [job.collector_id for job in jobs] == [
            "github_stars_api",
            "huggingface_activity",
            "huggingface_upvotes",
        ]
        assert [job.runs_at for job in jobs] == [
            "4시간마다",
            "4시간마다 (+3분)",
            "4시간마다 (+6분)",
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
            assert parsed["Label"] == job.label
            assert parsed["ProgramArguments"][1:3] == ["-m", "taste_inbox.ingest.collect"]

    def test_the_stagger_is_the_wait_between_installs(self, tmp_path: Path) -> None:
        """launchd starts each interval when the job is loaded, so the only thing that
        separates two collectors is how far apart a person loads them."""
        from taste_inbox.api.launchd import generate, install_commands
        from taste_inbox.api.schedule import SOURCE_ORDER

        lines = install_commands(generate(tmp_path))
        bootstraps = [line for line in lines if line.startswith("launchctl bootstrap")]
        sleeps = [line for line in lines if line.startswith("sleep ")]

        assert len(bootstraps) == len(SOURCE_ORDER)
        assert len(sleeps) == len(SOURCE_ORDER) - 1
        assert all(line.startswith("sleep 180") for line in sleeps)
        assert lines.index(bootstraps[0]) < lines.index(sleeps[0])

    def test_the_plist_is_modest_and_self_contained(self) -> None:
        from taste_inbox.api.launchd import build_plist

        plist = build_plist(
            label="x", collector_id="github_stars_api", interval_hours=6, timezone="Asia/Seoul"
        )
        argv = plist["ProgramArguments"]
        environment = plist["EnvironmentVariables"]
        assert isinstance(argv, list)
        assert isinstance(environment, dict)
        # The driver that collects, not the one that only re-reads files already on disk.
        assert "taste_inbox.ingest.collect" in argv
        assert str(environment["TASTE_INBOX_COLLECTOR_PYTHON"]).endswith(
            "services/collectors/.venv/bin/python"
        )
        assert environment["TZ"] == "Asia/Seoul"
        assert environment["HOME"] == str(Path.home())
        # Installing a job does not collect there and then, a stopped collector stays
        # stopped (CLAUDE.md §7), and the interval is seconds — `6` would be six seconds.
        assert plist["RunAtLoad"] is False
        assert "KeepAlive" not in plist
        assert plist["StartInterval"] == 21600

    def test_launchd_opens_logs_outside_a_desktop_checkout(self) -> None:
        """launchd preflights its log paths and cannot open them inside Desktop."""
        from taste_inbox.api.launchd import build_plist

        plist = build_plist(
            label="x", collector_id="github_stars_api", interval_hours=4, timezone="Asia/Seoul"
        )
        expected = Path.home() / "Library" / "Logs" / "Taste Inbox"
        assert Path(str(plist["StandardOutPath"])).parent == expected
        assert Path(str(plist["StandardErrorPath"])).parent == expected

    def test_the_endpoint_hands_back_commands_rather_than_running_them(
        self, client: TestClient
    ) -> None:
        data = client.get("/api/collection/launchd").json()["data"]
        commands: list[str] = data["commands"]
        assert data["installed"] is False
        assert any(line.startswith("launchctl bootstrap") for line in commands)
        assert any(line.startswith("launchctl bootout") for line in commands)
        # The install block writes the plists before it loads them, so a changed interval
        # is what gets installed.
        writes = next(i for i, line in enumerate(commands) if "-m taste_inbox.api.launchd" in line)
        loads = next(i for i, line in enumerate(commands) if line.startswith("launchctl bootstrap"))
        assert writes < loads

    def test_describing_the_jobs_does_not_write_them(self, client: TestClient) -> None:
        # Reading is not writing: opening Settings must not rewrite the plists.
        from taste_inbox.api.launchd import LAUNCHD_DIR

        before = {path: path.stat().st_mtime_ns for path in sorted(LAUNCHD_DIR.glob("*.plist"))}
        client.get("/api/collection/launchd")
        after = {path: path.stat().st_mtime_ns for path in sorted(LAUNCHD_DIR.glob("*.plist"))}
        assert after == before


class TestManualItems:
    def test_stores_only_the_user_supplied_fields(self, client: TestClient) -> None:
        response = client.post(
            "/api/items/manual",
            json={
                "url": "https://huggingface.co/datasets/someone/set?utm_source=share#readme",
                "title": "나중에 볼 데이터셋",
                "note": "사용자가 적은 메모",
            },
        )

        assert response.status_code == 200
        result = response.json()["data"]
        assert result["created"] is True
        item = result["item"]
        assert item["kind"] == "dataset"
        assert item["title"] == "나중에 볼 데이터셋"
        assert item["body"] == "사용자가 적은 메모"
        assert item["source"]["platform"] == "huggingface"
        assert item["source"]["originalUrl"] == (
            "https://huggingface.co/datasets/someone/set?utm_source=share"
        )
        assert "board" not in item

    @pytest.mark.parametrize(
        ("url", "platform", "kind"),
        [
            ("https://github.com/someone/tool", "github", "repo"),
            ("https://huggingface.co/someone/model", "huggingface", "model"),
            ("https://huggingface.co/spaces/someone/demo", "huggingface", "space"),
            ("https://huggingface.co/papers/2501.00001", "huggingface", "paper"),
            ("https://arxiv.org/abs/2501.00001", "arxiv", "paper"),
            ("https://example.com/article", "web", "post"),
        ],
    )
    def test_the_url_decides_what_it_is(
        self, client: TestClient, url: str, platform: str, kind: str
    ) -> None:
        item = client.post("/api/items/manual", json={"url": url}).json()["data"]["item"]
        assert (item["source"]["platform"], item["kind"]) == (platform, kind)

    def test_a_link_already_in_the_inbox_is_not_copied(self, client: TestClient) -> None:
        first = client.post(
            "/api/items/manual", json={"url": "https://example.com/article#first"}
        ).json()["data"]
        second = client.post(
            "/api/items/manual", json={"url": "https://example.com/article#second"}
        ).json()["data"]

        assert first["created"] is True
        assert second["created"] is False
        assert second["item"]["id"] == first["item"]["id"]

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
        response = client.post("/api/items/manual", json={"url": url})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "manual_item_rejected"


class TestItemDetail:
    """`GET /api/items/{id}` — the payload behind every "이 항목" link."""

    def test_carries_the_body_the_links_and_the_observations(self, client: TestClient) -> None:
        item_id = _by_title(client, "A Sample Paper")["id"]
        payload = client.get(f"/api/items/{item_id}").json()["data"]

        assert payload["id"] == item_id
        assert payload["kind"] == "paper"
        assert payload["body"] == "The abstract, whole."
        assert payload["links"][0]["label"] == "github.com"
        # Observations with their provenance — and never the links a second time.
        assert [row["type"] for row in payload["evidence"]] == ["paper.github_repo"]
        assert payload["evidence"][0]["provenance"] == "huggingface"

    def test_carries_nothing_from_the_instagram_era(self, client: TestClient) -> None:
        item_id = _items(client)[0]["id"]
        payload = client.get(f"/api/items/{item_id}").json()["data"]
        for gone in ("board", "media", "photos", "author", "status", "compatibility"):
            assert gone not in payload
