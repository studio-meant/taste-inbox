"""What one card costs in SQL statements, held to a measured number.

The Inbox renders every item it holds, so a helper added to `to_ai_card` never costs one
query — it costs one per card, and the difference only shows up on the machine with the
whole collection on it. Nothing here asserts that the Inbox is *fast*; it asserts that the
per-card cost is a number somebody wrote down.

The test measures the **slope**, not the total: eight cards minus four cards is four
cards' worth of statements, so the list query and any other fixed cost cancel. That makes
the failure message specific, and the fix is to change the constant on purpose rather than
to discover the cost later as a slow screen.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.api.cards import inbox_query, to_ai_card
from taste_inbox.db.models import Base, Item, ItemSource, SourceAccount

#: Statements one card costs: `tags_of`, `_links`, and `_membership` by way of `_source_ref`.
PER_CARD_QUERIES = 3

STAMP = "2026-09-28T12:00:00Z"


def _fill(session: Session, count: int) -> None:
    """`count` starred repositories, with nothing enriched.

    Bare rows on purpose. Every helper issues its query whether or not there is anything to
    find, so the count being measured is a property of the code rather than of how much has
    been collected — which is what makes it stable enough to assert.
    """
    account = SourceAccount(
        platform="github",
        handle=None,
        label="GitHub",
        enabled=1,
        state="collected",
        connected_at=STAMP,
    )
    session.add(account)
    session.flush()

    for ordinal in range(count):
        item = Item(
            id=f"repo-{ordinal}",
            kind="repo",
            platform="github",
            platform_item_id=str(ordinal),
            canonical_url=f"https://github.com/someone/repo{ordinal}",
            title=f"someone/repo{ordinal}",
            first_seen_at=STAMP,
            updated_at=STAMP,
        )
        session.add(item)
        session.add(
            ItemSource(
                item_id=item.id,
                source_account_id=account.id,
                action_type="star",
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


def _statements(count: int) -> int:
    """Statements issued while building an Inbox of `count` cards."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as session:
        _fill(session, count)
        with _counting(engine) as statements:
            cards = [to_ai_card(session, item) for item in session.scalars(inbox_query())]
        assert len(cards) == count
    return len(statements)


def test_each_extra_card_costs_exactly_the_queries_it_is_budgeted() -> None:
    assert _statements(8) - _statements(4) == 4 * PER_CARD_QUERIES


def test_the_list_itself_is_one_query_however_many_items_it_holds() -> None:
    # The fixed half of the cost. If listing ever became a query per item, the slope test
    # above would still pass while the page got twice as expensive.
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as session:
        _fill(session, 8)
        with _counting(engine) as statements:
            assert len(list(session.scalars(inbox_query()))) == 8
    assert len(statements) == 1
