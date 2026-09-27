"""Change which board one item is on.

The second write in this product, and the first that touches collected data rather than
configuration. `PATCH /api/settings` stores a preference; this restates a fact about an item
the user saved, so the shape is deliberately the same and the stakes are not.

## Why it exists

Instagram's saved *collections* stopped answering on 2026-08-09, so new items arrive as
Likes carrying no filing at all and `enrich/classify.py` infers the board. Measured against
the 126 saves the user had already filed themselves, the classifier agrees on 120 — which
means roughly one item in twenty lands somewhere the user would not have put it.

The user was offered a badge distinguishing "you filed this" from "we guessed this" and
declined it, asking for one thing instead:

    "그냥 카테고리를 수정할 수 있는 기능만 추가해줘. 그럼 인스타그램 카테고리에 포함된
     것만 내가 훑어보다 수정하면 되잖아."

So there is no second field and no provenance flag. There is one column, `collection_name`,
and it is editable. The classifier writes it, the user overwrites it, and
`api/cards.py::board_filter` — which never learned the difference — keeps working.

## What a write means

**The board is a property of the item, not of one membership row.** An item can hold several
rows in `item_sources` (one Instagram post can sit in two Saved collections; a Saved and a
Liked row can describe the same post), and a request that moved only one of them would leave
the item on two boards at once — `board_query` joins `item_sources` and returns a row per
match. So every membership moves, and rows that collide are collapsed exactly the way
`enrich/classify.py::_assign` collapses them.

**`none` is a first-class destination.** It is not "clear the field": null already means
"nobody has decided yet", and handing a corrected item back to that state would put it in
front of the classifier again on the next run for an answer the user has just overruled.
Choosing `none` records the decision and puts the item on the shelf at `/none`, where it can
be found again.

**The response is the whole refreshed item**, for the reason `apply_changes` returns the
whole settings document: a change that was accepted and a change that had no effect must not
look the same from here. `board` comes back read off the database through the same
`board_of` every other reader uses, so the answer is what the boards will actually do rather
than an echo of the request.
"""

from __future__ import annotations

from typing import Any, NoReturn

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Item, ItemSource
from .app import ApiError
from .cards import BOARD_COLLECTIONS, DECLINED_BOARD, DECLINED_COLLECTION, to_item_detail

#: Every board a person may move an item onto, and the `collection_name` each is stored as.
#:
#: Built from `BOARD_COLLECTIONS` rather than restated, so a board added there is writable
#: here without an edit — and, more importantly, so this endpoint can never accept a name no
#: board reads. A value that reached the column without a matching board would put the item
#: nowhere, with nothing on any screen able to say where it went.
WRITABLE_BOARDS: dict[str, str] = {**BOARD_COLLECTIONS, DECLINED_BOARD: DECLINED_COLLECTION}


def _requested_board(payload: dict[str, Any] | None) -> str:
    """Read `{"board": "music"}`, or refuse in a sentence a screen can show.

    The rejection names the offending value and lists what is allowed, for the reason
    `settings.py::_rejected` does: the error envelope carries only `code`, `message` and
    `recoverable`, so a refusal that does not say what was wrong is not actionable.
    """
    board = payload.get("board") if isinstance(payload, dict) else None
    if isinstance(board, str) and board in WRITABLE_BOARDS:
        return board
    allowed = " · ".join(WRITABLE_BOARDS)
    _reject(f"'{board}'는 보드 이름이 아니에요. {allowed} 중 하나여야 해요.")


def _reject(message: str) -> NoReturn:
    raise ApiError(422, "board_rejected", message, recoverable=True)


def set_item_board(
    session: Session, item_id: str, payload: dict[str, Any] | None
) -> dict[str, Any]:
    """Move one item onto one board, and answer with the item as it now stands."""
    item = session.get(Item, item_id)
    if item is None:
        # The same code and sentence `GET /api/items/{id}` answers with, so a stale card and
        # a stale bookmark fail identically.
        raise ApiError(404, "item_not_found", "그 항목을 찾을 수 없어요.", recoverable=False)

    board = _requested_board(payload)
    collection = WRITABLE_BOARDS[board]

    rows = list(
        session.scalars(
            select(ItemSource).where(ItemSource.item_id == item_id).order_by(ItemSource.id)
        )
    )
    if not rows:
        # Not 422 and not 404: the request is well formed and the item exists, but nothing
        # records how it was collected, so there is no membership to move. Ingestion always
        # writes one, so this is a corrupt row rather than anything the user did — hence
        # `recoverable: false` and a sentence that does not ask them to try again.
        raise ApiError(
            409,
            "item_has_no_source",
            "이 항목에는 수집 기록이 없어서 보드를 정할 수 없어요.",
            recoverable=False,
        )

    # `item_sources` is unique on `(item_id, source_account_id, collection_name)`. Moving two
    # rows of the same account onto the same board violates that index, and the rows are
    # genuinely redundant once they agree — the second one would put the item on the board
    # twice. The oldest survives, which is the same resolution `_assign` chose and for the
    # same reason: the earliest row is the one whose `first_seen_at` dated the item.
    settled: set[tuple[int, str]] = set()
    survivors: list[ItemSource] = []
    for row in rows:
        key = (row.source_account_id, collection)
        if key in settled:
            session.delete(row)
            continue
        survivors.append(row)
        settled.add(key)

    # Delete collisions before changing the surviving row. SQLAlchemy is free to flush an
    # UPDATE before a DELETE at commit time; when the destination membership already
    # exists, that ordering momentarily creates two identical unique keys and SQLite
    # rejects the otherwise valid move. The explicit flush makes the two phases match the
    # operation's meaning: collapse redundant memberships first, then rename the survivor.
    session.flush()
    for row in survivors:
        row.collection_name = collection

    # `get_session` never commits — every writer in this codebase commits for itself.
    session.commit()

    return to_item_detail(session, item)


__all__ = ["WRITABLE_BOARDS", "set_item_board"]
