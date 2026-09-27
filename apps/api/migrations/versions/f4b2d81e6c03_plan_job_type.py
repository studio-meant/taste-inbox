"""`plan` job type — the pass that turns a question into a trial

A third long-running thing, and it is not either of the two already here. `research` asks
what a subject is; `plan` asks how to check one specific thing a person wants to know about
it, and answers with a verification goal, acceptance criteria and a trial plan
(`research/question.py`). Folding it into `research` would put it in the Research panel's
job slot and make a failed planning pass read as a failed research run.

Additive, so nothing needs migrating. SQLite rebuilds the table to change a CHECK.

Revision ID: f4b2d81e6c03
Revises: e3a1c7d54b92
Create Date: 2026-09-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f4b2d81e6c03"
down_revision = "e3a1c7d54b92"
branch_labels = None
depends_on = None

OLD_TYPES = (
    "collection",
    "enrichment",
    "research",
    "trial",
    "build",
    "run",
    "price",
    "cleanup",
)
NEW_TYPES = (
    "collection",
    "enrichment",
    "research",
    "plan",
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
    # The job rows go; the evidence they wrote (`lab.question`, `lab.plan_report`) stays,
    # because the question is the user's and the plan is a real answer to it. Losing the
    # history of *when* a plan was made is the cheaper half of the rollback.
    # S608: built from this module's constant tuple; nothing is input.
    op.execute(sa.text(f"DELETE FROM jobs WHERE NOT ({_in('type', OLD_TYPES)})"))  # noqa: S608
    _rebuild(OLD_TYPES)
