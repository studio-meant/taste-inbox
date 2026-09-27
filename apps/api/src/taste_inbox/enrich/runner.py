"""Run the enrichers over stored items.

Separate from collection on purpose: `CLAUDE.md` §7 — "Collect minimal raw data first;
enrichment runs as a separate job" and "A failed enricher must not invalidate successful
collection". Nothing here touches `raw_events`, and an enricher that throws leaves the item
exactly as it was found.

What it writes:

- `items.checked_at` — the moment an enricher actually looked. Until then it is null, and
  every card reads "아직 확인하지 않았어요" because that is true.
- `evidence` rows for each declared fact, so the card can show why it says what it says.
Not a compatibility verdict. Deciding whether a repository would run here went with the
sandbox runner (docs/DECISIONS.md, 2026-08-09); what the repository *states* is still worth
recording, and stating it is all this does.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Evidence, Item
from ..host.detector import MacOSHostProfileDetector
from ..host.models import HostProfile
from .github import GitHubRepositoryProvider, owner_and_repo
from .providers import RepositoryFacts, RepositoryProvider, Unavailable

#: Evidence types this writes, so a re-run can replace its own output and nothing else.
ENRICHED_TYPES = ("declared_fact",)

#: Types this enricher used to write and no longer does.
#:
#: Listed so a re-run clears them. Removing a feature stops it producing rows; it does not
#: remove the rows already produced, and those kept rendering on the item detail page with
#: copy about an execution the product no longer performs.
RETIRED_TYPES = ("compatibility_verdict",)


@dataclass(slots=True)
class EnrichReport:
    considered: int = 0
    enriched: int = 0
    unavailable: int = 0
    skipped: int = 0
    verdicts: dict[str, int] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "considered": self.considered,
            "enriched": self.enriched,
            "unavailable": self.unavailable,
            "skipped": self.skipped,
            "verdicts": self.verdicts,
            "reasons": self.reasons[:10],
        }


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def repository_targets(session: Session) -> list[tuple[Item, str]]:
    """Items with a repository to read — the item's own URL, or one found in it.

    A LinkedIn post whose comments linked a repository is as good a target as a star: the
    repository is what gets assessed, and the post is where it was found. That is the whole
    point of keeping links as evidence.
    """
    targets: list[tuple[Item, str]] = []
    seen: set[str] = set()

    for item in session.scalars(select(Item).where(Item.platform == "github")):
        if owner_and_repo(item.canonical_url) and item.canonical_url not in seen:
            seen.add(item.canonical_url)
            targets.append((item, item.canonical_url))

    rows = session.execute(
        select(Item, Evidence.value)
        .join(Evidence, Evidence.item_id == Item.id)
        .where(Evidence.type.in_(("artifact_link", "comment_artifact_link")))
    ).all()
    for item, url in rows:
        if owner_and_repo(str(url)) and str(url) not in seen:
            seen.add(str(url))
            targets.append((item, str(url)))

    return targets


def _replace_enriched(session: Session, item: Item) -> None:
    session.query(Evidence).filter(
        Evidence.item_id == item.id, Evidence.type.in_(ENRICHED_TYPES + RETIRED_TYPES)
    ).delete(synchronize_session=False)


def enrich_repositories(
    session: Session,
    *,
    provider: RepositoryProvider | None = None,
    host: HostProfile | None = None,
    limit: int | None = None,
    force: bool = False,
) -> EnrichReport:
    """Read each repository's declarations and record what follows from them."""
    reader = provider or GitHubRepositoryProvider()
    profile = host or MacOSHostProfileDetector().detect().to_public()
    report = EnrichReport()

    targets = repository_targets(session)
    for item, url in targets if limit is None else targets[:limit]:
        report.considered += 1

        if item.checked_at is not None and not force:
            # Already looked. Re-reading every night would spend the unauthenticated rate
            # limit on answers that have not changed.
            report.skipped += 1
            continue

        try:
            facts = reader.fetch(url)
        except Exception as error:
            # An enricher that throws must not invalidate the collection it read from.
            report.unavailable += 1
            report.reasons.append(f"{url}: {type(error).__name__}")
            continue

        if isinstance(facts, Unavailable):
            report.unavailable += 1
            report.reasons.append(f"{url}: {facts.reason}")
            continue

        _record(session, item, url, facts, profile, report)

    session.commit()
    return report


def _record(
    session: Session,
    item: Item,
    url: str,
    facts: RepositoryFacts,
    host: HostProfile,
    report: EnrichReport,
) -> None:
    _replace_enriched(session, item)
    stamp = _now()

    for fact in facts.facts:
        session.add(
            Evidence(
                item_id=item.id,
                type="declared_fact",
                label=fact.label,
                value=fact.value,
                # What the repository says about itself is an observation, and the only
                # kind of thing recorded here.
                provenance="fact",
                source_url=fact.source_url or url,
                observed_at=stamp,
            )
        )

    # Only now, and only for this item: `checked_at` is the promise that something looked.
    item.checked_at = stamp
    item.updated_at = stamp
    report.enriched += 1


__all__ = ["ENRICHED_TYPES", "EnrichReport", "enrich_repositories", "repository_targets"]
