"""research and trial job types

The two long-running things this product now does. Neither fits an inherited name:
`enrichment` reads a public API about one item, while research asks an agent a question
and returns citations; `build` and `run` belonged to the sandbox runner removed on
2026-08-09, and reusing them would make a trial indistinguishable in the jobs table from
the feature that was deleted for being unsafe.

Additive, so nothing needs migrating. SQLite rebuilds the table to change a CHECK.

Revision ID: d2f8b6c1a047
Revises: c1d4e7a90b31
Create Date: 2026-09-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d2f8b6c1a047"
down_revision = "c1d4e7a90b31"
branch_labels = None
depends_on = None

OLD_TYPES = ("collection", "enrichment", "build", "run", "price", "cleanup")
NEW_TYPES = (
    "collection",
    "enrichment",
    "research",
    "trial",
    "build",
    "run",
    "price",
    "cleanup",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{value}'" for value in values) + ")"


def _rebuild(types: tuple[str, ...]) -> None:
    with op.batch_alter_table("jobs") as batch:
        batch.drop_constraint("ck_jobs_type", type_="check")
        batch.create_check_constraint("ck_jobs_type", sa.text(_in("type", types)))


def upgrade() -> None:
    _rebuild(NEW_TYPES)


def downgrade() -> None:
    # S608: built from this module's constant tuple; nothing is input.
    op.execute(sa.text(f"DELETE FROM jobs WHERE NOT ({_in('type', OLD_TYPES)})"))  # noqa: S608
    _rebuild(OLD_TYPES)
