"""Follow a shortener to find out what it actually points at.

LinkedIn wraps every external link in `lnkd.in`, so a repository arrives disguised and the
collected data cannot say whether a post linked GitHub or a newsletter. One request per
link settles it.

The original observation is never rewritten. `https://lnkd.in/g6kHemzF` really was what
the page contained, and that stays on record as a `fact`; the destination is added beside
it as `external`, because we went and asked another service rather than reading it off the
page. Both are true, and only one of them was observed directly.

**This is the one place the product fetches a URL that came from collected content**, so
it is bounded on purpose:

- `https` only, and only from a shortener host the code already knows.
- Redirects followed by hand, capped, and re-checked at every hop — an open redirect that
  lands on `127.0.0.1` or a private range is refused rather than fetched.
- The body is read only to find the destination, and only up to a small cap.

`lnkd.in` turned out not to redirect at all: `HEAD` returns 403 and `GET` returns 200 with
an interstitial page whose canonical link is LinkedIn itself. The real destination is the
one non-LinkedIn URL in the markup. Following `Location` headers alone found nothing, which
is why the first pass reported five failures with no reason attached.
"""

from __future__ import annotations

import ipaddress
import re
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Evidence, Item
from .captures import LINK_SHORTENERS, classify_link

MAX_HOPS = 5
_TIMEOUT_SECONDS = 12

SHORTENED_TYPES = ("shortened_link", "comment_shortened_link")


@dataclass(slots=True)
class ResolveReport:
    considered: int = 0
    resolved: int = 0
    already_known: int = 0
    failed: int = 0
    refused: int = 0
    artifacts_found: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "considered": self.considered,
            "resolved": self.resolved,
            "already_known": self.already_known,
            "failed": self.failed,
            "refused": self.refused,
            "artifacts_found": self.artifacts_found,
            "errors": self.errors[:10],
        }


def _is_public(host: str) -> bool:
    """Whether a hostname resolves only to addresses worth talking to.

    A shortener is an open redirect by design: whoever created the link chose where it
    goes. Resolving the host and checking every address is what stops one from steering
    this process at something on the loopback interface or the local network.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        address = info[4][0]
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError:
            return False
        if (
            parsed.is_private
            or parsed.is_loopback
            or parsed.is_link_local
            or parsed.is_reserved
            or parsed.is_multicast
        ):
            return False
    return True


def _safe(url: str) -> bool:
    parts = urlparse(url)
    if parts.scheme != "https" or not parts.hostname:
        return False
    return _is_public(parts.hostname)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Stop at each hop so every destination can be checked before it is requested."""

    def redirect_request(self, *_args: object, **_kwargs: object) -> None:
        return None


#: Enough of the interstitial to reach its link, and no more.
MAX_BODY_BYTES = 64 * 1024

_URL_IN_MARKUP = re.compile(r"https?://[^\s\"\'<>\\]{12,300}")

#: Hosts that appear in a LinkedIn interstitial regardless of where it points.
_INTERSTITIAL_NOISE = ("linkedin.com", "licdn.com", "w3.org", "schema.org", "lnkd.in")


def fetch_hop(url: str) -> tuple[str | None, str | None, str | None]:
    """One step. Returns `(location header, body, error)`.

    `GET` rather than `HEAD` because `lnkd.in` answers `HEAD` with 403. Redirects are not
    followed automatically, so every destination is checked before it is requested.
    """
    opener = urllib.request.build_opener(_NoRedirect)
    request = urllib.request.Request(  # noqa: S310 - scheme and host checked by `_safe`
        url,
        headers={"User-Agent": "TasteInbox/0.1 (local personal archive)"},
    )
    try:
        with opener.open(request, timeout=_TIMEOUT_SECONDS) as response:
            location = response.headers.get("Location")
            body = response.read(MAX_BODY_BYTES).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        location = error.headers.get("Location") if error.headers else None
        body = None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        return None, None, type(error).__name__
    return (str(location) if location else None), body, None


def destination_in_body(body: str) -> str | None:
    """The one link an interstitial is actually sending you to."""
    for candidate in _URL_IN_MARKUP.findall(body):
        if not any(noise in candidate for noise in _INTERSTITIAL_NOISE):
            return str(candidate).rstrip("\\\"'&;")
    return None


def follow(url: str) -> tuple[str | None, str | None]:
    """Follow to the end. Returns `(destination, reason it stopped)`."""
    current = url
    for _ in range(MAX_HOPS):
        if not _safe(current):
            return None, f"refused: {urlparse(current).hostname or 'unparseable'}"

        location, body, error = fetch_hop(current)
        if error:
            return None, error

        if location:
            current = str(urllib.parse.urljoin(current, location))
            continue

        if body:
            found = destination_in_body(body)
            if found and found != url:
                return found, None

        # Answered without redirecting and without naming anywhere else.
        return (current if current != url else None), "no destination found"
    return None, "too many redirects"


def resolve_shortened(
    session: Session, *, limit: int | None = None, only_known_shorteners: bool = True
) -> ResolveReport:
    """Give every shortened link a destination beside it."""
    report = ResolveReport()
    rows = session.scalars(
        select(Evidence).where(Evidence.type.in_(SHORTENED_TYPES)).order_by(Evidence.id)
    ).all()

    for evidence in rows if limit is None else rows[:limit]:
        report.considered += 1
        source = evidence.value

        if only_known_shorteners and not any(host in source for host in LINK_SHORTENERS):
            report.refused += 1
            continue

        resolved_type = f"resolved::{source}"
        if session.scalar(
            select(Evidence).where(
                Evidence.item_id == evidence.item_id, Evidence.label == resolved_type
            )
        ):
            report.already_known += 1
            continue

        destination, refusal = follow(source)
        if destination is None:
            if refusal and refusal.startswith("refused"):
                report.refused += 1
            else:
                report.failed += 1
                if refusal:
                    report.errors.append(f"{source}: {refusal}")
            continue

        kind = classify_link(destination)
        prefix = "comment_" if evidence.type.startswith("comment_") else ""
        if kind == "artifact_link":
            report.artifacts_found += 1

        session.add(
            Evidence(
                item_id=evidence.item_id,
                type=f"{prefix}{kind}",
                # The label carries the link it came from, so a resolved destination is
                # never mistaken for one the page showed directly.
                label=resolved_type,
                value=destination,
                # `external`: this was learned by asking another service, not by reading
                # the collected page.
                provenance="external",
                source_url=evidence.source_url,
                observed_at=evidence.observed_at,
            )
        )
        report.resolved += 1

    session.commit()
    return report


def artifact_links(session: Session) -> list[tuple[str, str, str]]:
    """Every repository, model or paper link now known, however it was found."""
    rows = session.execute(
        select(Item.platform, Item.author, Evidence.value)
        .join(Evidence, Evidence.item_id == Item.id)
        .where(Evidence.type.in_(("artifact_link", "comment_artifact_link")))
    ).all()
    return [(str(platform), str(author or ""), str(value)) for platform, author, value in rows]


__all__ = ["ResolveReport", "artifact_links", "follow", "resolve_shortened"]
