"""The desktop IPC boundary: no network listener and no general-purpose command path."""

from __future__ import annotations

from typing import Any

import pytest

from taste_inbox.desktop.bridge import dispatch, validate_request


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


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/items/manual"),
        ("POST", "/api/onboarding"),
        ("PUT", "/api/profile"),
        ("PUT", "/api/accounts/github"),
        ("DELETE", "/api/accounts/huggingface"),
        ("POST", "/api/accounts/github/collect"),
    ],
)
def test_forwards_the_writes_the_desktop_screens_make(method: str, path: str) -> None:
    client = _Client({"data": {"ok": True}})
    body = {"value": "x"}

    assert dispatch({"method": method, "path": path, "body": body}, client=client) == {
        "data": {"ok": True}
    }
    assert client.calls == [(method, path, body)]


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/collection/refresh"),
        ("POST", "/api/trials"),
        ("PUT", "/api/accounts/instagram"),
        ("DELETE", "/api/settings"),
        ("PATCH", "/api/items/x/board"),
    ],
)
def test_refuses_every_other_write(method: str, path: str) -> None:
    refused = dispatch({"method": method, "path": path, "body": {}}, client=_Client({}))
    assert refused["error"]["code"] == "desktop_request_rejected"


def test_rejects_non_json_responses() -> None:
    response = dispatch({"method": "GET", "path": "/api/health"}, client=_Client(["nope"]))
    assert response["error"]["code"] == "invalid_response"
