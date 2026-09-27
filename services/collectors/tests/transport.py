"""A recorded network, for tests that must not touch the real one.

Every response here was fetched once from the public API and stored under
`data/fixtures/collectors/` (see that README for what was trimmed). The collectors call
`get_json` by name in each module, so replacing it there is the whole seam — the parsing,
the stopping rules and the capture shape all run as they do live.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from taste_inbox_collectors.http import CollectorHttpError, RateLimit, Response

FIXTURES = Path(__file__).resolve().parents[3] / "data" / "fixtures" / "collectors"


def load(*parts: str) -> Any:
    return json.loads(FIXTURES.joinpath(*parts).read_text("utf-8"))


class RecordedNetwork:
    """URL → recorded payload. Anything unrecorded is a 404, as the Hub answers it."""

    def __init__(self, routes: dict[str, Any], *, next_urls: dict[str, str] | None = None) -> None:
        self.routes = routes
        self.next_urls = next_urls or {}
        self.requested: list[tuple[str, dict[str, str]]] = []
        self.failures: dict[str, CollectorHttpError] = {}

    def __call__(
        self, url: str, *, headers: dict[str, str] | None = None, timeout: float = 15
    ) -> Response:
        self.requested.append((url, dict(headers or {})))
        if url in self.failures:
            raise self.failures[url]
        if url not in self.routes:
            raise CollectorHttpError("HTTP 404", status=404)
        return Response(
            payload=self.routes[url], rate_limit=RateLimit(), next_url=self.next_urls.get(url)
        )


Fetcher = Callable[..., Response]
