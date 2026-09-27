"""The one place this package talks to the network.

Read-only GETs against two documented JSON APIs, over HTTPS, with a timeout and a bounded
response size. Nothing here posts, follows a redirect to a new host, or reads a credential
it was not handed.

**Rate limits are reported, not fought.** `CLAUDE.md` §7 forbids aggressive retry, and the
failure mode that rule exists to prevent is a collector that turns a 403 into a block by
asking again immediately. A throttled run stops and says it was throttled; the next
scheduled cycle is four hours away and that is the retry.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

#: A JSON listing is small. Anything larger is not the response we asked for, and reading
#: it into memory is how a collector becomes the thing that fills the disk.
MAX_RESPONSE_BYTES = 8 * 1024 * 1024

DEFAULT_TIMEOUT_SECONDS = 15

#: Hosts this package may reach. Not a courtesy — the trial sandbox's egress policy is
#: written from the same two names, and a collector that quietly acquired a third host
#: would make that policy a description of the past.
ALLOWED_HOSTS = frozenset({"api.github.com", "huggingface.co"})


class CollectorHttpError(RuntimeError):
    """A request that failed in a way the caller has to decide about."""

    def __init__(self, message: str, *, status: int | None = None, retryable: bool = False) -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable


@dataclass(frozen=True, slots=True)
class RateLimit:
    """What the server said about how much room is left.

    Carried rather than logged because a run that stopped early has to be able to say
    *why* in the capture file, and "throttled with 0 of 60 remaining" is a different
    outcome from "collected everything there was".
    """

    limit: int | None = None
    remaining: int | None = None
    #: Unix seconds, as the platform reports it. Not converted — a reset time we invented
    #: would be a precision nobody observed.
    reset_at: int | None = None

    @classmethod
    def from_headers(cls, headers: Any) -> RateLimit:
        def number(name: str) -> int | None:
            raw = headers.get(name)
            if raw is None:
                return None
            try:
                return int(raw)
            except (TypeError, ValueError):
                return None

        return cls(
            limit=number("X-RateLimit-Limit"),
            remaining=number("X-RateLimit-Remaining"),
            reset_at=number("X-RateLimit-Reset"),
        )

    @property
    def exhausted(self) -> bool:
        return self.remaining is not None and self.remaining <= 0


@dataclass(frozen=True, slots=True)
class Response:
    payload: Any
    rate_limit: RateLimit
    #: The `Link: <…>; rel="next"` target, already resolved. None when this was the last
    #: page — which is how pagination ends rather than by counting.
    next_url: str | None


def _next_link(headers: Any) -> str | None:
    """Parse RFC 5988 `Link` for `rel="next"`.

    GitHub paginates with an opaque cursor, so following its own link is the only correct
    way forward; constructing `?page=N+1` guesses at a scheme the server did not promise.
    """

    raw = headers.get("Link")
    if not raw:
        return None
    for part in raw.split(","):
        section = part.split(";")
        if len(section) < 2:
            continue
        url = section[0].strip()
        if not (url.startswith("<") and url.endswith(">")):
            continue
        if any(bit.strip().replace('"', "") == "rel=next" for bit in section[1:]):
            return url[1:-1]
    return None


def get_json(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> Response:
    """One read-only GET, returning the decoded payload and what came with it."""

    parts = urlsplit(url)
    if parts.scheme != "https":
        raise CollectorHttpError(f"refusing a non-https url: {parts.scheme}://…")
    if parts.hostname not in ALLOWED_HOSTS:
        raise CollectorHttpError(f"refusing a host this collector does not know: {parts.hostname}")

    request = urllib.request.Request(url, method="GET")  # noqa: S310 — scheme checked above
    request.add_header("Accept", "application/json")
    request.add_header("User-Agent", "TasteInboxRnD/0.1 (personal archive; official API)")
    for name, value in (headers or {}).items():
        request.add_header(name, value)

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise CollectorHttpError(f"response larger than {MAX_RESPONSE_BYTES} bytes")
            return Response(
                payload=json.loads(body.decode("utf-8")),
                rate_limit=RateLimit.from_headers(response.headers),
                next_url=_next_link(response.headers),
            )
    except urllib.error.HTTPError as error:
        limit = RateLimit.from_headers(error.headers)
        # 403 with nothing left is GitHub's rate limit, not a permission problem. Telling
        # them apart matters: one is fixed by waiting and the other by a token.
        if error.code in (403, 429) and limit.exhausted:
            raise CollectorHttpError(
                f"rate limited (reset at {limit.reset_at})", status=error.code, retryable=True
            ) from error
        if error.code in (401, 403):
            raise CollectorHttpError(
                f"not authorised ({error.code}); check the token's scope", status=error.code
            ) from error
        raise CollectorHttpError(f"HTTP {error.code}", status=error.code) from error
    except urllib.error.URLError as error:
        raise CollectorHttpError(f"network error: {error.reason}", retryable=True) from error
    except json.JSONDecodeError as error:
        raise CollectorHttpError(f"response was not JSON: {error}") from error


__all__ = [
    "ALLOWED_HOSTS",
    "MAX_RESPONSE_BYTES",
    "CollectorHttpError",
    "RateLimit",
    "Response",
    "get_json",
]
