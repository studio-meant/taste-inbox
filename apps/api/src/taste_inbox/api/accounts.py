"""Which GitHub and Hugging Face account this Mac collects, and collecting it.

Until 2026-09-28 the only way to name an account was an environment variable read by a
collector run by hand (`GITHUB_LOGIN`, `HF_USERNAME`), and the scheduled job for these
sources ingested files and collected nothing. A new user could install the app and never
be asked whose signals it should read.

**An account is a name, nothing more.** `github.com/ohsuz` → `ohsuz`; `huggingface.co/ohsuz`
→ `ohsuz`. All three surfaces read public data — GitHub stars, Hub likes, and paper upvotes
(`docs/DECISIONS.md` §2026-09-28 업보트) — so there is no login and nothing secret to store.
Tokens stay optional and stay in `.env`: this screen reports whether one is set and never
takes or shows its value.

**One name per platform, stored as a setting.** Items keep attaching to the platform's one
`source_accounts` row exactly as ingest has always done. A row per handle would put the same
starred repository on the board twice the day someone renamed their account, because
membership is keyed per account.

**Changing the name resets that platform's checkpoints.** A checkpoint is a position in one
person's listing; kept across a rename, the next run would walk the new person's history
looking for an id from the old one's.
"""

from __future__ import annotations

import os
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.models import Checkpoint, CollectorRun, Item, Job, JobStep, Setting


@dataclass(frozen=True, slots=True)
class Surface:
    id: str
    label: str


@dataclass(frozen=True, slots=True)
class Platform:
    id: str
    label: str
    #: What a valid name looks like, before anything is asked of the network.
    pattern: re.Pattern[str]
    profile: str
    #: The optional credential's environment variable — named here, read only as present/absent.
    access_variable: str
    access_note: str
    surfaces: tuple[Surface, ...]


PLATFORMS: dict[str, Platform] = {
    "github": Platform(
        id="github",
        label="GitHub",
        # GitHub's own rule: alphanumerics and single inner hyphens, at most 39.
        pattern=re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$"),
        profile="https://github.com/{}",
        access_variable="GITHUB_TOKEN",
        access_note="없으면 시간당 60회 제한으로 공개 스타 목록을 읽어요",
        surfaces=(Surface("github_stars_api", "스타"),),
    ),
    "huggingface": Platform(
        id="huggingface",
        label="Hugging Face",
        pattern=re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$"),
        profile="https://huggingface.co/{}",
        access_variable="HF_TOKEN",
        access_note="없어도 공개 좋아요·업보트를 읽어요. 비공개 저장소 좋아요에만 필요해요",
        surfaces=(
            Surface("huggingface_activity", "좋아요 · 모델 · 데이터셋 · Space"),
            Surface("huggingface_upvotes", "업보트한 논문"),
        ),
    ),
}

#: What a first run takes, per surface. Enough to fill the Inbox on the first day without
#: walking a whole history: one page of stars, and for Hugging Face a bounded number of
#: likes and upvotes — each of which costs a document request of its own.
SEED_LIMIT: dict[str, int] = {
    "github_stars_api": 100,
    "huggingface_activity": 30,
    "huggingface_upvotes": 30,
}

SURFACE_PLATFORM: dict[str, str] = {
    surface.id: platform.id for platform in PLATFORMS.values() for surface in platform.surfaces
}

JOB_TYPE = "collection"


class AccountRejected(ValueError):
    """A name this platform could not have issued. The message is the screen's sentence."""


def _key(platform: str) -> str:
    return f"account.{platform}.handle"


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def handle_of(session: Session, platform: str) -> str | None:
    row = session.get(Setting, _key(platform))
    return row.value if row is not None and row.value else None


def normalise(platform: str, raw: str) -> str:
    """The bare account name, from whatever a person pasted.

    `ohsuz`, `@ohsuz`, `github.com/ohsuz` and `https://huggingface.co/ohsuz/` all mean the
    same account, and asking someone to strip a URL by hand is a form being difficult.
    """

    entry = PLATFORMS.get(platform)
    if entry is None:
        raise AccountRejected(f"'{platform}'는 연결할 수 있는 출처가 아니에요.")
    value = raw.strip().removeprefix("@")
    value = re.sub(r"^(?:https?://)?(?:www\.)?(?:github\.com|huggingface\.co)/", "", value)
    value = value.split("?")[0].split("#")[0].strip("/")
    if "/" in value:
        value = value.split("/")[0]
    if not value:
        raise AccountRejected(f"{entry.label} 계정명을 입력해 주세요.")
    if not entry.pattern.match(value):
        raise AccountRejected(
            f"'{value}'는 {entry.label} 계정명 형식이 아니에요. "
            f"{entry.profile.format('계정명')}의 계정명 부분만 입력해 주세요."
        )
    return value


def connect(session: Session, platform: str, raw: str) -> tuple[str, bool]:
    """Store the name. Returns it, and whether it changed."""

    handle = normalise(platform, raw)
    previous = handle_of(session, platform)
    row = session.get(Setting, _key(platform))
    if row is None:
        session.add(Setting(key=_key(platform), value=handle, updated_at=_now()))
    else:
        row.value = handle
        row.updated_at = _now()
    changed = previous != handle
    if changed:
        for surface in PLATFORMS[platform].surfaces:
            checkpoint = session.get(Checkpoint, surface.id)
            if checkpoint is not None:
                session.delete(checkpoint)
    session.commit()
    return handle, changed


def disconnect(session: Session, platform: str) -> None:
    """Forget the name. Nothing collected is removed — that is a separate, explicit act."""

    row = session.get(Setting, _key(platform))
    if row is not None:
        session.delete(row)
        session.commit()


def _latest_run(session: Session, surface: str) -> CollectorRun | None:
    return session.scalars(
        select(CollectorRun)
        .where(CollectorRun.collector_id == surface)
        .order_by(CollectorRun.started_at.desc(), CollectorRun.id.desc())
        .limit(1)
    ).first()


def last_collected_at(session: Session, platform: str) -> str | None:
    stamps = [
        run.started_at
        for surface in PLATFORMS[platform].surfaces
        if (run := _latest_run(session, surface.id)) is not None
    ]
    return max(stamps) if stamps else None


def _latest_job(session: Session, platform: str) -> Job | None:
    return session.scalars(
        select(Job)
        .where(Job.type == JOB_TYPE, Job.target_id.is_(None), Job.title == _job_title(platform))
        .order_by(Job.created_at.desc(), Job.id.desc())
        .limit(1)
    ).first()


def _job_title(platform: str) -> str:
    return f"{PLATFORMS[platform].label} 수집"


def payload(session: Session) -> list[dict[str, Any]]:
    """Both platforms, connected or not — the Settings screen draws a card for each."""

    rows: list[dict[str, Any]] = []
    for platform in PLATFORMS.values():
        handle = handle_of(session, platform.id)
        job = _latest_job(session, platform.id)
        steps = (
            session.scalars(
                select(JobStep).where(JobStep.job_id == job.id).order_by(JobStep.ordinal)
            ).all()
            if job is not None
            else []
        )
        rows.append(
            {
                "platform": platform.id,
                "label": platform.label,
                "handle": handle,
                "profileUrl": platform.profile.format(handle) if handle else None,
                "tokenEnv": platform.access_variable,
                # Whether it is set — never the value.
                "tokenConfigured": bool(os.environ.get(platform.access_variable, "").strip()),
                "tokenEffect": platform.access_note,
                "itemCount": session.scalar(
                    select(func.count()).select_from(Item).where(Item.platform == platform.id)
                )
                or 0,
                "surfaces": [_surface_payload(session, surface) for surface in platform.surfaces],
                "job": None
                if job is None
                else {
                    "id": job.id,
                    "state": job.state,
                    "startedAt": job.started_at,
                    "finishedAt": job.finished_at,
                    "steps": [
                        {"label": step.label, "state": step.state, "message": step.message}
                        for step in steps
                    ],
                },
            }
        )
    return rows


def _surface_payload(session: Session, surface: Surface) -> dict[str, Any]:
    run = _latest_run(session, surface.id)
    return {
        "id": surface.id,
        "label": surface.label,
        "lastRunAt": run.started_at if run else None,
        "outcome": run.outcome if run else None,
        "stoppedBecause": (run.stopped_because or None) if run else None,
        "itemsSeen": run.items_seen if run else None,
    }


def open_job(session: Session, platform: str) -> Job:
    job = Job(
        id=f"collection-{uuid.uuid4()}",
        type=JOB_TYPE,
        state="queued",
        target_id=None,
        title=_job_title(platform),
        current_step=None,
        cancellable=False,
        created_at=_now(),
    )
    session.add(job)
    session.flush()
    for ordinal, surface in enumerate(PLATFORMS[platform].surfaces):
        session.add(
            JobStep(
                id=f"{job.id}-{ordinal}",
                job_id=job.id,
                ordinal=ordinal,
                label=f"{surface.label} 가져오기",
                state="waiting",
            )
        )
    session.commit()
    return job


#: `(surface, database_url) -> exit code`. The seam tests replace: the real one runs the
#: collector in its own interpreter and ingests what it wrote (`ingest/collect.py`).
Collector = Callable[[str, str], int]


def run_job(
    session: Session, platform: str, job_id: str, *, database_url: str, collector: Collector
) -> str:
    """Collect every surface of one platform, one after another, recording each step.

    Sequential on purpose: the surfaces share one host's rate limit and one SQLite file, and
    the second has nothing to gain from racing the first.
    """

    job = session.get(Job, job_id)
    if job is None:
        raise LookupError(job_id)
    job.state = "running"
    job.started_at = _now()
    session.commit()

    failures = 0
    for ordinal, surface in enumerate(PLATFORMS[platform].surfaces):
        step = session.scalar(
            select(JobStep).where(JobStep.job_id == job_id, JobStep.ordinal == ordinal)
        )
        if step is None:
            continue
        step.state = "running"
        step.started_at = _now()
        job.current_step = step.label
        session.commit()

        code = collector(surface.id, database_url)

        session.expire_all()
        run = _latest_run(session, surface.id)
        step = session.get(JobStep, f"{job_id}-{ordinal}")
        job = session.get(Job, job_id)
        if step is None or job is None:
            raise LookupError(job_id)
        ok = code == 0 and (run is None or run.outcome == "ok")
        step.state = "done" if ok else "failed"
        step.finished_at = _now()
        if run is not None:
            step.message = (
                f"{run.items_seen}개 확인"
                if ok
                else (run.stopped_because or f"결과: {run.outcome}")[:500]
            )
        elif not ok:
            step.message = f"수집기가 종료 코드 {code}로 끝났어요"
        failures += 0 if ok else 1
        session.commit()

    job.state = (
        "succeeded"
        if failures == 0
        else ("failed" if failures == len(PLATFORMS[platform].surfaces) else "partially_succeeded")
    )
    job.finished_at = _now()
    job.current_step = None
    session.commit()
    return job.state


def due(session: Session, platform: str, interval_hours: int, now: datetime | None = None) -> bool:
    """Whether a connected platform's last collection is older than the interval."""

    if handle_of(session, platform) is None:
        return False
    last = last_collected_at(session, platform)
    if last is None:
        return True
    moment = now or datetime.now(UTC)
    try:
        started = datetime.fromisoformat(last.replace("Z", "+00:00"))
    except ValueError:
        return True
    return (moment - started).total_seconds() >= interval_hours * 3600


__all__ = [
    "PLATFORMS",
    "SEED_LIMIT",
    "SURFACE_PLATFORM",
    "AccountRejected",
    "Collector",
    "connect",
    "disconnect",
    "due",
    "handle_of",
    "last_collected_at",
    "normalise",
    "open_job",
    "payload",
    "run_job",
]
