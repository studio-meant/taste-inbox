"""Generate the launchd jobs that run collection on a schedule.

`CLAUDE.md` §2 fixes the orchestrator: `launchd + application jobs`, and names one
alternative it rules out. One agent per collector, every one of them carrying the same
`collection.interval_hours` from `config/app.yaml`.

Naming that alternative here is what `scripts/verify-repo.sh` looks for — its check is a
plain grep and cannot tell "we do not use this" from "we use this", so production code
says what it *does* and leaves the ruled-out option to `CLAUDE.md`.

**How the stagger is handled, and where it stops being exact.** The jobs use
`StartInterval`, which takes a number of seconds and starts counting when the job is
*loaded* — launchd has no "first run at T+3분, then every four hours". So the offset is
created at install time instead: `install_commands` puts a `sleep` between the
`launchctl bootstrap` lines, and each job keeps whatever phase it was loaded with. Three
known limits, none of them hidden:

- Installing every job takes one gap of `stagger_minutes` per job after the first, so at
  seven sources and the shipped three minutes that is 18 minutes of waiting.
- The phase is not durable. A reboot, or a `bootout` followed by a plain `bootstrap`,
  reloads the jobs together and the spacing collapses. Re-running the printed block
  restores it.
- launchd coalesces timers to save power, so a fire drifts by up to a couple of minutes.
  The three-minute gap is a margin, not a guarantee.

None of that costs data if it fails: two collectors that do land in the same minute still
checkpoint on item ids, and the worst case is two browser sessions at once.

For the same reason the phase here is not the midnight-anchored slot list that
`api/schedule.py` reports. That payload describes the intended cadence; once these jobs are
loaded, the real clock times are `install time + N hours`.

**Nothing here installs anything.** It writes plists into `var/launchd/` and prints the
`launchctl` commands. Loading a job that opens four logged-in accounts on a timer is a
decision with consequences for those accounts, and `CLAUDE.md` §10 keeps account access
behind explicit approval — so a person runs the command, having seen what it will do.

The jobs are also deliberately *modest*: `RunAtLoad` is off, so installing one does not
immediately start a browser session and the first run is one whole interval later. A missed
run is not made up on wake either, which costs nothing: checkpoints are keyed on item ids
and the next run collects everything since the last one.
"""

from __future__ import annotations

import plistlib
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from ..distribution import collection_available
from ..paths import REPO_ROOT
from .schedule import effective_document, scheduled_sources

LAUNCHD_DIR: Path = REPO_ROOT / "var" / "launchd"
# launchd opens StandardOutPath/StandardErrorPath itself, before the job starts. On macOS
# that service can execute and the child can write inside a user-approved Desktop folder,
# but launchd's own preflight cannot open a log there and reports EX_CONFIG (78). User logs
# belong in the unprotected per-user log directory for this reason as well as convention.
LOG_DIR: Path = Path.home() / "Library" / "Logs" / "Taste Inbox"
LABEL_PREFIX = "dev.tasteinbox"

SECONDS_PER_HOUR = 3600


@dataclass(slots=True)
class GeneratedJob:
    label: str
    collector_id: str
    #: How this job runs, in words, because it no longer has a clock time to name.
    runs_at: str
    path: Path
    #: Minutes after the first job this one should be loaded. The plists are identical, so
    #: this is the only thing that separates two collectors.
    offset_minutes: int


def _python() -> str:
    """The interpreter the API package runs under.

    launchd starts with almost no environment, so a bare `python` or `uv` would resolve
    differently — or not at all — from how it resolves in a shell.
    """
    return str(REPO_ROOT / "apps" / "api" / ".venv" / "bin" / "python")


def build_plist(
    *, label: str, collector_id: str, interval_hours: int, timezone: str
) -> dict[str, object]:
    if not collection_available(REPO_ROOT):
        raise ValueError("this distribution has no collectors that may be scheduled")
    return {
        "Label": label,
        "ProgramArguments": [
            _python(),
            "-m",
            # Reads the checkpoint, collects that one surface, then ingests every capture
            # present. Was `taste_inbox.ingest.cli`, which does only the last of those —
            # every job waking every four hours to re-read files nothing had refreshed.
            "taste_inbox.ingest.collect",
            "--collector",
            collector_id,
        ],
        "WorkingDirectory": str(REPO_ROOT / "apps" / "api"),
        "EnvironmentVariables": {
            # launchd's default environment has no HOME. The API interpreter itself can
            # start without it, but the collector child reaches Chrome and Playwright;
            # both resolve user-owned runtime/config paths through HOME and otherwise
            # terminate with EX_CONFIG before the driver can write a useful log.
            "HOME": str(Path.home()),
            "TZ": timezone,
            "DATABASE_URL": f"sqlite:///{REPO_ROOT / 'var' / 'data' / 'taste-inbox.db'}",
            "PYTHONUNBUFFERED": "1",
            # The interpreter that can import a collector. `_python()` above names the API
            # venv, which has neither playwright nor `taste_inbox_collectors` in it — the
            # driver reaches the other one by absolute path and never by import.
            "TASTE_INBOX_COLLECTOR_PYTHON": str(
                REPO_ROOT / "services" / "collectors" / ".venv" / "bin" / "python"
            ),
            # launchd starts with almost no environment — the same reason `_python()` spells
            # out the interpreter. Chrome and playwright's node driver both want a PATH.
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        },
        # Seconds, counted from when the job is loaded — not from midnight. The per-source
        # offset lives in the install commands, because launchd cannot express one here.
        "StartInterval": interval_hours * SECONDS_PER_HOUR,
        # Off on purpose: installing a job should not open an account session there and
        # then. The first run is one interval after loading.
        "RunAtLoad": False,
        "StandardOutPath": str(LOG_DIR / f"{collector_id}.log"),
        "StandardErrorPath": str(LOG_DIR / f"{collector_id}.err.log"),
        # Not a run cap. This is the SIGTERM→SIGKILL grace launchd allows when it unloads a
        # job, so it only bounds a run somebody is already stopping. The cap that bounds a
        # normal run is `--deadline-seconds` inside the collector, which matters because a
        # run that ends there still writes its capture, and one killed here does not.
        # A collection run that hangs on a slow page should end, not accumulate.
        "ExitTimeOut": 900,
        # No `KeepAlive`. A collector that stopped on a challenge must stay stopped —
        # restarting it is the aggressive retry CLAUDE.md §7 forbids.
    }


def plan(target: Path | None = None, *, session: Session | None = None) -> list[GeneratedJob]:
    """Describe the jobs. Touches no file.

    Split out from `generate` because reading is not writing, and one caller of this module
    only ever reads: `GET /api/collection/launchd` describes the plan for the System screen,
    and a GET must not change the machine. It did — every request rewrote every plist, so
    once the screen displayed them, *rendering a page* rewrote them, and so did every run of
    the test suite.

    Takes the session so a changed interval is reflected here. Without it the Settings screen
    could store 6 and this would still describe 4 — which is the reason that screen labels
    the interval "다음 설치부터" rather than "즉시 적용".
    """
    if not collection_available(REPO_ROOT):
        return []

    document = effective_document(session)
    collection = document.collection
    directory = target or LAUNCHD_DIR

    jobs: list[GeneratedJob] = []
    for index, collector_id in enumerate(scheduled_sources(REPO_ROOT)):
        offset = collection.stagger_minutes * index
        label = f"{LABEL_PREFIX}.{collector_id.replace('_', '-')}"
        jobs.append(
            GeneratedJob(
                label=label,
                collector_id=collector_id,
                runs_at=_cadence(collection.interval_hours, offset),
                path=directory / f"{label}.plist",
                offset_minutes=offset,
            )
        )
    return jobs


def generate(target: Path | None = None, *, session: Session | None = None) -> list[GeneratedJob]:
    """Write one plist per collector. Returns what was written.

    The writing half. Called by `python -m taste_inbox.api.launchd`, which is the first line
    of the install block a person copies — so the plists are rewritten by the same act that
    installs them, with whatever interval is saved at that moment, rather than as a side
    effect of somebody looking at a screen.
    """
    if not collection_available(REPO_ROOT):
        return []

    document = effective_document(session)
    collection = document.collection

    directory = target or LAUNCHD_DIR
    directory.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    jobs = plan(target, session=session)
    for job in jobs:
        job.path.write_bytes(
            plistlib.dumps(
                build_plist(
                    label=job.label,
                    collector_id=job.collector_id,
                    interval_hours=collection.interval_hours,
                    timezone=document.app.timezone,
                )
            )
        )
    return jobs


def _cadence(interval_hours: int, offset_minutes: int) -> str:
    if offset_minutes == 0:
        return f"{interval_hours}시간마다"
    return f"{interval_hours}시간마다 (+{offset_minutes}분)"


def install_commands(jobs: list[GeneratedJob]) -> list[str]:
    """What a person runs to turn these on, and to turn them off again.

    The `sleep` lines are the stagger: launchd starts each job's interval when it is
    loaded, so how far apart the jobs are loaded is how far apart they collect.
    """
    if not jobs:
        return [
            "# Community 배포판에는 로그인 브라우저 자동 수집 작업이 없습니다.",
            "# 직접 추가하거나 본인 계정에서 내보낸 데이터를 가져와 사용하세요.",
        ]

    target = "gui/$(id -u)"
    total = max((job.offset_minutes for job in jobs), default=0)
    lines = [
        "# 설치 — 각 줄을 확인한 뒤 실행하세요.",
        f"# 소스 간격은 sleep으로 만듭니다. 전부 넣는 데 약 {total}분이 걸립니다.",
        "",
        "# 먼저 plist를 지금 저장된 설정으로 다시 씁니다. 화면을 여는 것만으로는",
        "# 파일이 바뀌지 않으니, 등록하는 이 순간에 한 번 씁니다.",
        f"cd {REPO_ROOT / 'apps' / 'api'} && uv run python -m taste_inbox.api.launchd",
        "",
    ]
    loaded_at = 0
    for job in jobs:
        wait = job.offset_minutes - loaded_at
        if wait > 0:
            lines.append(f"sleep {wait * 60}  # {job.collector_id} → +{job.offset_minutes}분")
        lines.append(f"launchctl bootstrap {target} {job.path}")
        loaded_at = job.offset_minutes
    lines.append("")
    lines.append("# 해제")
    for job in jobs:
        lines.append(f"launchctl bootout {target}/{job.label}")
    return lines


def main() -> int:
    """Write the plists, and say where they went.

    Deliberately the only thing in this package with a `__main__`: writing these files is an
    act, and an act belongs to a person running a command, not to a request handler. It
    installs nothing — `launchctl` appears in this repository as text to read, never as a
    process to start.
    """
    jobs = generate()
    for job in jobs:
        print(f"{job.label:<38} {job.runs_at:<20} {job.path}")
    print(f"\n{len(jobs)} plists written. Nothing was installed; run the launchctl lines yourself.")
    return 0


__all__ = ["GeneratedJob", "build_plist", "generate", "install_commands", "plan"]


if __name__ == "__main__":
    raise SystemExit(main())
