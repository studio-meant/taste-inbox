"""`failed` and `rate_limited` as run outcomes — what the API collectors actually report

The inherited constraint allowed four outcomes (`ok`, `auth_required`, `blocked`, `empty`),
which is what the browser collectors could report. The API collectors report two more: a
404 for an account that does not exist is `failed`, and GitHub's hourly ceiling is
`rate_limited`. Until this migration either one made ingest raise on the constraint and roll
back the whole capture file — so the run that most needed recording, the one that failed,
was the one that left no row, and Settings could not say why an account collected nothing.

Additive. SQLite rebuilds a table to change a CHECK.

Revision ID: a7c3e9f15d20
Revises: f4b2d81e6c03
Create Date: 2026-09-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7c3e9f15d20"
down_revision = "f4b2d81e6c03"
branch_labels = None
depends_on = None

OLD = ("ok", "auth_required", "blocked", "empty")
NEW = (*OLD, "failed", "rate_limited")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{value}'" for value in values) + ")"


def _rebuild(outcomes: tuple[str, ...]) -> None:
    with op.batch_alter_table("collector_runs") as batch:
        batch.drop_constraint("ck_collector_runs_outcome", type_="check")
        batch.create_check_constraint(
            "ck_collector_runs_outcome", sa.text(_in("outcome", outcomes))
        )
    with op.batch_alter_table("checkpoints") as batch:
        batch.drop_constraint("ck_checkpoints_outcome", type_="check")
        batch.create_check_constraint(
            "ck_checkpoints_outcome", sa.text(_in("last_outcome", (*outcomes, "never_run")))
        )


def upgrade() -> None:
    _rebuild(NEW)


def downgrade() -> None:
    # The narrower constraint cannot hold these rows. Runs are history, not data the user
    # collected, so they go; a checkpoint's outcome falls back to "never_run".
    # S608: built from this module's constant tuple; nothing is input.
    op.execute(sa.text(f"DELETE FROM collector_runs WHERE NOT ({_in('outcome', OLD)})"))  # noqa: S608
    op.execute(
        sa.text(
            "UPDATE checkpoints SET last_outcome = 'never_run' "  # noqa: S608
            f"WHERE NOT ({_in('last_outcome', OLD)})"
        )
    )
    _rebuild(OLD)
