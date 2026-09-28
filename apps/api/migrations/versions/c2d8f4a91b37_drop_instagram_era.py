"""Drop the Instagram era — its tables, and the values only it produced

This tree collects from GitHub and Hugging Face. What Instagram, Threads and LinkedIn needed
— cached media with expiring signed URLs, authors and the shop links in their bios, the
`save`/`repost` actions, the `product`/`outfit` kinds, and the `build`/`run`/`price`/`cleanup`
job types nothing produces — goes, and each CHECK narrows to what can actually be written.

`item_sources.collection_name` goes too. It held the Instagram Saved collection an item was
filed into, and it was the third column of the membership key — so with it null for every
row, a paper reached by a Hugging Face like *and* an upvote could keep only whichever came
first, although `docs/DECISIONS.md` §업보트 says both are kept. The key becomes
`(item, account, action)`.

**It deletes nothing.** If any row still holds one of the removed values, or the dropped
tables are not empty, the upgrade stops and says which — those rows are somebody's data, and
removing them is their decision (CLAUDE.md §11), not a migration's side effect.

SQLite rebuilds a table to change a CHECK.

Revision ID: c2d8f4a91b37
Revises: a7c3e9f15d20
Create Date: 2026-09-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c2d8f4a91b37"
down_revision = "a7c3e9f15d20"
branch_labels = None
depends_on = None

OLD_PLATFORMS = ("github", "huggingface", "arxiv", "threads", "linkedin", "instagram", "web")
NEW_PLATFORMS = ("github", "huggingface", "arxiv", "web")

OLD_ACTIONS = ("star", "like", "upvote", "save", "repost")
NEW_ACTIONS = ("star", "like", "upvote")

OLD_KINDS = (
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
NEW_KINDS = ("repo", "model", "dataset", "space", "paper", "demo", "tool", "post")

OLD_JOB_TYPES = (
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
NEW_JOB_TYPES = ("collection", "enrichment", "research", "plan", "trial")

DROPPED_TABLES = ("author_links", "authors", "media_assets")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{value}'" for value in values) + ")"


#: `(what, count query)` for every row the narrower schema could not hold.
#: S608: every clause is built from this module's constant tuples; nothing is input.
_BLOCKERS: tuple[tuple[str, str], ...] = (
    (
        "items on Instagram, Threads or LinkedIn",
        f"SELECT COUNT(*) FROM items WHERE NOT ({_in('platform', NEW_PLATFORMS)})",  # noqa: S608
    ),
    (
        "items of kind product or outfit",
        f"SELECT COUNT(*) FROM items WHERE NOT ({_in('kind', NEW_KINDS)})",  # noqa: S608
    ),
    (
        "accounts on Instagram, Threads or LinkedIn",
        f"SELECT COUNT(*) FROM source_accounts WHERE NOT ({_in('platform', NEW_PLATFORMS)})",  # noqa: S608
    ),
    (
        "raw events from Instagram, Threads or LinkedIn",
        f"SELECT COUNT(*) FROM raw_events WHERE NOT ({_in('platform', NEW_PLATFORMS)})",  # noqa: S608
    ),
    (
        "saves or reposts",
        "SELECT COUNT(*) FROM item_sources "  # noqa: S608
        f"WHERE action_type IS NOT NULL AND NOT ({_in('action_type', NEW_ACTIONS)})",
    ),
    (
        "build, run, price or cleanup jobs",
        f"SELECT COUNT(*) FROM jobs WHERE NOT ({_in('type', NEW_JOB_TYPES)})",  # noqa: S608
    ),
    *((f"rows in {table}", f"SELECT COUNT(*) FROM {table}") for table in DROPPED_TABLES),  # noqa: S608
    (
        "memberships filed into a collection",
        "SELECT COUNT(*) FROM item_sources WHERE collection_name IS NOT NULL",
    ),
    (
        "memberships the new key would merge",
        "SELECT COUNT(*) FROM (SELECT 1 FROM item_sources "
        "GROUP BY item_id, source_account_id, action_type HAVING COUNT(*) > 1)",
    ),
)


def _refuse_if_anything_would_be_lost() -> None:
    bind = op.get_bind()
    found = [
        f"{int(count)} {what}"
        for what, query in _BLOCKERS
        if (count := bind.execute(sa.text(query)).scalar() or 0)
    ]
    if found:
        raise RuntimeError(
            "This database still holds Instagram-era data this version cannot store: "
            + "; ".join(found)
            + ". Back it up and remove those rows yourself, or stay on revision a7c3e9f15d20."
        )


def _rebuild(
    platforms: tuple[str, ...],
    actions: tuple[str, ...],
    kinds: tuple[str, ...],
    job_types: tuple[str, ...],
) -> None:
    with op.batch_alter_table("source_accounts") as batch:
        batch.drop_constraint("ck_source_accounts_platform", type_="check")
        batch.create_check_constraint(
            "ck_source_accounts_platform", sa.text(_in("platform", platforms))
        )
    with op.batch_alter_table("raw_events") as batch:
        batch.drop_constraint("ck_raw_events_platform", type_="check")
        batch.create_check_constraint("ck_raw_events_platform", sa.text(_in("platform", platforms)))
    with op.batch_alter_table("items") as batch:
        batch.drop_constraint("ck_items_platform", type_="check")
        batch.create_check_constraint("ck_items_platform", sa.text(_in("platform", platforms)))
        batch.drop_constraint("ck_items_kind", type_="check")
        batch.create_check_constraint("ck_items_kind", sa.text(_in("kind", kinds)))
    with op.batch_alter_table("item_sources") as batch:
        batch.drop_constraint("ck_item_sources_action_type", type_="check")
        batch.create_check_constraint(
            "ck_item_sources_action_type",
            sa.text(f"action_type IS NULL OR {_in('action_type', actions)}"),
        )
    with op.batch_alter_table("jobs") as batch:
        batch.drop_constraint("ck_jobs_type", type_="check")
        batch.create_check_constraint("ck_jobs_type", sa.text(_in("type", job_types)))


def upgrade() -> None:
    _refuse_if_anything_would_be_lost()
    for table in DROPPED_TABLES:
        op.drop_table(table)
    _rebuild(NEW_PLATFORMS, NEW_ACTIONS, NEW_KINDS, NEW_JOB_TYPES)
    with op.batch_alter_table("item_sources") as batch:
        batch.drop_index("idx_item_sources_collection")
        batch.drop_constraint("uq_item_sources_membership", type_="unique")
        batch.drop_column("collection_name")
        batch.create_unique_constraint(
            "uq_item_sources_membership", ["item_id", "source_account_id", "action_type"]
        )


def downgrade() -> None:
    # Widening loses nothing, and the tables come back empty — exactly as the upgrade found
    # them, since it refuses to run over rows.
    with op.batch_alter_table("item_sources") as batch:
        batch.drop_constraint("uq_item_sources_membership", type_="unique")
        batch.add_column(sa.Column("collection_name", sa.String(length=64), nullable=True))
        batch.create_unique_constraint(
            "uq_item_sources_membership", ["item_id", "source_account_id", "collection_name"]
        )
        batch.create_index("idx_item_sources_collection", ["collection_name", "position"])
    _rebuild(OLD_PLATFORMS, OLD_ACTIONS, OLD_KINDS, OLD_JOB_TYPES)
    op.create_table(
        "media_assets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("remote_url", sa.Text(), nullable=True),
        sa.Column("remote_expires_at", sa.String(length=32), nullable=True),
        sa.Column("local_path", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=True),
        sa.Column("checksum", sa.String(length=64), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("alt_text", sa.Text(), nullable=True),
        sa.Column("fetched_at", sa.String(length=32), nullable=True),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("item_id", "role", name="uq_media_item_role"),
    )
    op.create_table(
        "authors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("platform", sa.String(length=32), nullable=False),
        sa.Column("handle", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("biography", sa.Text(), nullable=True),
        sa.Column("checked_at", sa.String(length=32), nullable=True),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("platform", "handle", name="uq_authors_platform_handle"),
    )
    op.create_table(
        "author_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["author_id"], ["authors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("author_id", "kind", "value", name="uq_author_links_value"),
    )
