"""Long work that outlives its request: research and sandbox trials.

A trial takes up to ten minutes and an AI-Q research run several. Holding the browser's
request open that long is what the first build did, and it made the "Try safely" button a
ten-minute spinner that any proxy timeout would turn into a lie. So the endpoint answers
at once with the job id and the run continues here, writing the inherited `jobs` rows as
it goes. The screen reads those rows — job state is the backend's
(`CLAUDE.md` §8), and a small client component polls them.

**One run per kind at a time.** The sandbox holds a host lock that a second trial would
contend for, and a second AI-Q run for the same person is money spent on a question the
first has not answered yet. The slot is taken under a lock so two quick clicks cannot both
pass the check.

**A run that dies still lands.** An exception nothing anticipated marks its job failed with
the exception's own text, and a job left `running` by a process that exited is closed at
the next startup — a row that says "running" forever is the one state this screen must
never show.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from ..db.models import Job, JobStep

logger = logging.getLogger(__name__)

#: Job types that run here.
#:
#: `plan` shares the AI-Q backend with `research` but takes its own slot: they are two
#: different questions about two different things, and a person who asks one while the
#: other is running should wait for the backend, not be told their question was rejected.
#: The slot is what serialises them — one AI-Q call at a time per kind.
KINDS = ("research", "plan", "trial", "collection")

_slots: dict[str, threading.Thread] = {}
_slots_lock = threading.Lock()


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def busy(kind: str) -> bool:
    with _slots_lock:
        thread = _slots.get(kind)
        return thread is not None and thread.is_alive()


def _close(session: Session, job_id: str, reason: str) -> None:
    job = session.get(Job, job_id)
    if job is None or job.state not in ("queued", "running"):
        return
    for row in session.scalars(select(JobStep).where(JobStep.job_id == job_id)).all():
        if row.state == "running":
            row.state = "failed"
            row.message = reason[:500]
            row.finished_at = _now()
        elif row.state == "waiting":
            row.state = "skipped"
            row.finished_at = _now()
    job.state = "failed"
    job.finished_at = _now()
    job.cancellable = False
    session.commit()


def _spawn(target: Callable[[], None], name: str) -> threading.Thread:
    """Start the thread. A seam: tests replace it to run the work inline."""

    thread = threading.Thread(target=target, name=name, daemon=True)
    thread.start()
    return thread


def start(
    kind: str,
    job_id: str,
    work: Callable[[Session], object],
    *,
    session_factory: sessionmaker[Session],
) -> bool:
    """Run `work` in the background. False when a run of this kind is already going."""

    if kind not in KINDS:
        raise ValueError(f"unknown background kind {kind!r}")

    def body() -> None:
        with session_factory() as session:
            try:
                work(session)
            except Exception as error:
                logger.exception("%s job %s failed", kind, job_id)
                session.rollback()
                _close(session, job_id, f"{type(error).__name__}: {error}")

    with _slots_lock:
        current = _slots.get(kind)
        if current is not None and current.is_alive():
            return False
        _slots[kind] = _spawn(body, f"taste-inbox-{kind}-{job_id}")
    return True


def close_orphans(session: Session) -> int:
    """Fail jobs a previous process left running. Called once at startup.

    Nothing in this process can be running them yet, so any such row is a run whose
    process exited mid-way — a reload, a crash, a closed laptop.
    """

    orphans = session.scalars(
        select(Job.id).where(Job.type.in_(KINDS), Job.state.in_(("queued", "running")))
    ).all()
    for job_id in orphans:
        _close(session, job_id, "API 프로세스가 실행 중에 종료되어 중단되었습니다")
    return len(orphans)


__all__ = ["KINDS", "busy", "close_orphans", "start"]
