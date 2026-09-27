"""The local database.

Thirteen tables, reviewed before they were written. Every enum below is a `CHECK`
constraint whose members are copied from a zod schema in `packages/shared/src/domain/`
rather than invented here — the two languages describe one product, and a value the
frontend cannot represent must not be storable.

Four entities named in `docs/SYSTEM_ARCHITECTURE.md` are deliberately absent:
`classifications`, `ai_analyses`, `style_analyses` and `prepared_actions`. Each belongs to
an enricher that does not exist yet, and an empty table invites code that
pretends it has data.
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
PLATFORMS = ("github", "huggingface", "arxiv", "threads", "linkedin", "instagram", "web")
# `upvote` joined on 2026-09-28 with the Hugging Face paper-upvote surface. It is not a
# synonym for `like`: a like is on a model, dataset or Space, an upvote is on a paper, and
# the papers that arrive through the *likes* cycle still carry `like` because nobody
# upvoted those (`api_sources/huggingface/papers.py`).
ACTION_TYPES = ("star", "like", "upvote", "save", "repost")
# `dataset` and `space` joined on 2026-09-28: the Hugging Face likes endpoint returns
# `repo.type` as one of model|dataset|space, and folding a dataset into `model` would
# lose the distinction the board filters on.
ITEM_KINDS = (
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

# services/collectors/.../browser/guards.py — RunOutcome
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
# product now does, and neither fits the inherited names: `enrichment` reads a public API
# about one item, while research asks an agent a question and comes back with citations;
# `build`/`run` were the removed sandbox runner's, and reusing them would make a trial
# indistinguishable from the feature that was deleted for being unsafe.
JOB_TYPES = (
    "collection",
    "enrichment",
    "research",
    # The pass that turns a user's question into a verification goal, acceptance criteria
    # and a trial plan (2026-09-28, `research/question.py`). Its own type because a failed
    # planning pass is not a failed research run and must not read as one.
    "plan",
    "trial",
    "build",
    "run",
    "price",
    "cleanup",
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

    One row per collector entry — `instagram_saved_ai`, never a union of collections. The
    collection an item was saved into is the user's own classification and the only one in
    this product that is a fact, so it is never collapsed away (docs/DECISIONS.md).
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
    (`docs/SECURITY_BOUNDARIES.md`). The payload is written only after the collector's
    `redact()` has run, which also strips the signed media URL.
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
    - `action_at` — when the user starred/liked/saved. GitHub supplies it; Instagram
      Saved does not, so it is null for all 126 collected items and is never backfilled.
    - `checked_at` — when an enricher last verified a derived value. Null until one runs.
    - `updated_at` — when this row last changed.

    Identity is `(platform, platform_item_id)`. `canonical_url` is also unique but is
    *derived* — an Instagram permalink is `/reel/` or `/p/` depending on `product_type`,
    so a corrected product type rewrites the URL for an item whose identity did not
    change. Two rows colliding on it is a genuine duplicate to merge, not a key clash.
    """

    __tablename__ = "items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    platform_item_id: Mapped[str] = mapped_column(String(128), nullable=False)
    canonical_url: Mapped[str] = mapped_column(Text, nullable=False)
    #: GitHub has a repository name; an Instagram post has none.
    title: Mapped[str | None] = mapped_column(Text)
    #: The caption or description, verbatim. Untrusted third-party text.
    body_text: Mapped[str | None] = mapped_column(Text)
    #: The account that posted it — `@sample_owner`, `cloudflare`. Shown on every card as
    #: attribution, so dropping it made the live board strictly worse than the fixture it
    #: replaced. Null where the platform does not name one.
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
    media: Mapped[list[MediaAsset]] = relationship(cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("platform", "platform_item_id", name="uq_items_platform_id"),
        UniqueConstraint("canonical_url", name="uq_items_canonical_url"),
        CheckConstraint(_in("kind", ITEM_KINDS), name="ck_items_kind"),
        CheckConstraint(_in("platform", PLATFORMS), name="ck_items_platform"),
        Index("idx_items_first_seen", "first_seen_at"),
    )


class ItemSource(Base):
    """Which signal surfaced an item, and which collection the user filed it into.

    Separate from `items` for two reasons that both arrive later: one post can sit in more
    than one Saved collection, and a GitHub star and an Instagram save can eventually
    point at the same project. Either case would need a schema change if this were a
    column.

    `collection_name` **used to mean** "the user filed this here", and was the only
    classification in this product that was a fact rather than an inference. Since
    2026-08-12 it means **"this item's board, however it got one"** — Instagram's saved
    collections stopped answering, so new items arrive as Likes with no filing at all and
    `enrich/classify.py` writes the same column. The user was offered a separate inferred
    field and declined it (`docs/DECISIONS.md`), which is why `api/cards.py::board_filter`
    needed no change.

    The distinction is not gone, only weaker: `action_type = "save"` is the user's own
    filing and `action_type = "like"` is the classifier's answer. `collection_name` alone no
    longer says which.
    """

    __tablename__ = "item_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False)
    source_account_id: Mapped[int] = mapped_column(ForeignKey("source_accounts.id"), nullable=False)
    action_type: Mapped[str | None] = mapped_column(String(16))
    #: `ai` | `music` | `fashion` | `places`, from the user's own filing or from
    #: `enrich/classify.py`; `none` where the classifier looked and found no board, which is
    #: deliberately different from null — null means nobody has decided yet.
    collection_name: Mapped[str | None] = mapped_column(String(64))
    #: Position in the feed, which is save order rather than publish order.
    position: Mapped[int | None] = mapped_column(Integer)
    first_seen_at: Mapped[str] = mapped_column(String(32), nullable=False)
    action_at: Mapped[str | None] = mapped_column(String(32))

    item: Mapped[Item] = relationship(back_populates="sources")

    __table_args__ = (
        UniqueConstraint(
            "item_id", "source_account_id", "collection_name", name="uq_item_sources_membership"
        ),
        CheckConstraint(
            f"action_type IS NULL OR {_in('action_type', ACTION_TYPES)}",
            name="ck_item_sources_action_type",
        ),
        Index("idx_item_sources_collection", "collection_name", "position"),
    )


class ItemTag(Base):
    """Hashtags as the author wrote them.

    A table rather than a JSON column because these are the one axis that can actually
    separate the collected items today — every other filter group is uniform across all
    126 — so a tag-derived filter needs to be indexable.
    """

    __tablename__ = "item_tags"

    item_id: Mapped[str] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    tag: Mapped[str] = mapped_column(String(128), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (Index("idx_item_tags_tag", "tag"),)


class MediaAsset(Base):
    """A cached image, and the expiring URL it came from.

    `remote_url` is a reference, never the durable one: Instagram signs its media URLs
    with an expiry, and every one of the 126 collected thumbnails expires 2026-08-12.
    `local_path` is what the UI reads once the cache exists.
    """

    __tablename__ = "media_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="thumbnail")
    remote_url: Mapped[str | None] = mapped_column(Text)
    remote_expires_at: Mapped[str | None] = mapped_column(String(32))
    local_path: Mapped[str | None] = mapped_column(Text)
    byte_size: Mapped[int | None] = mapped_column(Integer)
    checksum: Mapped[str | None] = mapped_column(String(64))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    alt_text: Mapped[str | None] = mapped_column(Text)
    fetched_at: Mapped[str | None] = mapped_column(String(32))

    __table_args__ = (UniqueConstraint("item_id", "role", name="uq_media_item_role"),)


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


class Author(Base):
    """A person whose post was collected, and what their profile says about them.

    A separate table because an author is not a property of one post. Measured on the
    Style board: 76 saved posts came from 61 accounts, so a bio read once answers for
    several items — and every future post from an account already here costs nothing.

    That matters because the bio is where the purchase route lives. Almost none of those
    76 posts carries a link; the shop is a Linktree-style page or a `@brand.official`
    mention in the profile (docs/DECISIONS.md, 2026-08-09).

    `checked_at` is the promise that a profile was actually read. Null means nobody has
    looked, which is different from an account whose bio really is empty — the same
    distinction every other enricher in this product draws.
    """

    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    #: As the platform spells it. The join key back to `items.author`.
    handle: Mapped[str] = mapped_column(String(255), nullable=False)
    #: The name shown above the bio — "주연" where the handle is `juuuyeonn`. Often unset.
    display_name: Mapped[str | None] = mapped_column(String(255))
    #: Verbatim. Untrusted third-party text: stored and rendered, never parsed.
    biography: Mapped[str | None] = mapped_column(Text)
    checked_at: Mapped[str | None] = mapped_column(String(32))
    updated_at: Mapped[str] = mapped_column(String(32), nullable=False)

    links: Mapped[list[AuthorLink]] = relationship(cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("platform", "handle", name="uq_authors_platform_handle"),)


class AuthorLink(Base):
    """One destination a profile points at, with the label its owner gave it.

    The label is the point. Instagram lets an account title each link, and the titles are
    what separate one shop from another — on a real profile `컬러위드클로젯 바로가기` and
    `international shipping` are two storefronts for one brand, and the bare hosts
    (`cwithc.co.kr`, `colorwithcloset.cafe24.com`) say neither.

    A mentioned account (`@brand.official`) is stored here too, as `kind="mention"`,
    because it is a lead worth keeping — but never rewritten into a URL. Whether that
    handle is the brand, a collaborator or a friend is something the bio does not say.
    """

    __tablename__ = "author_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    author_id: Mapped[int] = mapped_column(
        ForeignKey("authors.id", ondelete="CASCADE"), nullable=False
    )
    #: `link` — somewhere to go. `mention` — somebody to look at.
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="link")
    #: A URL for `link`, a bare handle for `mention`.
    value: Mapped[str] = mapped_column(Text, nullable=False)
    #: The author's own title. Null for `external_url` and for URLs found in bio prose.
    title: Mapped[str | None] = mapped_column(Text)
    #: Position in the profile's own list, so the card can show them in that order.
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("author_id", "kind", "value", name="uq_author_links_value"),)
