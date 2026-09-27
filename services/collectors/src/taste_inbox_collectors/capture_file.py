"""The file a collector writes, and the only way its work reaches a screen.

`apps/api` reads these; the two packages never import each other. The collector knows
nothing about the database and the ingester knows nothing about HTTP — the collected items
travel between them as JSON on disk and the checkpoint travels back as an argv string.
That seam is inherited deliberately: it is what lets these tests run with no database and
the ingester's tests run with no network.

**The shape is not ours to choose.** `taste_inbox.ingest.captures.ingest_browser_file`
already reads exactly this document, so matching it is what makes the API collectors work
with an ingester nobody had to change. Field names here are the ones that function reads.

**A failed run is written too.** A capture file is how a run reaches
`checkpoints.last_outcome` and from there the Today screen, so a rate-limited or
unauthorised run must produce a file exactly as hard as a good one does. Writing nothing
is indistinguishable from never having run.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

#: How a run ended. `ok` and `failed` are this package's; the rest are inherited names the
#: API and the Today screen already know how to render.
Outcome = Literal["ok", "auth_required", "blocked", "failed", "rate_limited"]


@dataclass(slots=True)
class SourceItem:
    """One collected signal, in the shape the database stores.

    Field names match `apps/api/.../db/models.py` so ingestion is a rename-free copy.
    Anything the API does not tell us stays `None` rather than being derived — a value
    this package invented would be indistinguishable downstream from one a platform said.
    """

    platform: str
    platform_item_id: str
    canonical_url: str
    kind: str
    title: str | None = None
    body_text: str | None = None
    owner: str | None = None
    source_published_at: str | None = None
    #: When the *user* acted — starred, liked. The inherited browser collectors always left
    #: this null because the rendered pages never show it; both APIs here do say it, which
    #: is the single biggest thing these collectors buy over their browser ancestors.
    action_at: str | None = None
    tags: list[str] = field(default_factory=list)
    outbound_urls: list[str] = field(default_factory=list)
    #: Facts the source *stated*, each with where it was read, in the shape of the
    #: inherited `evidence` table. Empty for a starred repository, which declares nothing
    #: beyond itself; populated for a paper, whose document names its code, its models and
    #: its datasets. Kept here rather than derived later because the provenance —
    #: `githubRepoAddedBy` saying `auto` or naming a person — only exists at this moment.
    evidence: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class SourceRun:
    """How one collection cycle went."""

    surface: str
    started_at: str = field(default_factory=lambda: _now())
    outcome: Outcome = "ok"
    items: list[SourceItem] = field(default_factory=list)
    #: Pages actually fetched. Named `scroll_passes` because that is the column the
    #: inherited schema has; for an API collector a page is what a scroll was.
    pages: int = 0
    #: True when the listing ran out before any cap did — i.e. we saw everything.
    exhausted: bool = False
    #: The newest platform id this run saw. Only meaningful when the run may advance.
    checkpoint: str | None = None
    #: A run may move the stored position only if it reached the previous one. A truncated
    #: run that advanced anyway would make the next run stop at the top and never look
    #: into the gap it left.
    advanced_checkpoint: bool = False
    stopped_because: str = ""
    notes: list[str] = field(default_factory=list)

    def note(self, message: str) -> None:
        self.notes.append(message)

    def as_document(self) -> dict[str, Any]:
        return {
            "run": {
                "started_at": self.started_at,
                "finished_at": _now(),
                "outcome": self.outcome,
                "scroll_passes": self.pages,
                "exhausted": self.exhausted,
                "advanced_checkpoint": self.advanced_checkpoint,
                "checkpoint": self.checkpoint,
                "stopped_because": self.stopped_because,
                "notes": self.notes,
                "items_seen": len(self.items),
            },
            "items": [item.as_dict() for item in self.items],
        }


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def capture_path(surface: str, directory: Path) -> Path:
    return directory / f"{surface}.json"


def write_capture(run: SourceRun, directory: Path) -> Path:
    """Write the run's document, atomically.

    Atomic because the ingester may be reading the previous file at the same moment the
    scheduler starts the next run, and a half-written document is the one failure this
    seam cannot report — it looks like corrupt data rather than a collection problem.
    """

    directory.mkdir(parents=True, exist_ok=True)
    destination = capture_path(run.surface, directory)
    body = json.dumps(run.as_document(), ensure_ascii=False, indent=2) + "\n"

    handle, temporary = tempfile.mkstemp(dir=directory, prefix=f".{run.surface}.", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(body)
        Path(temporary).replace(destination)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    return destination


def summarise(run: SourceRun) -> dict[str, Any]:
    """The one-line result a caller prints. Never the items themselves."""

    return {
        "surface": run.surface,
        "outcome": run.outcome,
        "items": len(run.items),
        "pages": run.pages,
        "exhausted": run.exhausted,
        "advanced_checkpoint": run.advanced_checkpoint,
        "stopped_because": run.stopped_because,
    }


__all__ = [
    "Outcome",
    "SourceItem",
    "SourceRun",
    "capture_path",
    "summarise",
    "write_capture",
]
