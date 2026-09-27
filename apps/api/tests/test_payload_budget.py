"""What one card costs in SQL statements, held to a measured number.

A board renders every item it holds, so a helper added to `to_*_card` never costs one
query — it costs one per card, and the difference only shows up on the machine with the
whole collection on it. Nothing here asserts that a board is *fast*; it asserts that the
per-card cost is a number somebody wrote down.

The test measures the **slope**, not the total: eight cards minus four cards is four
cards' worth of statements, so the board query and any other fixed cost cancel. That makes
the failure message specific — a fifth helper in `to_music_card` fails with 28 against 24,
and the fix is to change the constant on purpose rather than to discover the cost later as
a slow screen.

Counted on 2026-08-09 with a `before_cursor_execute` listener, and cross-checked against
the helper calls in `api/cards.py`.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.api.cards import (
    BOARD_COLLECTIONS,
    board_query,
    load_authors,
    to_ai_card,
    to_music_card,
    to_style_card,
)
from taste_inbox.db.models import (
    Author,
    AuthorLink,
    Base,
    Item,
    ItemSource,
    SourceAccount,
)

#: Statements one card of each board costs.
#:
#: - `trends` and `style` — `_media`, `tags_of`, `_links`, and `_membership` by way of
#:   `_source_ref`.
#: - `music` — those same four minus `tags_of`, plus `_cover_read` and both halves of
#:   `_music_candidates`: `_attribution_candidates` and `_cover_candidates` read different
#:   evidence types and each asks for its own.
PER_CARD_QUERIES: dict[str, int] = {"trends": 4, "style": 4, "music": 6}

BUILDERS: dict[str, Callable[[Session, Item], dict[str, Any]]] = {
    "trends": to_ai_card,
    "style": to_style_card,
    "music": to_music_card,
}

STAMP = "2026-08-09T12:00:00Z"


def _fill(session: Session, board: str, count: int) -> None:
    """`count` items filed onto `board`, with nothing enriched.

    Bare rows on purpose. Every helper issues its query whether or not there is anything to
    find, so the count being measured is a property of the code rather than of how much has
    been collected — which is what makes it stable enough to assert.
    """
    account = SourceAccount(
        platform="instagram",
        handle=None,
        label="Instagram Saved",
        enabled=1,
        state="collected",
        connected_at=STAMP,
    )
    session.add(account)
    session.flush()

    for ordinal in range(count):
        item = Item(
            id=f"{board}-{ordinal}",
            kind="post",
            platform="instagram",
            platform_item_id=f"{board}{ordinal}",
            canonical_url=f"https://www.instagram.com/p/{board}{ordinal}/",
            body_text="본문",
            author="someone",
            first_seen_at=STAMP,
            updated_at=STAMP,
        )
        session.add(item)
        session.add(
            ItemSource(
                item_id=item.id,
                source_account_id=account.id,
                action_type="save",
                collection_name=BOARD_COLLECTIONS[board],
                position=ordinal,
                first_seen_at=STAMP,
            )
        )
    session.commit()


@contextmanager
def _counting(engine: Engine) -> Iterator[list[str]]:
    """Every statement the engine sends while the block runs.

    At the cursor rather than at the ORM, so a lazy load nobody wrote is counted the same
    as an explicit `select()`.
    """
    statements: list[str] = []

    def record(
        _connection: Any,
        _cursor: Any,
        statement: str,
        _parameters: Any,
        _context: Any,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def _statements(board: str, count: int) -> int:
    """Statements issued while building a whole board of `count` cards."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as session:
        _fill(session, board, count)
        with _counting(engine) as statements:
            cards = [BUILDERS[board](session, item) for item in session.scalars(board_query(board))]
        assert len(cards) == count
    return len(statements)


@pytest.mark.parametrize("board", sorted(PER_CARD_QUERIES))
def test_each_extra_card_costs_exactly_the_queries_it_is_budgeted(board: str) -> None:
    small = _statements(board, 4)
    large = _statements(board, 8)
    assert large - small == 4 * PER_CARD_QUERIES[board]


@pytest.mark.parametrize("board", sorted(PER_CARD_QUERIES))
def test_the_board_itself_is_one_query_however_many_items_it_holds(board: str) -> None:
    # The fixed half of the cost. If listing a board ever became a query per item, the
    # slope test above would still pass while the page got twice as expensive.
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as session:
        _fill(session, board, 8)
        with _counting(engine) as statements:
            assert len(list(session.scalars(board_query(board)))) == 8
    assert len(statements) == 1


def _with_distinct_authors(count: int) -> tuple[int, int]:
    """Statements for a `style` board of `count` cards, each by a different account.

    Returns the cost with the page batched and without it. The distinction matters because
    `_fill` gives every item the same handle and no `Author` row at all — a regression to a
    lookup per card would still slope at zero there, and the board would quietly go back to
    one query per post.
    """
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    costs = []
    for batched in (True, False):
        with sessionmaker(engine)() as session:
            _fill(session, "style", count)
            for ordinal, item in enumerate(session.scalars(board_query("style"))):
                item.author = f"shop{ordinal}"
                author = Author(
                    platform="instagram",
                    handle=f"shop{ordinal}",
                    display_name=f"가게{ordinal}",
                    checked_at=STAMP,
                    updated_at=STAMP,
                )
                session.add(author)
                session.flush()
                session.add(
                    AuthorLink(
                        author_id=author.id,
                        kind="link",
                        value=f"https://shop{ordinal}.example.kr/",
                        title="바로가기",
                        ordinal=0,
                    )
                )
            session.commit()

            rows = list(session.scalars(board_query("style")))
            with _counting(engine) as statements:
                if batched:
                    load_authors(session, rows)
                cards = [to_style_card(session, item) for item in rows]
            assert all(card["author"]["links"] for card in cards)
            costs.append(len(statements))
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
    return costs[0], costs[1]


def test_a_page_of_distinct_authors_costs_the_same_as_a_page_of_one() -> None:
    # Two queries for the whole page — the accounts and their links — however many
    # accounts the page holds. The real board is 61 accounts behind 76 posts.
    four, _ = _with_distinct_authors(4)
    eight, _ = _with_distinct_authors(8)
    assert eight - four == 4 * PER_CARD_QUERIES["style"]


def test_skipping_the_batch_is_what_costs_a_query_per_author() -> None:
    # The other half of the claim: without `load_authors` the same page pays per card, so
    # the test above is measuring the batch rather than an author lookup that was never
    # issued.
    batched, unbatched = _with_distinct_authors(8)
    assert unbatched > batched
