"""Who this workspace belongs to, and the first-run setup that asks.

The name top-left of every screen was the literal `Suzie` in the layout until 2026-09-28,
and nothing asked whose GitHub or Hugging Face to read. A fresh install now starts at
onboarding, which takes four answers in one request:

    name (required) · GitHub name · Hugging Face name (at least one) · collection interval

**One request, validated whole before anything is written.** A name that saves while the
account beside it is refused would leave a half-set-up workspace that no longer shows the
form that could finish it. Every field is checked first; only then are they stored and the
first collection started.

The name is local and single-user — a greeting, not an identity. It is never sent anywhere:
the research brief carries topics and public identifiers, not who asked (`CLAUDE.md` §3).
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from ..db.models import Setting
from . import accounts

NAME_KEY = "profile.name"
NAME_MAX = 32

#: The interval a first run suggests. The user sees it filled in and may change it.
DEFAULT_INTERVAL_HOURS = 4


@dataclass(frozen=True, slots=True)
class OnboardingRejected(ValueError):
    """One field that cannot be accepted, with the sentence the form shows under it."""

    field: str
    message: str

    def __str__(self) -> str:
        return self.message


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def name_of(session: Session) -> str | None:
    row = session.get(Setting, NAME_KEY)
    return row.value if row is not None and row.value else None


def payload(session: Session) -> dict[str, Any]:
    name = name_of(session)
    return {"name": name, "onboarded": name is not None}


def clean_name(raw: str) -> str:
    """A display name: trimmed, printable, at most 32 characters."""

    name = " ".join(str(raw).split())
    if not name:
        raise OnboardingRejected("name", "이름을 입력해 주세요.")
    if any(unicodedata.category(char).startswith("C") for char in name):
        raise OnboardingRejected("name", "이름에 쓸 수 없는 문자가 있어요.")
    if len(name) > NAME_MAX:
        raise OnboardingRejected("name", f"이름은 {NAME_MAX}자까지 쓸 수 있어요.")
    return name


def set_name(session: Session, raw: str) -> str:
    name = clean_name(raw)
    row = session.get(Setting, NAME_KEY)
    if row is None:
        session.add(Setting(key=NAME_KEY, value=name, updated_at=_now()))
    else:
        row.value = name
        row.updated_at = _now()
    session.commit()
    return name


def validate(body: dict[str, Any]) -> tuple[str, dict[str, str], int]:
    """Every answer checked, nothing written. Raises on the first field that fails."""

    name = clean_name(str(body.get("name") or ""))
    handles: dict[str, str] = {}
    for platform in accounts.PLATFORMS:
        raw = str(body.get(platform) or "").strip()
        if not raw:
            continue
        try:
            handles[platform] = accounts.normalise(platform, raw)
        except accounts.AccountRejected as error:
            raise OnboardingRejected(platform, str(error)) from error
    if not handles:
        raise OnboardingRejected(
            "accounts", "GitHub와 Hugging Face 중 하나 이상의 계정명을 입력해 주세요."
        )
    raw_interval = body.get("intervalHours", DEFAULT_INTERVAL_HOURS)
    try:
        interval = int(raw_interval)
    except (TypeError, ValueError) as error:
        raise OnboardingRejected(
            "intervalHours", "수집 주기는 시간 단위 숫자로 입력해 주세요."
        ) from error
    return name, handles, interval


__all__ = [
    "DEFAULT_INTERVAL_HOURS",
    "NAME_KEY",
    "NAME_MAX",
    "OnboardingRejected",
    "clean_name",
    "name_of",
    "payload",
    "set_name",
    "validate",
]
