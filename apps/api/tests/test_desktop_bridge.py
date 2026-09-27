"""The desktop IPC boundary: no network listener and no general-purpose command path."""

from __future__ import annotations

from typing import Any

from taste_inbox.desktop.bridge import (
    FILE_MARKER,
    _replace_media_urls,
    dispatch,
    validate_request,
)


class _Response:
    def __init__(self, value: object) -> None:
        self.value = value

    def json(self) -> object:
        return self.value


class _Client:
    def __init__(self, value: object) -> None:
        self.value = value
        self.calls: list[tuple[str, str, Any]] = []

    def request(self, method: str, path: str, *, json: Any = None) -> _Response:
        self.calls.append((method, path, json))
        return _Response(self.value)


def test_allows_only_local_api_paths() -> None:
    assert validate_request({"method": "GET", "path": "/api/health"}) == (
        "GET",
        "/api/health",
        None,
    )

    for path in ("https://example.com/api/health", "/api/../secret", "/settings"):
        response = dispatch({"method": "GET", "path": path}, client=_Client({}))
        assert response["error"]["code"] == "desktop_request_rejected"


def test_forwards_patch_body_without_opening_http() -> None:
    client = _Client({"data": {"ok": True}})
    body = {"changes": {"collection.intervalHours": 4}}

    assert dispatch({"method": "PATCH", "path": "/api/settings", "body": body}, client=client) == {
        "data": {"ok": True}
    }
    assert client.calls == [("PATCH", "/api/settings", body)]


def test_allows_only_the_manual_item_post_write() -> None:
    client = _Client({"data": {"ok": True}})
    body = {"url": "https://example.test/post", "board": "trends"}

    assert dispatch(
        {"method": "POST", "path": "/api/items/manual", "body": body}, client=client
    ) == {"data": {"ok": True}}
    assert client.calls == [("POST", "/api/items/manual", body)]

    refused = dispatch(
        {"method": "POST", "path": "/api/collection/refresh", "body": {}},
        client=_Client({}),
    )
    assert refused["error"]["code"] == "desktop_request_rejected"


def test_rewrites_only_exact_cached_media_references() -> None:
    marker = f"{FILE_MARKER}file:///tmp/cover.jpg"
    value = {
        "data": {
            "preview": "/api/media/51",
            "original": "https://example.com/api/media/51",
            "nested": ["/api/media/52"],
        }
    }

    assert _replace_media_urls(value, {"/api/media/51": marker}) == {
        "data": {
            "preview": marker,
            "original": "https://example.com/api/media/51",
            "nested": ["/api/media/52"],
        }
    }


def test_rejects_non_json_responses() -> None:
    response = dispatch({"method": "GET", "path": "/api/health"}, client=_Client(["nope"]))
    assert response["error"]["code"] == "invalid_response"
