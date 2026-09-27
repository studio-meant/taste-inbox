"""API-source item kinds and evidence provenance

The official-API collectors produce two things the inherited CHECK constraints reject:
Hugging Face repository types (`dataset`, `space`), and evidence whose provenance names
the machine that produced it rather than the kind of claim it is.

SQLite cannot alter a CHECK in place, so both tables are rebuilt through batch mode. The
rewrite is additive — every existing value stays legal — so no row needs migrating and the
downgrade only narrows the constraint back.

Revision ID: c1d4e7a90b31
Revises: 27c56b2fbadd
Create Date: 2026-09-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c1d4e7a90b31"
down_revision = "27c56b2fbadd"
branch_labels = None
depends_on = None

OLD_KINDS = ("repo", "model", "paper", "demo", "tool", "post", "product", "outfit")
NEW_KINDS = (
    "repo",
    "model",
    "dataset",
    "space",
    "paper",
    "demo",
    "tool",
    "post",
    "product",
    "outfit",
)

OLD_PROVENANCE = ("fact", "inference", "external")
NEW_PROVENANCE = (
    "fact",
    "inference",
    "external",
    "huggingface",
    "aiq",
    "sandbox",
    "policy",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({joined})"


def _rebuild(kinds: tuple[str, ...], provenance: tuple[str, ...]) -> None:
    with op.batch_alter_table("items") as batch:
        batch.drop_constraint("ck_items_kind", type_="check")
        batch.create_check_constraint("ck_items_kind", sa.text(_in("kind", kinds)))
    with op.batch_alter_table("evidence") as batch:
        batch.drop_constraint("ck_evidence_provenance", type_="check")
        batch.create_check_constraint(
            "ck_evidence_provenance", sa.text(_in("provenance", provenance))
        )


def upgrade() -> None:
    _rebuild(NEW_KINDS, NEW_PROVENANCE)


def downgrade() -> None:
    # Rows written under the wider constraint would violate the narrower one, so they are
    # removed rather than silently left behind a constraint that no longer describes them.
    # S608: the clauses are built from this module's constant tuples; nothing is input.
    kinds = _in("kind", OLD_KINDS)
    provenance = _in("provenance", OLD_PROVENANCE)
    op.execute(sa.text(f"DELETE FROM items WHERE NOT ({kinds})"))  # noqa: S608
    op.execute(sa.text(f"DELETE FROM evidence WHERE NOT ({provenance})"))  # noqa: S608
    _rebuild(OLD_KINDS, OLD_PROVENANCE)
