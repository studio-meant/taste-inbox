"""The local service.

Bound to loopback, single user, no authentication — it is one process talking to one
browser on one Mac. That is a deliberate scope, not an omission: adding auth to a service
that cannot be reached from another machine buys nothing and invites a credential to
store.

Every response is `{"data": ...}` and every failure is
`{"error": {code, message, recoverable}}`, matching `FRONTEND_COMPONENT_ARCHITECTURE.md`
§18 so the client can map a code to its own copy instead of trusting a server string.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from ..db.models import Item, MediaAsset
from ..paths import REPO_ROOT
from .cards import (
    BOARD_COLLECTIONS,
    DECLINED_BOARD,
    board_query,
    count_no_board,
    generated_at,
    load_authors,
    no_board_query,
    to_ai_card,
    to_item_detail,
    to_music_card,
    to_style_card,
)
from .schedule import configured_zone

# `_local_day` by name, rather than a second conversion written here. It is the function
# Today already groups its per-day history with, and the boards' `?day=` has to answer for
# the same rows: two independent UTC→local conversions would disagree the first time one of
# them read a bare stamp differently, and a board that files an item on a different day than
# Today does is worse than no calendar at all.
from .today import _local_day

DEFAULT_DATABASE_URL = f"sqlite:///{REPO_ROOT / 'var' / 'data' / 'taste-inbox.db'}"

_engine = create_engine(os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL))
_Session = sessionmaker(_engine)


def get_session() -> Iterator[Session]:
    with _Session() as session:
        yield session


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    from .background import close_orphans

    # A research or trial job left `running` by a previous process never finishes on its
    # own. Closing it here is what keeps "running" on screen meaning running.
    with _Session() as session:
        close_orphans(session)
    stop = threading.Event()
    if os.environ.get("TASTE_INBOX_SCHEDULER") == "1":
        threading.Thread(
            target=_scheduler_loop, args=(stop,), name="taste-inbox-scheduler", daemon=True
        ).start()
    yield
    stop.set()


#: How often the in-app scheduler asks whether a connected account is due.
SCHEDULER_TICK_SECONDS = 60


def _database_url() -> str:
    return _engine.url.render_as_string(hide_password=False)


def _collect_surface(surface: str, database_url: str) -> int:
    """Collect one surface and ingest it — the scheduled driver, called in-process."""
    from ..ingest.collect import main as collect_main

    return collect_main(["--collector", surface, "--database-url", database_url, "--no-classify"])


def _start_collections(session: Session, platforms: list[str]) -> list[str]:
    """Queue a collection of each platform, run one after another. Empty when one is running.

    One background run for all of them, because the slot admits one collection at a time: a
    first run that connects both accounts would otherwise collect GitHub and leave Hugging
    Face waiting for the scheduler.
    """
    from . import accounts, background

    if not platforms or background.busy("collection"):
        return []
    job_ids = [accounts.open_job(session, platform).id for platform in platforms]
    database_url = _database_url()

    def work(worker: Session) -> None:
        for platform, job_id in zip(platforms, job_ids, strict=True):
            accounts.run_job(
                worker, platform, job_id, database_url=database_url, collector=_collect_surface
            )

    if not background.start("collection", job_ids[0], work, session_factory=_Session):
        for job_id in job_ids:
            _abandon(session, job_id)
        return []
    return job_ids


def _start_collection(session: Session, platform: str) -> str | None:
    """One platform. None when a collection is already running."""
    started = _start_collections(session, [platform])
    return started[0] if started else None


def _scheduler_loop(stop: threading.Event) -> None:
    """Collect each connected account once its interval has passed. Opt-in.

    Settings' `collection.intervalHours` is read on every tick, so a changed interval applies
    from the next minute rather than from the next launchd install — the reason this exists
    beside the launchd jobs rather than instead of them. Off unless `TASTE_INBOX_SCHEDULER=1`
    (`scripts/dev.sh` sets it): a test process or a one-off API must never reach GitHub.
    """
    from . import accounts
    from .schedule import effective_document

    while not stop.wait(SCHEDULER_TICK_SECONDS):
        try:
            with _Session() as session:
                interval = effective_document(session).collection.interval_hours
                for platform in accounts.PLATFORMS:
                    # One collection at a time; a platform skipped here is due next tick.
                    if (
                        accounts.due(session, platform, interval)
                        and _start_collection(session, platform) is None
                    ):
                        break
        except Exception:
            logging.getLogger(__name__).exception("scheduler tick failed")


app = FastAPI(
    title="Taste Inbox", version="0.1.0", docs_url=None, redoc_url=None, lifespan=_lifespan
)


class ApiError(HTTPException):
    def __init__(self, status: int, code: str, message: str, *, recoverable: bool) -> None:
        super().__init__(status_code=status, detail=message)
        self.code = code
        self.recoverable = recoverable


@app.exception_handler(ApiError)
def _api_error(_request: Request, error: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={
            "error": {
                "code": error.code,
                "message": error.detail,
                "recoverable": error.recoverable,
            }
        },
    )


@app.exception_handler(Exception)
def _unexpected(_request: Request, error: Exception) -> JSONResponse:
    # The message names the exception type and nothing else. A caption, a path or a URL in
    # here would put personal data into a log the user never asked to keep
    # (`docs/SECURITY_BOUNDARIES.md`, "Logging").
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_error",
                "message": f"{type(error).__name__}",
                "recoverable": False,
            }
        },
    )


def _page(items: list[dict[str, Any]], *, origin: str) -> dict[str, Any]:
    return {
        "data": {
            "items": items,
            "nextCursor": None,
            "generatedAt": generated_at(),
            "origin": origin,
        }
    }


@app.get("/api/health")
def health(session: Session = Depends(get_session)) -> dict[str, Any]:
    counts = {board: 0 for board in BOARD_COLLECTIONS}
    for board in BOARD_COLLECTIONS:
        counts[board] = len(list(session.scalars(board_query(board))))
    # None is the visible inbox for both explicit "no board" decisions and Instagram Likes
    # still waiting for classification. Browse > All includes the same count, so the rail
    # never promises fewer cards than the merged page renders.
    counts[DECLINED_BOARD] = count_no_board(session)
    return {"data": {"status": "ok", "boards": counts}}


@app.get("/api/trends/items")
def trends_items(
    session: Session = Depends(get_session),
    kind: str | None = Query(default=None),
    source: str | None = Query(default=None),
    day: str | None = Query(default=None),
) -> dict[str, Any]:
    # No `status`. The parameter outlived the field: `AIItemCardModel` lost `status` when
    # the sandbox runner was removed (docs/DECISIONS.md, 2026-08-09), and the filter kept
    # reading `card["status"]` — so `?status=anything` raised `KeyError` and answered 500.
    # It survived because nothing in the frontend has sent it since the day it was removed.
    items = [to_ai_card(session, item) for item in session.scalars(board_query("trends"))]
    items = _apply(items, "kind", kind, lambda card: card["kind"])
    items = _apply(items, "source", source, lambda card: card["source"]["platform"])
    items = _on_day(session, items, day)
    return _page(items, origin="collected")


@app.get("/api/style/items")
def style_items(
    session: Session = Depends(get_session),
    source: str | None = Query(default=None),
    day: str | None = Query(default=None),
) -> dict[str, Any]:
    # No `match` or `stock`. They filtered on a resolved product, and the board will never
    # resolve one (docs/DECISIONS.md, 2026-08-09) — a filter over a field nothing produces
    # is a control that always returns everything or nothing.
    rows = list(session.scalars(board_query("style")))
    # Before the loop, not inside it: 61 accounts stand behind these 76 posts, and asking
    # per card would re-read the same profile once per post it wrote.
    load_authors(session, rows)
    items = [to_style_card(session, item) for item in rows]
    items = _apply(items, "source", source, lambda card: card["source"]["platform"])
    items = _on_day(session, items, day)
    return _page(items, origin="collected")


@app.get("/api/music/items")
def music_items(
    session: Session = Depends(get_session),
    handled: str = Query(default="hidden"),
    source: str | None = Query(default=None),
    day: str | None = Query(default=None),
) -> dict[str, Any]:
    # `source` is here for `/library`, not for `/music`. The music board is entirely
    # Instagram, so the facet cannot narrow it and is never rendered there — but the merged
    # board applies one `?source=` across all three lists, and a parameter this endpoint
    # accepted and ignored would answer `?source=github` with Instagram Reels.
    items = [to_music_card(session, item) for item in session.scalars(board_query("music"))]
    if handled != "shown":
        items = [card for card in items if card["handledAt"] is None]
    items = _apply(items, "source", source, lambda card: card["source"]["platform"])
    items = _on_day(session, items, day)
    return _page(items, origin="collected")


@app.get("/api/places/items")
def places_items(
    session: Session = Depends(get_session),
    source: str | None = Query(default=None),
    day: str | None = Query(default=None),
) -> dict[str, Any]:
    """Saved restaurants, cafés and travel spots — served as AI cards, deliberately.

    A place the user saved is an Instagram post: a caption, a photo and whatever the account
    linked. `to_ai_card` already builds exactly that, so this board reuses it rather than
    mint a fourth card model. The fields a "place card" would seem to want — a rating, an
    address, a map — are things nothing here collected and nothing here will produce, and a
    field with no honest producer is removed rather than shipped as a null
    (docs/DECISIONS.md, 2026-08-09).

    `source` and `day` for the same reason `/api/music/items` takes them. `/places` renders
    neither facet, but `/library` applies one filter across every board's list at once, and
    a parameter this endpoint accepted and ignored would answer `?source=github` with
    Instagram posts.

    Filled by `enrich/classify.py`, which gained this board on 2026-08-12, and by
    `PATCH /api/items/{id}/board` when a person moves something here. No platform routes to
    it by rule, so those two are the only ways onto it.
    """
    items = [to_ai_card(session, item) for item in session.scalars(board_query("places"))]
    items = _apply(items, "source", source, lambda card: card["source"]["platform"])
    items = _on_day(session, items, day)
    return _page(items, origin="collected")


@app.get("/api/none/items")
def declined_items(
    session: Session = Depends(get_session),
    source: str | None = Query(default=None),
    day: str | None = Query(default=None),
) -> dict[str, Any]:
    """Items with no visible board yet, including pending Instagram Likes.

    Pending Likes remain null in the database so the classifier can resume later; explicit
    None decisions remain `collection_name = "none"`. Both are visible here and in Browse >
    All, which prevents a successfully collected item from disappearing while enrichment is
    unavailable.

    Served as AI cards, for the same reason `/places` is: the card shows a caption, a photo,
    the hashtags and the outbound links, which is the whole of what was collected. There is
    no honest extra field a "declined card" could carry — least of all a reason, which the
    classifier does not produce and this product will not invent.

    `source` and `day` because every board list takes them and a filter that some lists
    honour and others ignore is the failure `docs/DECISIONS.md` (2026-08-08) calls worse
    than not offering the filter. Nothing renders them here today.
    """
    items = [to_ai_card(session, item) for item in session.scalars(no_board_query())]
    items = _apply(items, "source", source, lambda card: card["source"]["platform"])
    items = _on_day(session, items, day)
    return _page(items, origin="collected")


def _apply(
    items: list[dict[str, Any]],
    _key: str,
    raw: str | None,
    read: Any,
) -> list[dict[str, Any]]:
    """Filter on a comma-separated multi-value, the URL grammar the frontend already uses.

    An unrecognised value simply matches nothing rather than raising: a stale bookmark
    should open the board, and the frontend already tells the user which value it dropped.
    """
    if not raw:
        return items
    wanted = {value.strip() for value in raw.split(",") if value.strip()}
    return [card for card in items if read(card) in wanted]


def _on_day(
    session: Session,
    items: list[dict[str, Any]],
    day: str | None,
) -> list[dict[str, Any]]:
    """Narrow a board to one **local** calendar day — `?day=2026-08-08`.

    Single-valued, unlike `_apply`: the rail's calendar selects one day, and a comma-separated
    list of days is not a shape any control here produces.

    The conversion is the whole point. `first_seen_at` is stamped in UTC and the app reasons
    in `config/app.yaml`'s timezone — Seoul, nine hours ahead — so comparing the UTC date
    prefix would file everything saved between midnight and 09:00 KST on the previous day.
    `_local_day` is the same function `/api/today` groups its per-day history with, and
    `configured_zone` the same resolver the collection schedule anchors on, so all three
    agree on where a day begins.

    A row whose stamp cannot be read is left out rather than guessed onto a day, which is
    what `_local_day` already decided for Today. An unrecognised day simply matches nothing:
    a stale bookmark opens the board, and the frontend says which value it dropped.
    """
    if not day:
        return items
    zone = configured_zone(session)
    return [card for card in items if _local_day(str(card["source"]["firstSeenAt"]), zone) == day]


@app.get("/api/items/{item_id}")
def item_detail(item_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    item = session.get(Item, item_id)
    if item is None:
        raise ApiError(404, "item_not_found", "그 항목을 찾을 수 없어요.", recoverable=False)
    return {"data": to_item_detail(session, item)}


@app.post("/api/items/manual")
def manual_item_create(
    payload: dict[str, Any] | None = None, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """Store a user-supplied bookmark; never crawl, preview or resolve its URL."""

    from .manual_items import create_manual_item

    return {"data": create_manual_item(session, payload)}


@app.patch("/api/items/{item_id}/board")
def item_board_patch(
    item_id: str, payload: dict[str, Any] | None = None, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """Move one item onto another board, or onto none.

    The body is `{"board": "music"}` — one value, unlike `PATCH /api/settings`'s dotted
    `changes` map, because there is exactly one field here and a map of one key would be
    ceremony. The failure contract is the settings endpoint's: 422 with the offending value
    named in Korean, and the write is all-or-nothing.

    The response is the refreshed item, not an acknowledgement. `board` in it is read back
    out of the database through `board_of`, so a caller learns where the item actually ended
    up rather than what it asked for — which is the only way a screen can tell a change that
    was accepted from one that had no effect.
    """
    from .boards import set_item_board

    return {"data": set_item_board(session, item_id, payload)}


#: How long a client may reuse a thumbnail before it has to ask again.
#:
#: One hour, and deliberately **not** `immutable`. The URL is `/api/media/{asset_id}` where
#: `asset_id` is an integer rowid, and re-collection can point that same rowid at different
#: bytes — the orphaned-file sweep in `ingest/media.py` exists precisely because a new
#: capture mints a new file for an item. `immutable` would tell the browser never to
#: revalidate, and the stale image would survive a reload.
MEDIA_MAX_AGE_SECONDS = 3600


def _etag_matches(header: str | None, etag: str) -> bool:
    """Does an `If-None-Match` header name this etag?

    The header is a list, and a cache is allowed to weaken an entity tag it stores, so
    `W/"abc"` has to match `"abc"`.
    """
    if not header:
        return False
    return any(
        candidate.strip() == "*" or candidate.strip().removeprefix("W/") == etag
        for candidate in header.split(",")
    )


@app.get("/api/media/{asset_id}")
def media(asset_id: int, request: Request, session: Session = Depends(get_session)) -> Response:
    """Serve a cached thumbnail from disk, or confirm the client's copy is still good.

    Only ever a row this service wrote: the path comes from `media_assets.local_path`, not
    from the request, so a crafted id cannot reach outside the cache. The extra
    containment check below is belt-and-braces against a bad row rather than a bad request.

    Before the conditional path existed, `If-None-Match` with the right etag still returned
    200 and the whole body — measured at 207,876 bytes for one thumbnail — so every board
    render re-read every image off disk and back down the socket.
    """
    asset = session.get(MediaAsset, asset_id)
    if asset is None or not asset.local_path:
        raise ApiError(404, "media_not_cached", "이미지가 캐시에 없어요.", recoverable=True)

    path = (REPO_ROOT / asset.local_path).resolve()
    cache_root = (REPO_ROOT / "var" / "media").resolve()
    if not path.is_relative_to(cache_root) or not path.exists():
        raise ApiError(404, "media_missing", "캐시된 파일이 없어요.", recoverable=True)

    # The bytes' own digest when the cache recorded one; otherwise the file's identity on
    # disk, which is what a re-download changes. Either way the etag follows the content,
    # never the row id.
    stat = path.stat()
    etag = f'"{asset.checksum or f"{stat.st_mtime_ns:x}-{stat.st_size:x}"}"'
    headers = {
        "ETag": etag,
        # `private` because this is one person's collected media on their own machine.
        "Cache-Control": f"private, max-age={MEDIA_MAX_AGE_SECONDS}, must-revalidate",
    }

    if _etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    return FileResponse(path, media_type="image/jpeg", headers=headers)


@app.get("/api/focus/{item_id}")
def focus(item_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Everything the Focus Canvas draws, in one request.

    One payload rather than four, so the screen cannot render research from one moment
    beside a trial from another. Absent sections are absent, never filled in.
    """

    from .focus import payload

    found = payload(session, item_id)
    if found is None:
        raise ApiError(404, "item_not_found", "그 항목을 찾을 수 없어요.", recoverable=False)
    return {"data": found}


@app.post("/api/research", status_code=202)
def research_start(
    body: dict[str, Any] | None = None, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """Research one item with NVIDIA AI-Q, in the background.

    Answers at once with a queued job; `GET /api/jobs/{id}` follows it. The target backend
    is resolved *before* anything is queued, so a non-local or malformed `AIQ_SERVER_URL`
    is refused here rather than discovered minutes later (`aiq-research/SKILL.md`: name
    the target before sending).
    """

    from ..research import runner as research_runner
    from ..research.aiq_client import (
        AiqUnavailable,
        describe_target,
        ensure_backend,
        resolve_server,
    )
    from . import background

    payload = body or {}
    item_id = str(payload.get("itemId") or "").strip()
    if not item_id:
        raise ApiError(422, "item_required", "조사할 항목을 지정해 주세요.", recoverable=True)
    item = session.get(Item, item_id)
    if item is None:
        raise ApiError(404, "item_not_found", "그 항목을 찾을 수 없어요.", recoverable=False)

    agent_type = str(payload.get("agentType") or "shallow_researcher")
    try:
        server_url = resolve_server()
        target = describe_target(server_url)
        ensure_backend(server_url)
    except AiqUnavailable as error:
        # Reachability is the user's to fix (start the backend, set AIQ_SERVER_URL), so it
        # is recoverable and the message carries the backend's own words.
        raise ApiError(503, "aiq_unavailable", str(error), recoverable=True) from error

    if background.busy("research"):
        raise ApiError(
            409,
            "research_busy",
            "다른 조사가 진행 중입니다. 끝난 뒤 다시 시도해 주세요.",
            recoverable=True,
        )

    job = research_runner.open_job(
        session, item_id=item_id, title=item.title or item.canonical_url, state="queued"
    )
    session.commit()
    job_id = job.id

    started = background.start(
        "research",
        job_id,
        lambda worker: research_runner.run(
            worker, item_id, agent_type=agent_type, server_url=server_url, job_id=job_id
        ),
        session_factory=_Session,
    )
    if not started:
        _abandon(session, job_id)
        raise ApiError(
            409,
            "research_busy",
            "다른 조사가 진행 중입니다. 끝난 뒤 다시 시도해 주세요.",
            recoverable=True,
        )
    return {"data": {"jobId": job_id, "state": "queued", "serverUrl": server_url, "target": target}}


#: The longest question this endpoint accepts.
#:
#: It is the one piece of free text this product sends off the machine that the user wrote
#: rather than chose, so it is bounded — a pasted document would become a prompt nobody
#: reviewed, and `api/focus.py` shows the brief before it is sent on the assumption that a
#: person can read it.
MAX_QUESTION_CHARS = 500


@app.post("/api/lab/questions", status_code=202)
def lab_question_start(
    body: dict[str, Any] | None = None, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """`What do you want to know?` — the question, and the plan AI-Q designs for it.

    The question is recorded synchronously and the planning pass runs in the background,
    so the screen can say "this is what you asked" the moment it answers, even if the pass
    later fails. Research has to exist first: the planning pass is given the earlier report
    for continuity, and without it the agent would be designing a check for a subject
    nobody has looked at.

    **Only a person reaches this.** The agent never picks a question — that is the whole
    asymmetry the Lab is built on (`무엇을 확인할지는 사람, 어떻게 확인할지는 Agent`).
    """

    from ..research import question as question_runner
    from ..research import runner as research_runner
    from ..research.aiq_client import (
        AiqUnavailable,
        describe_target,
        ensure_backend,
        resolve_server,
    )
    from . import background

    payload = body or {}
    item_id = str(payload.get("itemId") or "").strip()
    question = str(payload.get("question") or "").strip()
    if not item_id:
        raise ApiError(422, "item_required", "질문할 항목을 지정해 주세요.", recoverable=True)
    if not question:
        raise ApiError(
            422, "question_required", "무엇을 확인하고 싶은지 적어주세요.", recoverable=True
        )
    if len(question) > MAX_QUESTION_CHARS:
        raise ApiError(
            422,
            "question_too_long",
            f"질문은 {MAX_QUESTION_CHARS}자까지예요. 확인하고 싶은 한 가지로 좁혀 주세요.",
            recoverable=True,
        )

    item = session.get(Item, item_id)
    if item is None:
        raise ApiError(404, "item_not_found", "그 항목을 찾을 수 없어요.", recoverable=False)

    research = research_runner.latest(session, item_id)
    if not research or not research.get("report"):
        raise ApiError(
            409,
            "research_required",
            "먼저 조사를 실행해야 질문을 검증 계획으로 바꿀 수 있어요.",
            recoverable=True,
        )

    try:
        server_url = resolve_server()
        target = describe_target(server_url)
        ensure_backend(server_url)
    except AiqUnavailable as error:
        raise ApiError(503, "aiq_unavailable", str(error), recoverable=True) from error

    busy_error = ApiError(
        409,
        "plan_busy",
        "다른 검증 설계가 진행 중입니다. 끝난 뒤 다시 시도해 주세요.",
        recoverable=True,
    )
    if background.busy("plan"):
        raise busy_error

    # Before the job, and committed: a planning pass that dies still leaves the screen able
    # to say which question is open.
    question_runner.record_question(session, item_id, question)
    job = question_runner.open_job(
        session,
        item_id=item_id,
        title=item.title or item.canonical_url,
        question=question,
        state="queued",
    )
    session.commit()
    job_id = job.id

    started = background.start(
        "plan",
        job_id,
        lambda worker: question_runner.run(
            worker, item_id, question, server_url=server_url, job_id=job_id
        ),
        session_factory=_Session,
    )
    if not started:
        _abandon(session, job_id)
        raise busy_error
    return {
        "data": {
            "jobId": job_id,
            "state": "queued",
            "question": question,
            "serverUrl": server_url,
            "target": target,
        }
    }


def _abandon(session: Session, job_id: str) -> None:
    """A queued job that lost the race for its slot: removed, never shown."""
    from ..db.models import Job

    job = session.get(Job, job_id)
    if job is not None:
        session.delete(job)
        session.commit()


@app.post("/api/trials", status_code=202)
def trial_start(
    body: dict[str, Any] | None = None, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """Run an approved plan inside the OpenShell sandbox.

    `approved` is required and must be true. It is not a formality: running collected code
    was re-allowed only for a plan the user explicitly approved (docs/DECISIONS.md,
    2026-09-28), and the endpoint enforces that rather than trusting the caller to.

    Every precondition is checked here, synchronously, so a refusal comes back as a
    refusal. Only the run itself goes to the background (`api/background.py`); the
    answer is the queued job's id.
    """

    from ..sandbox import nemoclaw
    from ..sandbox import policy as sandbox_policy
    from ..sandbox import trial as trial_runner
    from . import background
    from .focus import current_suggestion

    payload = body or {}
    item_id = str(payload.get("itemId") or "").strip()
    if not item_id:
        raise ApiError(422, "item_required", "실행할 항목을 지정해 주세요.", recoverable=True)
    if payload.get("approved") is not True:
        raise ApiError(
            422,
            "approval_required",
            "사용자 승인 없이는 실행하지 않습니다.",
            recoverable=True,
        )

    item = session.get(Item, item_id)
    if item is None:
        raise ApiError(404, "item_not_found", "그 항목을 찾을 수 없어요.", recoverable=False)

    # The same composer the screen read, so the plan approved is the plan that runs.
    suggestion, _asked = current_suggestion(session, item)
    if suggestion is None:
        raise ApiError(
            409,
            "research_required",
            "먼저 조사를 실행해야 실행 계획이 생깁니다.",
            recoverable=True,
        )
    if not suggestion.actionable:
        raise ApiError(
            409,
            "no_plan",
            "조사 결과에 실행 가능한 단계가 없습니다.",
            recoverable=False,
        )

    busy_error = ApiError(
        409,
        "sandbox_busy",
        "다른 실행이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
        recoverable=True,
    )
    if background.busy("trial"):
        raise busy_error
    try:
        check = sandbox_policy.check(suggestion.plan)
    except nemoclaw.SandboxUnavailable as error:
        raise ApiError(503, "sandbox_unavailable", str(error), recoverable=True) from error
    if check.busy:
        raise busy_error
    if not check.satisfied:
        raise ApiError(
            409,
            "boundary_not_ready",
            "샌드박스 경계가 준비되지 않았습니다: "
            + (
                ", ".join(check.missing_presets)
                or check.reason
                or "샌드박스가 Ready 상태가 아닙니다"
            ),
            recoverable=True,
        )

    job = trial_runner.open_job(
        session, item_id=item_id, title=item.title or item.canonical_url, state="queued"
    )
    session.commit()
    job_id = job.id
    plan = suggestion.plan

    started = background.start(
        "trial",
        job_id,
        lambda worker: trial_runner.run(worker, plan, approved=True, job_id=job_id),
        session_factory=_Session,
    )
    if not started:
        _abandon(session, job_id)
        raise busy_error
    return {"data": {"jobId": job_id, "state": "queued", "policy": check.as_dict()}}


@app.get("/api/trials/{item_id}")
def trial_latest(item_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    """What the last trial left on this item. Polled by the Working Queue."""

    from ..sandbox import trial as trial_runner

    return {"data": trial_runner.latest(session, item_id)}


@app.get("/api/collection/schedule")
def collection_schedule(session: Session = Depends(get_session)) -> dict[str, Any]:
    from .schedule import describe

    # With the session, so the interval this reports is the one Settings has in force
    # rather than the one the file shipped with.
    return {"data": describe(session=session)}


#: Thumbnails downloaded per manual refresh.
#:
#: `cache_pending` has always accepted a limit and this endpoint never passed one, so the
#: button downloaded the entire backlog inside the request. Each asset carries a 20 s
#: socket timeout, which put the worst case for the 126 collected thumbnails at 42 minutes
#: of a held-open POST. Twelve bounds it at four minutes, and the response says how many
#: are still waiting so the UI can offer the button again rather than pretending the cache
#: is complete.
REFRESH_MEDIA_BATCH = 12


@app.post("/api/collection/refresh")
def collection_refresh(session: Session = Depends(get_session)) -> dict[str, Any]:
    """Re-read the capture files now, outside the schedule.

    Deliberately *not* a collector run: starting a browser session against four accounts
    from a web request is the kind of thing that should need a person present, and
    CLAUDE.md §10 keeps account access behind explicit approval. This picks up whatever
    the collectors have already written and refreshes the media cache — which is what
    makes the boards current, and what the button in the UI can honestly promise.
    """
    from ..ingest import cache_pending, ingest_all
    from .schedule import effective_document

    if not effective_document(session).collection.allow_manual_refresh:
        raise ApiError(
            409, "manual_refresh_disabled", "수동 새로고침이 꺼져 있어요.", recoverable=False
        )

    ingest = ingest_all(session)
    media = cache_pending(session, limit=REFRESH_MEDIA_BATCH)
    pending = (
        session.scalar(
            select(func.count()).select_from(MediaAsset).where(MediaAsset.local_path.is_(None))
        )
        or 0
    )
    return {
        "data": {
            "refreshedAt": generated_at(),
            "ingest": ingest.as_dict(),
            "media": media.as_dict(),
            # Includes the ones no download can recover — an expired signature needs a new
            # collector run — so this is "not on disk", not "will arrive next press".
            "mediaPending": pending,
        }
    }


@app.get("/api/collection/launchd")
def collection_launchd(session: Session = Depends(get_session)) -> dict[str, Any]:
    """The scheduled jobs, written to disk but never installed.

    Loading a job that opens four logged-in accounts on a timer has consequences for those
    accounts, so this writes the plists and hands back the commands. A person runs them,
    having seen what they do (CLAUDE.md §10).
    """
    from .launchd import install_commands, plan

    # `plan`, not `generate`: describing the jobs must not write them. This is a GET, and
    # since the System screen started rendering it, a write here meant that opening a page
    # rewrote six files. The install block's first line does the writing instead.
    jobs = plan(session=session)
    return {
        "data": {
            "jobs": [
                {
                    "label": job.label,
                    "collectorId": job.collector_id,
                    "runsAt": job.runs_at,
                    "path": str(job.path.relative_to(REPO_ROOT)),
                }
                for job in jobs
            ],
            "installed": False,
            "commands": install_commands(jobs),
        }
    }


@app.get("/api/today")
def today(session: Session = Depends(get_session)) -> dict[str, Any]:
    from .today import build_today

    return {"data": build_today(session)}


def _job_payload(session: Session, job: Any) -> dict[str, Any]:
    from ..db.models import JobStep

    steps = session.scalars(
        select(JobStep).where(JobStep.job_id == job.id).order_by(JobStep.ordinal)
    )
    return {
        "id": job.id,
        "type": job.type,
        "state": job.state,
        "targetId": job.target_id,
        "title": job.title,
        "currentStep": job.current_step,
        "cancellable": bool(job.cancellable),
        "startedAt": job.started_at,
        "finishedAt": job.finished_at,
        "steps": [
            {
                "id": step.id,
                "label": step.label,
                "state": step.state,
                "startedAt": step.started_at,
                "finishedAt": step.finished_at,
                "message": step.message,
            }
            for step in steps
        ],
    }


@app.get("/api/jobs")
def jobs(session: Session = Depends(get_session)) -> dict[str, Any]:
    """Every job on record.

    Rejecting the call instead took down every page in the workspace, because the shell
    asks for this on each render: an unimplemented endpoint must not become an unrelated
    screen's failure.
    """
    from ..db.models import Job

    return {
        "data": {
            "jobs": [
                _job_payload(session, job)
                for job in session.scalars(select(Job).order_by(Job.created_at.desc()))
            ]
        }
    }


@app.get("/api/jobs/{job_id}")
def job_detail(job_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    """One job, for the client component that polls a running research or trial."""
    from ..db.models import Job

    job = session.get(Job, job_id)
    if job is None:
        raise ApiError(404, "job_not_found", "그 작업을 찾을 수 없어요.", recoverable=False)
    return {"data": _job_payload(session, job)}


@app.get("/api/host/profile")
def host_profile() -> dict[str, Any]:
    """The Apple Silicon Mac currently running Taste Inbox, detected at request time.

    Never a stored device profile — CLAUDE.md §2 requires the limits to come from the host
    that is actually running. `to_public()` also drops `available_memory_gb`, which is a
    scheduling signal the UI has no business seeing.
    """
    from ..host.detector import MacOSHostProfileDetector

    return {"data": MacOSHostProfileDetector().detect().to_public().model_dump(by_alias=True)}


@app.get("/api/host/policy")
def host_policy() -> dict[str, Any]:
    """Limits derived from this host, right now."""
    from datetime import UTC, datetime

    from ..config.loader import load_resource_policy_document
    from ..host.detector import MacOSHostProfileDetector
    from ..host.policy import resolve_resource_policy

    profile = MacOSHostProfileDetector().detect()
    document = load_resource_policy_document()
    policy = resolve_resource_policy(profile, document.resource_policy, datetime.now(UTC))
    return {"data": policy.model_dump(by_alias=True)}


@app.get("/api/system/collectors")
def collectors(session: Session = Depends(get_session)) -> dict[str, Any]:
    """Every collector that has ever run, and where each one got to.

    Driven by `collector_runs`, with the checkpoint as a left join. It used to iterate
    `checkpoints`, which inverted the relationship: the checkpoint is a position a
    successful run left behind, so a collector whose only run was blocked had no row and
    was absent from this response entirely — the one state the screen exists to show was
    the one state it could not show.

    `notes` is what the run recorded about how it went. It has been written since
    ingestion existed and read by nothing, which is why a stopped run could only ever
    explain itself as a single `stoppedBecause` line.
    """
    from ..db.models import Checkpoint, CollectorRun

    rows = []
    for collector_id in session.scalars(
        select(CollectorRun.collector_id).distinct().order_by(CollectorRun.collector_id)
    ):
        checkpoint = session.get(Checkpoint, collector_id)
        latest = session.scalar(
            select(CollectorRun)
            .where(CollectorRun.collector_id == collector_id)
            .order_by(CollectorRun.started_at.desc())
        )
        rows.append(
            {
                "collectorId": collector_id,
                # Null means no run has ever been allowed to advance it, not zero progress.
                "lastSeenCode": None if checkpoint is None else checkpoint.last_seen_code,
                "lastOutcome": None if checkpoint is None else checkpoint.last_outcome,
                "updatedAt": None if checkpoint is None else checkpoint.updated_at,
                "lastRun": None
                if latest is None
                else {
                    "startedAt": latest.started_at,
                    "outcome": latest.outcome,
                    "stoppedBecause": latest.stopped_because,
                    "advancedCheckpoint": bool(latest.advanced_checkpoint),
                    "notes": json.loads(latest.notes or "[]"),
                },
            }
        )
    return {"data": {"collectors": rows}}


@app.get("/api/settings")
def settings_document(session: Session = Depends(get_session)) -> dict[str, Any]:
    """Every configured value, and which of the three layers produced it.

    The only endpoint whose subject is the configuration rather than what it produced.
    Eleven of its twelve values report `origin: "file"` on a fresh checkout, because there
    is no `config/app.yaml` and the loader falls through to the committed example — see
    `settings.py` for why that is a sentence the screen has to say out loud.
    """
    from .settings import build_document

    return {"data": build_document(session)}


@app.patch("/api/settings")
def settings_patch(
    payload: dict[str, Any] | None = None, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """Persist an override, having validated it through the models the loader uses.

    The body is `{"changes": {"collection.intervalHours": 6}}` — dotted keys, so a patch can
    name one leaf without restating the branches around it. A `null` value removes the
    override and hands the key back to the file. The response is the full refreshed
    document, because a change that was accepted and a change that had no effect must not
    look the same from here.
    """
    from .settings import apply_changes

    return {"data": apply_changes(session, payload)}


@app.get("/api/accounts")
def accounts_list(session: Session = Depends(get_session)) -> dict[str, Any]:
    """The GitHub and Hugging Face accounts this Mac collects, and how each last went."""
    from . import accounts

    return {"data": {"accounts": accounts.payload(session)}}


@app.put("/api/accounts/{platform}")
def account_connect(
    platform: str, body: dict[str, Any] | None = None, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """Name the account, and collect it at once.

    A name, not a login: all three surfaces are public. Collecting straight away is what makes
    connecting mean something — an account that waited four hours for its first run would
    look like a form that did nothing.
    """
    from . import accounts

    raw = str((body or {}).get("handle") or "")
    try:
        handle, changed = accounts.connect(session, platform, raw)
    except accounts.AccountRejected as error:
        raise ApiError(422, "account_rejected", str(error), recoverable=True) from error
    job_id = _start_collection(session, platform)
    return {
        "data": {
            "handle": handle,
            "changed": changed,
            "jobId": job_id,
            "accounts": accounts.payload(session),
        }
    }


@app.delete("/api/accounts/{platform}")
def account_disconnect(platform: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Stop collecting this platform. What was collected stays."""
    from . import accounts

    if platform not in accounts.PLATFORMS:
        raise ApiError(
            404, "account_not_found", "연결할 수 있는 출처가 아니에요.", recoverable=False
        )
    accounts.disconnect(session, platform)
    return {"data": {"accounts": accounts.payload(session)}}


@app.post("/api/accounts/{platform}/collect", status_code=202)
def account_collect(platform: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Collect now, without waiting for the interval."""
    from . import accounts

    if platform not in accounts.PLATFORMS:
        raise ApiError(
            404, "account_not_found", "연결할 수 있는 출처가 아니에요.", recoverable=False
        )
    if accounts.handle_of(session, platform) is None:
        raise ApiError(
            409, "account_not_connected", "먼저 계정명을 입력해 주세요.", recoverable=True
        )
    job_id = _start_collection(session, platform)
    if job_id is None:
        raise ApiError(
            409,
            "collection_busy",
            "다른 수집이 진행 중이에요. 끝난 뒤 다시 시도해 주세요.",
            recoverable=True,
        )
    return {"data": {"jobId": job_id, "state": "queued"}}


@app.get("/api/profile")
def profile_get(session: Session = Depends(get_session)) -> dict[str, Any]:
    """The workspace owner's display name, and whether first-run setup is done."""
    from . import profile

    return {"data": profile.payload(session)}


@app.put("/api/profile")
def profile_put(
    body: dict[str, Any] | None = None, session: Session = Depends(get_session)
) -> dict[str, Any]:
    from . import profile

    try:
        profile.set_name(session, str((body or {}).get("name") or ""))
    except profile.OnboardingRejected as error:
        raise ApiError(422, "profile_rejected", error.message, recoverable=True) from error
    return {"data": profile.payload(session)}


@app.post("/api/onboarding")
def onboarding(
    body: dict[str, Any] | None = None, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """First-run setup, all at once: name, accounts, interval — then the first collection.

    Validated whole before anything is stored (`api/profile.py`). A refusal names the field
    in `error.code` (`onboarding_<field>`) so the form can put the sentence under the right
    input.
    """
    from . import accounts, profile
    from .settings import apply_changes

    try:
        name, handles, interval = profile.validate(body or {})
    except profile.OnboardingRejected as error:
        raise ApiError(422, f"onboarding_{error.field}", error.message, recoverable=True) from error
    try:
        apply_changes(session, {"changes": {"collection.intervalHours": interval}})
    except ApiError as error:
        raise ApiError(
            422, "onboarding_intervalHours", str(error.detail), recoverable=True
        ) from error
    for platform, handle in handles.items():
        accounts.connect(session, platform, handle)
    profile.set_name(session, name)
    job_ids = _start_collections(session, list(handles))
    return {
        "data": {
            "profile": profile.payload(session),
            "accounts": accounts.payload(session),
            "jobIds": job_ids,
        }
    }


@app.patch("/api/settings/sources/{platform}")
def source_setting_patch(
    platform: str, payload: dict[str, Any] | None = None, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """Record that the user turned a source off — which stops no collection today.

    `source_accounts.enabled` has no reader anywhere, so this writes a value nothing acts
    on. That is deliberate rather than overlooked: the switch ships `editable: false` and
    the payload never claims an effect, so the record exists without the screen pretending
    it did something.
    """
    from .settings import set_source_enabled

    return {"data": set_source_enabled(session, platform, payload)}


def cache_root() -> Path:
    return REPO_ROOT / "var" / "media"
