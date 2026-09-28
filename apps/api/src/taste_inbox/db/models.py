"""The local database.

Every enum below is a `CHECK` constraint whose members are copied from a zod schema in
`packages/shared/src/domain/` rather than invented here — the two languages describe one
product, and a value the frontend cannot represent must not be storable.

The Instagram-era tables — cached media, authors and their shop links — and the platforms,
kinds and actions only Instagram, Threads and LinkedIn produced were removed on 2026-09-28
(migration c2d8f4a91b37, docs/DECISIONS.md), with the Saved-collection column.
"""

from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# Copied from packages/shared/src/domain/common.ts. Kept as tuples so the CHECK
# constraints and any future validation read from one list.
#: `arxiv` and `web` are reached only by a link a person adds by hand (`api/manual_items.py`).
PLATFORMS = ("github", "huggingface", "arxiv", "web")
# `upvote` joined on 2026-09-28 with the Hugging Face paper-upvote surface. It is not a
# synonym for `like`: a like is on a model, dataset or Space, an upvote is on a paper, and
# the papers that arrive through the *likes* cycle still carry `like` because nobody
# upvoted those (`api_sources/huggingface/papers.py`).
ACTION_TYPES = ("star", "like", "upvote")
# `dataset` and `space` joined on 2026-09-28: the Hugging Face likes endpoint returns
# `repo.type` as one of model|dataset|space, and folding a dataset into `model` would
# lose the distinction the Inbox filters on. `post` is a web page added by hand.
ITEM_KINDS = ("repo", "model", "dataset", "space", "paper", "demo", "tool", "post")
# The first three say what *kind* of claim a row is; the four added on 2026-09-28 say
# *who made it*, which is a different question this product now has to answer on screen.
# A sandbox observation and an AI-Q citation are both facts, and a card that drew them
# identically would hide the one thing a reader needs — whether the machine ran it or a
# research agent read it somewhere.
EVIDENCE_PROVENANCE = (
    "fact",
    "inference",
    "external",
    "huggingface",
    "aiq",
    "sandbox",
    "policy",
)

# packages/shared/src/domain/today.ts
SOURCE_STATES = ("collected", "skipped", "auth_required", "failed", "disabled")

# services/collectors/.../capture_file.py — Outcome, plus `empty`.
# `failed` and `rate_limited` joined on 2026-09-28: the API collectors report them, and
# without them a failed run's capture was rolled back whole (migration a7c3e9f15d20).
RUN_OUTCOMES = ("ok", "auth_required", "blocked", "empty", "failed", "rate_limited")

# packages/shared/src/domain/job.ts
JOB_STATES = (
    "queued",
    "running",
    "succeeded",
    "partially_succeeded",
    "failed",
    "cancelled",
    "blocked",
)
# `research` and `trial` joined on 2026-09-28. They are the two long-running things this
# product now does: `enrichment` reads a public API about one item, while research asks an
# agent a question and comes back with citations. The inherited `build`/`run` (the removed
# sandbox runner), `price` (Style's shop lookups) and `cleanup` (the media cache) went on
# the same day, because nothing produces them.
JOB_TYPES = (
    "collection",
    "enrichment",
    "research",
    # The pass that turns a user's question into a verification goal, acceptance criteria
    # and a trial plan (2026-09-28, `research/question.py`). Its own type because a failed
    # planning pass is not a failed research run and must not read as one.
    "plan",
    "trial",
)
JOB_STEP_STATES = ("waiting", "running", "done", "failed", "skipped")


def _in(column: str, values: tuple[str, ...]) -> str:
    """Render a CHECK body, so a constraint cannot drift from its tuple."""
    allowed = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({allowed})"


# --------------------------------------------------------------- collection


class SourceAccount(Base):
    """A connected account, one per platform-and-handle."""

    __tablename__ = "source_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    #: Null for a platform with no account of its own, such as arXiv.
    handle: Mapped[str | None] = mapped_column(String(255))
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled: Mapped[bool] = mapped_column(Integer, nullable=False, default=0)
    connected_at: Mapped[str | None] = mapped_column(String(32))
    last_ok_at: Mapped[str | None] = mapped_column(String(32))
    state: Mapped[str] = mapped_column(String(32), nullable=False, default="disabled")

    __table_args__ = (
        UniqueConstraint("platform", "handle", name="uq_source_accounts_platform_handle"),
        CheckConstraint(_in("platform", PLATFORMS), name="ck_source_accounts_platform"),
        CheckConstraint(_in("state", SOURCE_STATES), name="ck_source_accounts_state"),
    )


class Checkpoint(Base):
    """Where the next incremental run should stop.

    One row per collector entry — `huggingface_upvotes`, never a union of surfaces — so one
    collector stopping never moves another's position.
    """

    __tablename__ = "checkpoints"

    collector_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_account_id: Mapped[int | None] = mapped_column(ForeignKey("source_accounts.id"))
    #: Newest platform id known to be collected. Everything above it has been seen.
    last_seen_code: Mapped[str | None] = mapped_column(String(64))
    last_outcome: Mapped[str] = mapped_column(String(32), nullable=False, default="never_run")
    updated_at: Mapped[str] = mapped_column(String(32), nullable=False)

    __table_args__ = (
        CheckConstraint(
            _in("last_outcome", (*RUN_OUTCOMES, "never_run")),
            name="ck_checkpoints_outcome",
        ),
    )


class CollectorRun(Base):
    """One invocation of one collector.

    `advanced_checkpoint` records whether this run was allowed to move the checkpoint. It
    exists because the rule is not obvious: an interrupted run harvests a contiguous block
    from the newest item down to wherever it stopped, and advancing the checkpoint would
    make the next run stop at the top and never look into the gap. Without this column the
    repeated work looks like a bug and gets "fixed" back into data loss.
    """

    __tablename__ = "collector_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    collector_id: Mapped[str] = mapped_column(String(64), nullable=False)
    outcome: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[str] = mapped_column(String(32), nullable=False)
    finished_at: Mapped[str | None] = mapped_column(String(32))
    scroll_passes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exhausted: Mapped[bool] = mapped_column(Integer, nullable=False, default=0)
    advanced_checkpoint: Mapped[bool] = mapped_column(Integer, nullable=False, default=0)
    stopped_because: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: JSON array of the run's notes.
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    items_seen: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    items_new: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        CheckConstraint(_in("outcome", RUN_OUTCOMES), name="ck_collector_runs_outcome"),
        Index("idx_runs_collector", "collector_id", "started_at"),
    )


class RawEvent(Base):
    """The observation exactly as it arrived, and never edited afterwards.

    Enrichment writes to `items`, never here. When a derived value turns out to be wrong,
    the original is still on disk to check the derivation against.

    Cookies, auth headers, tokens and full HTML never reach this column
    (`docs/SECURITY_BOUNDARIES.md`).
    """

    __tablename__ = "raw_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("collector_runs.id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    platform_item_id: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    observed_at: Mapped[str] = mapped_column(String(32), nullable=False)

    __table_args__ = (
        UniqueConstraint("run_id", "platform", "platform_item_id", name="uq_raw_events_run_item"),
        CheckConstraint(_in("platform", PLATFORMS), name="ck_raw_events_platform"),
    )


# -------------------------------------------------------------------- items


class Item(Base):
    """The normalized thing, independent of which platform surfaced it.

    Five separate time columns, because collapsing them produces claims nobody made
    (`docs/PAGE_SPECIFICATIONS.md` §2, which gives "오늘 오전 2시에 좋아요함" as the
    thing to avoid when `action_at` is unknown):

    - `first_seen_at` — when Taste Inbox first observed it. Always known.
    - `source_published_at` — when the original was posted. Often known.
    - `action_at` — when the user starred, liked or upvoted. The APIs supply it; a link
      added by hand has none, and it is never guessed.
    - `checked_at` — when an enricher last verified a derived value. Null until one runs.
    - `updated_at` — when this row last changed.

    Identity is `(platform, platform_item_id)`. `canonical_url` is also unique but is
    *derived* — a renamed repository keeps its id and gets a new URL. Two rows colliding
    on it is a genuine duplicate to merge, not a key clash.
    """

    __tablename__ = "items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    platform_item_id: Mapped[str] = mapped_column(String(128), nullable=False)
    canonical_url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(Text)
    #: The description or abstract, verbatim. Untrusted third-party text.
    body_text: Mapped[str | None] = mapped_column(Text)
    #: The owner — `cloudflare`, `nvidia`. Shown on every card as attribution. Null where
    #: the platform does not name one.
    author: Mapped[str | None] = mapped_column(String(255))
    first_seen_at: Mapped[str] = mapped_column(String(32), nullable=False)
    source_published_at: Mapped[str | None] = mapped_column(String(32))
    action_at: Mapped[str | None] = mapped_column(String(32))
    checked_at: Mapped[str | None] = mapped_column(String(32))
    updated_at: Mapped[str] = mapped_column(String(32), nullable=False)

    sources: Mapped[list[ItemSource]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )
    tags: Mapped[list[ItemTag]] = relationship(cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("platform", "platform_item_id", name="uq_items_platform_id"),
        UniqueConstraint("canonical_url", name="uq_items_canonical_url"),
        CheckConstraint(_in("kind", ITEM_KINDS), name="ck_items_kind"),
        CheckConstraint(_in("platform", PLATFORMS), name="ck_items_platform"),
        Index("idx_items_first_seen", "first_seen_at"),
    )


class ItemSource(Base):
    """Which signal surfaced an item.

    Separate from `items` because one item can be reached by more than one signal — a paper
    liked through a model and upvoted on its own page is one `items` row and two rows here,
    each keeping its own action and time. So the key is the action, not only the account.
    """

    __tablename__ = "item_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False)
    source_account_id: Mapped[int] = mapped_column(ForeignKey("source_accounts.id"), nullable=False)
    action_type: Mapped[str | None] = mapped_column(String(16))
    #: Position in the feed, which is save order rather than publish order.
    position: Mapped[int | None] = mapped_column(Integer)
    first_seen_at: Mapped[str] = mapped_column(String(32), nullable=False)
    action_at: Mapped[str | None] = mapped_column(String(32))

    item: Mapped[Item] = relationship(back_populates="sources")

    __table_args__ = (
        UniqueConstraint(
            "item_id", "source_account_id", "action_type", name="uq_item_sources_membership"
        ),
        CheckConstraint(
            f"action_type IS NULL OR {_in('action_type', ACTION_TYPES)}",
            name="ck_item_sources_action_type",
        ),
    )


class ItemTag(Base):
    """Topics as the source wrote them — a repository's topics, a model card's tags.

    A table rather than a JSON column so a tag-derived filter can be indexed.
    """

    __tablename__ = "item_tags"

    item_id: Mapped[str] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    tag: Mapped[str] = mapped_column(String(128), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (Index("idx_item_tags_tag", "tag"),)


class Evidence(Base):
    """What a derived value is based on.

    `provenance` separating fact from inference is a trust requirement, not bookkeeping
    (`docs/DESIGN.md` §3.5): the UI must be able to show the observed string next to any
    value guessed from it.
    """

    __tablename__ = "evidence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    provenance: Mapped[str] = mapped_column(String(16), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    observed_at: Mapped[str | None] = mapped_column(String(32))
    confidence: Mapped[float | None] = mapped_column()

    __table_args__ = (
        CheckConstraint(_in("provenance", EVIDENCE_PROVENANCE), name="ck_evidence_provenance"),
        CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="ck_evidence_confidence",
        ),
        Index("idx_evidence_item", "item_id"),
    )


# --------------------------------------------------------------------- jobs


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    state: Mapped[str] = mapped_column(String(32), nullable=False)
    target_id: Mapped[str | None] = mapped_column(ForeignKey("items.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    current_step: Mapped[str | None] = mapped_column(String(128))
    cancellable: Mapped[bool] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[str | None] = mapped_column(String(32))
    finished_at: Mapped[str | None] = mapped_column(String(32))

    __table_args__ = (
        CheckConstraint(_in("type", JOB_TYPES), name="ck_jobs_type"),
        CheckConstraint(_in("state", JOB_STATES), name="ck_jobs_state"),
        Index("idx_jobs_state", "state", "created_at"),
    )


class JobStep(Base):
    __tablename__ = "job_steps"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[str | None] = mapped_column(String(32))
    finished_at: Mapped[str | None] = mapped_column(String(32))
    message: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(_in("state", JOB_STEP_STATES), name="ck_job_steps_state"),
        Index("idx_job_steps_job", "job_id", "ordinal"),
    )


class JobEvent(Base):
    __tablename__ = "job_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    at: Mapped[str] = mapped_column(String(32), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    message: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("idx_job_events_job", "job_id", "at"),)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(String(32), nullable=False)
