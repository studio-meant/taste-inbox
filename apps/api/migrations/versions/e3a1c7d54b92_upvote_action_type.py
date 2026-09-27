"""`upvote` as a source action type

The Hugging Face paper-upvote surface records a signal the inherited CHECK rejects. It is
deliberately not folded into `like`: a like is on a model, dataset or Space, an upvote is
on a paper, and the papers that arrive through the *likes* cycle keep `like` because
nobody upvoted those (`api_sources/huggingface/papers.py`). Collapsing the two would make
"the user upvoted this paper" indistinguishable from "a model the user liked cites it".

SQLite cannot alter a CHECK in place, so the table is rebuilt through batch mode. The
rewrite is additive — every existing value stays legal — so no row needs migrating.

Revision ID: e3a1c7d54b92
Revises: d2f8b6c1a047
Create Date: 2026-09-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e3a1c7d54b92"
down_revision = "d2f8b6c1a047"
branch_labels = None
depends_on = None

OLD_ACTIONS = ("star", "like", "save", "repost")
NEW_ACTIONS = ("star", "like", "upvote", "save", "repost")


def _in(column: str, values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{value}'" for value in values)
    return f"{column} IS NULL OR {column} IN ({joined})"


def _rebuild(actions: tuple[str, ...]) -> None:
    with op.batch_alter_table("item_sources") as batch:
        batch.drop_constraint("ck_item_sources_action_type", type_="check")
        batch.create_check_constraint(
            "ck_item_sources_action_type", sa.text(_in("action_type", actions))
        )


def upgrade() -> None:
    _rebuild(NEW_ACTIONS)


def downgrade() -> None:
    # Rows written under the wider constraint would violate the narrower one. The signal is
    # real, so it is demoted to the nearest legal value rather than deleted — a collected
    # upvote is not worth losing to a schema rollback.
    op.execute(sa.text("UPDATE item_sources SET action_type = 'like' WHERE action_type = 'upvote'"))
    _rebuild(OLD_ACTIONS)
