"""Copy expiring thumbnails onto disk before their URLs stop working.

Instagram signs every media URL, and the signature is enforced. Verified directly against
the collected batch: the URL as captured returns 200, changing one character of the `oe`
expiry returns 403, and stripping the query returns 403. The batch collected on 2026-08-08
stops working on 2026-08-12.

**The post itself does not go anywhere.** Re-opening it yields a fresh signed URL, so an
expired thumbnail is recoverable — this cache prevents re-work, not loss. What it buys:

- No extra browser session against the account just to refresh images, which is the thing
  worth minimising.
- Boards that keep working between collection runs, and offline.
- Independence from a CDN that can rate-limit or reshape URLs at any time.

Boundaries this respects (`docs/SECURITY_BOUNDARIES.md`):

- The cache lives under the gitignored `var/` tree and never enters Git.
- It is bounded: a per-file cap, and a total budget that is this host's share under the
  resource policy rather than a number picked here — both enforced before writing.
- It does not grow across re-collections: files nothing points at are swept.
- Nothing is sent anywhere. This is a read of a URL the collector already observed.
"""

from __future__ import annotations

import hashlib
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import MediaAsset
from ..paths import REPO_ROOT

MEDIA_ROOT: Path = REPO_ROOT / "var" / "media"

#: These are full-size post photographs, not only thumbnails. A verified 3276x4094 JPEG
#: is 4,233,065 bytes and failed the former 4 MiB cap. Keep the read bounded while allowing
#: high-resolution originals; the separate hardware-derived total budget still applies.
MAX_BYTES_PER_FILE = 16 * 1024 * 1024
#: The bound used when the host policy cannot be resolved. Not the policy — see
#: `media_budget_bytes()`, which derives the real number from the detected Mac.
MAX_TOTAL_BYTES = 512 * 1024 * 1024

#: Storage is counted the way the detector and the resource policy count it — decimal
#: gigabytes, as the hardware and Finder label them.
_BYTES_PER_STORAGE_GB = 1000**3

_TIMEOUT_SECONDS = 20


@dataclass(slots=True)
class MediaReport:
    considered: int = 0
    downloaded: int = 0
    already_cached: int = 0
    expired_before_fetch: int = 0
    failed: int = 0
    bytes_written: int = 0
    orphans_removed: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "considered": self.considered,
            "downloaded": self.downloaded,
            "already_cached": self.already_cached,
            "expired_before_fetch": self.expired_before_fetch,
            "failed": self.failed,
            "bytes_written": self.bytes_written,
            "orphans_removed": self.orphans_removed,
            "errors": self.errors[:10],
        }


def _now() -> datetime:
    return datetime.now(UTC)


def _parse(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


def cache_path(root: Path, item_id: str, checksum: str) -> Path:
    """Sharded by checksum prefix, so one directory never holds tens of thousands of files."""
    return root / checksum[:2] / f"{item_id}-{checksum[:16]}.jpg"


def _total_cached_bytes(root: Path) -> int:
    if not root.exists():
        return 0
    return sum(path.stat().st_size for path in root.rglob("*") if path.is_file())


def media_budget_bytes() -> int:
    """How much disk this cache may use, derived from the Mac that is running.

    CLAUDE.md §2 forbids a hard-coded capacity, and the policy already computes this:
    `config/resource-policy.example.yaml` gives media 0.15 of the cache budget, which
    `host/policy.py` resolves to 29.83 GB on this host. The 512 MiB constant that used to
    be enforced here is 56x smaller, so `/api/host/policy` and the cache were quoting two
    different limits and only one of them was the one that stopped a download.

    Falls back to `MAX_TOTAL_BYTES` when the policy cannot be resolved — no config file,
    or a host the detector cannot read. A bound that is too small still bounds, which is
    what `docs/SECURITY_BOUNDARIES.md` asks of this cache.
    """
    from ..config.loader import ConfigError, load_resource_policy_document
    from ..host.detector import MacOSHostProfileDetector
    from ..host.policy import resolve_resource_policy

    try:
        profile = MacOSHostProfileDetector().detect()
        document = load_resource_policy_document()
    except (ConfigError, ValidationError, OSError):
        return MAX_TOTAL_BYTES
    policy = resolve_resource_policy(profile, document.resource_policy, _now())
    return int(policy.storage.cache_shares.media_gb * _BYTES_PER_STORAGE_GB)


#: How recently a file may have been written and still be considered live.
#:
#: Long enough to cover a whole `cache_pending` batch on a slow connection — each asset
#: gets a 20-second socket timeout — so a concurrent writer's in-flight files are never
#: taken out from under it.
GRACE_SECONDS = 15 * 60


def sweep_orphans(session: Session, root: Path) -> int:
    """Delete cached files no `media_assets` row points at, and say how many.

    `cache_path` names a file after the item's UUID, so a re-collection that mints a new
    UUID writes a new file and abandons the old one. Measured on the live cache: 126
    orphaned files, 31.1 MB. They are not merely waste — `_total_cached_bytes` measures the
    tree rather than the rows, so dead bytes were spending the same budget live thumbnails
    need.

    Only files are removed, never the shard directories: an empty directory costs nothing
    and the next checksum with that prefix wants it back.

    Three refusals, because this is the only function in the product that deletes a user's
    data and "the database did not mention it" is a weak warrant:

    - **A session that references nothing sweeps nothing.** An empty database, a failed
      migration or a session opened against the wrong file would otherwise authorise
      deleting the entire cache. Absence of evidence is exactly what this must not act on.
    - **A file younger than `GRACE_SECONDS` is left alone.** `POST /api/collection/refresh`
      takes no lock, so a scheduled ingest can be writing bytes and holding the matching
      row in an uncommitted transaction. Without the grace period this deletes a thumbnail
      the other process is midway through adopting, and the row then points at nothing.
    - **A file that will not unlink is counted and skipped.** A permission error or a file
      that vanished between `rglob` and `unlink` must not turn a completed ingest into a
      500 — the commit has already happened by then and the caller would be told the whole
      thing failed.
    """
    if not root.exists():
        return 0

    referenced = {
        (REPO_ROOT / stored).resolve()
        for stored in session.scalars(
            select(MediaAsset.local_path).where(MediaAsset.local_path.is_not(None))
        )
        if stored
    }
    if not referenced:
        return 0

    cutoff = time.time() - GRACE_SECONDS
    removed = 0
    for path in root.rglob("*"):
        if not path.is_file() or path.resolve() in referenced:
            continue
        try:
            if path.stat().st_mtime > cutoff:
                continue
            path.unlink()
        except OSError:
            continue
        removed += 1
    return removed


def _fetch(url: str) -> bytes:
    request = urllib.request.Request(  # noqa: S310 - https enforced by the caller
        url,
        headers={
            # The CDN rejects an empty agent. Not an impersonation: it names the product.
            "User-Agent": "TasteInbox/0.1 (local personal archive)",
            "Accept": "image/avif,image/webp,image/jpeg,image/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:  # noqa: S310
        # Read one byte past the cap so an oversized body is detected rather than truncated
        # into a corrupt file.
        payload: bytes = response.read(MAX_BYTES_PER_FILE + 1)
    if len(payload) > MAX_BYTES_PER_FILE:
        raise ValueError(f"larger than the {MAX_BYTES_PER_FILE} byte cap")
    return payload


def cache_pending(
    session: Session,
    *,
    root: Path | None = None,
    limit: int | None = None,
    budget_bytes: int | None = None,
    now: datetime | None = None,
) -> MediaReport:
    """Download every thumbnail that is recorded but not yet on disk.

    `budget_bytes` defaults to this host's share under the resource policy. It is a
    parameter so that a test never has to read the machine running the suite, which is
    what `tests/helpers.py` exists to keep true.
    """
    media_root = root or MEDIA_ROOT
    moment = now or _now()
    budget = media_budget_bytes() if budget_bytes is None else budget_bytes
    report = MediaReport()

    pending = session.scalars(
        select(MediaAsset).where(MediaAsset.local_path.is_(None)).order_by(MediaAsset.id)
    ).all()
    budget_used = _total_cached_bytes(media_root)

    for asset in pending if limit is None else pending[:limit]:
        report.considered += 1
        url = asset.remote_url
        if not url or not url.startswith("https://"):
            report.failed += 1
            report.errors.append(f"{asset.item_id}: no https url")
            continue

        expires = _parse(asset.remote_expires_at)
        if expires is not None and expires <= moment:
            # This URL is past its signature and will 403. Skipped rather than retried —
            # a fresh one only comes from re-collecting the post, which is a collector run,
            # not something the cache can do on its own.
            report.expired_before_fetch += 1
            continue

        if budget_used >= budget:
            report.errors.append("media cache budget reached; stopping")
            break

        try:
            payload = _fetch(url)
        except (urllib.error.URLError, ValueError, TimeoutError, OSError) as error:
            report.failed += 1
            reason = (
                f"image exceeds the {MAX_BYTES_PER_FILE} byte cap"
                if isinstance(error, ValueError)
                else type(error).__name__
            )
            report.errors.append(f"{asset.item_id}: {reason}")
            continue

        if budget_used + len(payload) > budget:
            report.errors.append("media cache budget would be exceeded; stopping")
            break

        checksum = hashlib.sha256(payload).hexdigest()
        path = cache_path(media_root, asset.item_id, checksum)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)

        # Stored repo-relative when it sits inside the tree, so the database stays portable
        # and no personal absolute path is written into it (SECURITY_BOUNDARIES "Logging").
        asset.local_path = (
            str(path.relative_to(REPO_ROOT)) if path.is_relative_to(REPO_ROOT) else str(path)
        )
        asset.byte_size = len(payload)
        asset.checksum = checksum
        asset.fetched_at = moment.isoformat(timespec="seconds").replace("+00:00", "Z")

        budget_used += len(payload)
        report.downloaded += 1
        report.bytes_written += len(payload)

    session.commit()
    report.already_cached = len(
        session.scalars(select(MediaAsset).where(MediaAsset.local_path.is_not(None))).all()
    )
    # After the commit, so a file this run just adopted is never read as unreferenced.
    report.orphans_removed = sweep_orphans(session, media_root)
    return report


def expiring_within(session: Session, hours: int, *, now: datetime | None = None) -> int:
    """How many recorded-but-not-downloaded thumbnails are about to stop resolving."""
    moment = now or _now()
    count = 0
    for asset in session.scalars(select(MediaAsset).where(MediaAsset.local_path.is_(None))):
        expires = _parse(asset.remote_expires_at)
        if expires is not None and 0 <= (expires - moment).total_seconds() <= hours * 3600:
            count += 1
    return count
