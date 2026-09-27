"""One-request stdio bridge for the Tauri desktop app.

The existing FastAPI handlers remain the single implementation of cards, settings and
board writes.  Tauri calls them in-process through ``TestClient`` rather than exposing
ports 4173 and 8787.  The renderer never receives a Python path, a database handle or a
general-purpose command runner: it can ask only for an existing ``/api/*`` request.

Cached media is the one exception to JSON-only data.  API payloads name it as
``/api/media/<id>``; before the response crosses IPC those references become an opaque
``taste-inbox-file:file:///...`` marker.  The TypeScript repository converts the marker
with Tauri's asset protocol, whose scope is restricted by ``tauri.conf.json``.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Protocol, cast
from urllib.parse import urlsplit

from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from ..api.app import _engine, app
from ..db.models import MediaAsset
from ..paths import REPO_ROOT

MAX_REQUEST_BYTES = 1_048_576
ALLOWED_METHODS = frozenset({"GET", "PATCH", "POST"})
ALLOWED_POST_PATHS = frozenset({"/api/items/manual"})
MEDIA_PREFIX = "/api/media/"
FILE_MARKER = "taste-inbox-file:"


class ClientResponse(Protocol):
    def json(self) -> Any: ...


class InProcessClient(Protocol):
    def request(self, method: str, path: str, *, json: Any = None) -> ClientResponse: ...


class BridgeRequestError(ValueError):
    """A renderer request outside the deliberately small desktop boundary."""


def _error(code: str, message: str, *, recoverable: bool) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "recoverable": recoverable}}


def validate_request(value: object) -> tuple[str, str, Any]:
    """Return a safe method/path/body tuple, or reject it before FastAPI sees it."""

    if not isinstance(value, Mapping):
        raise BridgeRequestError("요청 형식이 올바르지 않아요.")

    method_value = value.get("method", "GET")
    path_value = value.get("path")
    if not isinstance(method_value, str) or method_value.upper() not in ALLOWED_METHODS:
        raise BridgeRequestError("허용되지 않은 요청 방식이에요.")
    if not isinstance(path_value, str):
        raise BridgeRequestError("API 경로가 없어요.")

    parsed = urlsplit(path_value)
    if (
        not path_value.startswith("/api/")
        or parsed.scheme != ""
        or parsed.netloc != ""
        or "\\" in parsed.path
        or any(part == ".." for part in parsed.path.split("/"))
    ):
        raise BridgeRequestError("허용되지 않은 API 경로예요.")

    method = method_value.upper()
    if method == "POST" and parsed.path not in ALLOWED_POST_PATHS:
        raise BridgeRequestError("허용되지 않은 쓰기 경로예요.")

    return method, path_value, value.get("body")


def _collect_media_ids(value: object, found: set[int]) -> None:
    if isinstance(value, str) and value.startswith(MEDIA_PREFIX):
        suffix = value.removeprefix(MEDIA_PREFIX)
        if suffix.isdecimal():
            found.add(int(suffix))
        return
    if isinstance(value, list):
        for child in value:
            _collect_media_ids(child, found)
        return
    if isinstance(value, Mapping):
        for child in value.values():
            _collect_media_ids(child, found)


def _safe_media_paths(
    asset_ids: set[int], *, engine: Engine = _engine, repo_root: Path = REPO_ROOT
) -> dict[str, str]:
    """Map cached asset URLs to file markers, never outside ``var/media``."""

    if not asset_ids:
        return {}

    cache_root = (repo_root / "var" / "media").resolve()
    replacements: dict[str, str] = {}
    with Session(engine) as session:
        assets = session.scalars(select(MediaAsset).where(MediaAsset.id.in_(asset_ids)))
        for asset in assets:
            if asset.local_path is None:
                continue
            candidate = (repo_root / asset.local_path).resolve()
            if not candidate.is_relative_to(cache_root) or not candidate.is_file():
                continue
            replacements[f"{MEDIA_PREFIX}{asset.id}"] = f"{FILE_MARKER}{candidate.as_uri()}"
    return replacements


def _replace_media_urls(value: Any, replacements: Mapping[str, str]) -> Any:
    if isinstance(value, str):
        return replacements.get(value, value)
    if isinstance(value, list):
        return [_replace_media_urls(child, replacements) for child in value]
    if isinstance(value, dict):
        return {key: _replace_media_urls(child, replacements) for key, child in value.items()}
    return value


def dispatch(value: object, *, client: InProcessClient | None = None) -> dict[str, Any]:
    """Run one permitted request and return the API envelope unchanged except for media."""

    try:
        method, path, body = validate_request(value)
    except BridgeRequestError as error:
        return _error("desktop_request_rejected", str(error), recoverable=False)

    owned_client = client is None
    active_client: InProcessClient = (
        TestClient(app, raise_server_exceptions=False) if client is None else client
    )
    try:
        response = active_client.request(method, path, json=body)
        payload = response.json()
    except Exception as error:  # the boundary exposes only a type, never data or a path
        return _error("desktop_bridge_failed", type(error).__name__, recoverable=True)
    finally:
        if owned_client and isinstance(active_client, TestClient):
            active_client.close()

    if not isinstance(payload, dict):
        return _error("invalid_response", "응답을 읽지 못했어요.", recoverable=False)

    media_ids: set[int] = set()
    _collect_media_ids(payload, media_ids)
    return cast(dict[str, Any], _replace_media_urls(payload, _safe_media_paths(media_ids)))


def _read_request() -> object:
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise BridgeRequestError("데스크톱 요청이 너무 커요.")
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BridgeRequestError("데스크톱 요청을 읽지 못했어요.") from error


def main() -> None:
    try:
        request = _read_request()
        response = dispatch(request)
    except BridgeRequestError as error:
        response = _error("desktop_request_rejected", str(error), recoverable=False)
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
