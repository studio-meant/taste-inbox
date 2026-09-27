"""Store a link the user supplied, without fetching or inspecting its destination."""

from __future__ import annotations

import hashlib
import uuid
from typing import Any, NoReturn
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Item, ItemSource, SourceAccount
from .app import ApiError
from .boards import WRITABLE_BOARDS, set_item_board
from .cards import generated_at, to_item_detail

MAX_URL = 2048
MAX_TITLE = 200
MAX_NOTE = 5000


def _reject(message: str) -> NoReturn:
    raise ApiError(422, "manual_item_rejected", message, recoverable=True)


def _text(payload: dict[str, Any], key: str, maximum: int) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        _reject(f"{key} 값은 글자여야 해요.")
    cleaned = value.strip()
    if len(cleaned) > maximum:
        _reject(f"{key} 값은 {maximum:,}자까지 저장할 수 있어요.")
    return cleaned or None


def _canonical_url(payload: dict[str, Any]) -> str:
    raw = payload.get("url")
    if not isinstance(raw, str) or not raw.strip():
        _reject("추가할 링크를 입력해 주세요.")
    cleaned = raw.strip()
    if len(cleaned) > MAX_URL:
        _reject(f"링크는 {MAX_URL:,}자까지 저장할 수 있어요.")
    if any(ord(character) < 32 for character in cleaned):
        _reject("줄바꿈이나 제어 문자가 들어간 링크는 저장하지 않아요.")
    parsed = urlsplit(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        _reject("http 또는 https 웹 링크를 입력해 주세요.")
    if parsed.username is not None or parsed.password is not None:
        _reject("로그인 정보가 들어간 링크는 저장하지 않아요.")
    host = parsed.hostname.lower()
    try:
        port = parsed.port
    except ValueError:
        _reject("포트 번호가 올바른 링크를 입력해 주세요.")
    netloc = host if port is None else f"{host}:{port}"
    path = parsed.path or "/"
    return urlunsplit((parsed.scheme.lower(), netloc, path, parsed.query, ""))


def _platform(url: str) -> tuple[str, str, str]:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").removeprefix("www.")
    if host == "instagram.com":
        platform, label = "instagram", "직접 추가 · Instagram"
    elif host in {"threads.com", "threads.net"}:
        platform, label = "threads", "직접 추가 · Threads"
    elif host == "linkedin.com" or host.endswith(".linkedin.com"):
        platform, label = "linkedin", "직접 추가 · LinkedIn"
    elif host == "github.com":
        platform, label = "github", "직접 추가 · GitHub"
    else:
        platform, label = "web", "직접 추가 · 웹"
    identity = "manual:" + hashlib.sha256(url.encode("utf-8")).hexdigest()
    return platform, label, identity


def _account(session: Session, platform: str, label: str) -> SourceAccount:
    handle = "__manual__"
    account = session.scalar(
        select(SourceAccount).where(
            SourceAccount.platform == platform, SourceAccount.handle == handle
        )
    )
    if account is not None:
        return account
    account = SourceAccount(
        platform=platform,
        handle=handle,
        label=label,
        enabled=False,
        state="disabled",
        connected_at=generated_at(),
    )
    session.add(account)
    session.flush()
    return account


def create_manual_item(session: Session, payload: dict[str, Any] | None) -> dict[str, Any]:
    """Create or re-file one local bookmark. No request is made to ``url``."""

    if not isinstance(payload, dict):
        _reject("추가할 링크와 보드를 보내주세요.")
    board = payload.get("board")
    if not isinstance(board, str) or board not in WRITABLE_BOARDS:
        _reject("저장할 보드를 골라 주세요.")
    url = _canonical_url(payload)
    title = _text(payload, "title", MAX_TITLE)
    note = _text(payload, "note", MAX_NOTE)

    existing = session.scalar(select(Item).where(Item.canonical_url == url))
    if existing is not None:
        return {"created": False, "item": set_item_board(session, existing.id, {"board": board})}

    platform, label, identity = _platform(url)
    stamp = generated_at()
    item = Item(
        id=str(uuid.uuid4()),
        kind="repo" if platform == "github" else "post",
        platform=platform,
        platform_item_id=identity,
        canonical_url=url,
        title=title or label,
        body_text=note,
        author=None,
        first_seen_at=stamp,
        source_published_at=None,
        action_at=None,
        checked_at=None,
        updated_at=stamp,
    )
    session.add(item)
    session.flush()
    account = _account(session, platform, label)
    session.add(
        ItemSource(
            item_id=item.id,
            source_account_id=account.id,
            action_type=None,
            collection_name=WRITABLE_BOARDS[board],
            position=None,
            first_seen_at=stamp,
            action_at=None,
        )
    )
    session.commit()
    return {"created": True, "item": to_item_detail(session, item)}


__all__ = ["create_manual_item"]
