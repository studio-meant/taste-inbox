"""Store a link the user supplied, without fetching or inspecting its destination.

A person's own explicit signal, beside the stars and likes the collectors bring. The URL
decides what it is — a GitHub repository, a Hugging Face model, dataset, Space or paper, an
arXiv paper, or any other page — and nothing is requested from it.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any, NoReturn
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Item, ItemSource, SourceAccount
from .app import ApiError
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


#: A Hugging Face path's first segment, and the kind of thing it names. Anything else on
#: the Hub — `/{owner}/{name}` — is a model, which is how the Hub itself routes it.
_HF_KINDS = {"datasets": "dataset", "spaces": "space", "papers": "paper"}


def _platform(url: str) -> tuple[str, str, str, str]:
    """`(platform, kind, label, identity)` for a link, read off the URL alone."""
    parsed = urlsplit(url)
    host = (parsed.hostname or "").removeprefix("www.")
    first = parsed.path.strip("/").split("/", 1)[0]
    if host == "github.com":
        platform, kind, label = "github", "repo", "직접 추가 · GitHub"
    elif host == "huggingface.co":
        platform, label = "huggingface", "직접 추가 · Hugging Face"
        kind = _HF_KINDS.get(first, "model")
    elif host == "arxiv.org":
        platform, kind, label = "arxiv", "paper", "직접 추가 · arXiv"
    else:
        platform, kind, label = "web", "post", "직접 추가 · 웹"
    identity = "manual:" + hashlib.sha256(url.encode("utf-8")).hexdigest()
    return platform, kind, label, identity


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
    """Create one local bookmark, or answer with the one already there. No request is made
    to ``url``."""

    if not isinstance(payload, dict):
        _reject("추가할 링크를 보내주세요.")
    url = _canonical_url(payload)
    title = _text(payload, "title", MAX_TITLE)
    note = _text(payload, "note", MAX_NOTE)

    existing = session.scalar(select(Item).where(Item.canonical_url == url))
    if existing is not None:
        return {"created": False, "item": to_item_detail(session, existing)}

    platform, kind, label, identity = _platform(url)
    stamp = generated_at()
    item = Item(
        id=str(uuid.uuid4()),
        kind=kind,
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
            position=None,
            first_seen_at=stamp,
            action_at=None,
        )
    )
    session.commit()
    return {"created": True, "item": to_item_detail(session, item)}


__all__ = ["create_manual_item"]
