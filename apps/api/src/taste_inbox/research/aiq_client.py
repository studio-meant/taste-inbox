"""Talking to NVIDIA AI-Q, through the skill's own helper.

**The helper script is the client.** `~/.claude/skills/aiq-research/scripts/aiq.py` has no
third-party dependencies and already implements the job lifecycle, the URL validation and
the guardrails NVIDIA ships with the skill. Reimplementing that against the HTTP API would
mean owning a second copy of rules we are told to follow — and the first time AI-Q changed
a route, ours would be the copy that was wrong.

So this module spawns it. The seam is the same one the collectors use: a subprocess and
JSON, no shared imports.

## The guardrails this module is responsible for

`aiq-research/SKILL.md` places obligations on the caller, and several of them are
decisions rather than mechanics, so they live here rather than in the script:

- **the backend URL is stated before a query is sent** — `describe_target()`, and the API
  surfaces it so the screen can show where the text went
- **a non-local URL must be https and explicitly trusted** — `resolve_server()` refuses
  anything else rather than sending and apologising
- **never auto-retry a failed job** — `research()` returns the failure; nothing loops
- **citations and source URLs survive intact** — the report is stored verbatim

What must *not* be sent is enforced one layer up, in `brief.py`: no credentials, no
personal text, no handles.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

#: No default backend. The skill's examples use `localhost:8000`, and on the machine this
#: was built on that port belongs to an unrelated local service — an unset variable would
#: have sent the brief there. The skill requires the target to be stated before a query is
#: sent; an explicit `AIQ_SERVER_URL` is how it is stated.
ENV_VAR = "AIQ_SERVER_URL"

#: Where `npx skills add` / the documented user-level install puts the skill.
DEFAULT_SKILL_DIR = Path.home() / ".claude" / "skills" / "aiq-research"

#: The script needs 3.11+. The system `python3` is often older, so the interpreter is
#: resolved rather than assumed — a 3.9 here fails with a syntax error deep inside the
#: helper, which is a confusing way to learn about a version requirement.
_INTERPRETER_CANDIDATES = ("python3.13", "python3.12", "python3.11", "python3")

#: Long enough for a shallow pass plus polling; a deep run is submitted and polled instead.
DEFAULT_TIMEOUT_SECONDS = 900


class AiqUnavailable(RuntimeError):
    """AI-Q could not be reached or used, with the reason kept for the screen."""


@dataclass(frozen=True, slots=True)
class AiqReport:
    """One completed research job."""

    job_id: str | None
    report: str
    #: The raw envelope, stored so a later reader can find fields we did not model.
    raw: dict[str, Any]
    server_url: str

    @property
    def has_report(self) -> bool:
        return bool(self.report.strip())


def resolve_server(url: str | None = None) -> str:
    """The backend this run will talk to, or a refusal.

    A remote endpoint may log prompts and metadata, so the skill requires it to be trusted
    before anything is sent. Being local-first, this product's default is a backend on this
    machine; anything else has to be https and deliberately configured. There is no
    fallback address: an unset variable is a refusal, not a guess.
    """

    resolved = (url or os.environ.get(ENV_VAR) or "").strip()
    if not resolved:
        raise AiqUnavailable(
            "AIQ_SERVER_URL이 설정되지 않았습니다. 조사를 보낼 AI-Q 백엔드 주소를 명시해 주세요 "
            "(예: http://127.0.0.1:8010)."
        )
    parts = urlsplit(resolved)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise AiqUnavailable(f"AIQ_SERVER_URL is not a usable http(s) url: {resolved!r}")
    if parts.username or parts.password:
        raise AiqUnavailable("AIQ_SERVER_URL must not carry credentials")
    local = parts.hostname in ("localhost", "127.0.0.1", "::1")
    if not local and parts.scheme != "https":
        raise AiqUnavailable(f"a non-local AI-Q backend must use https: {resolved!r}")
    return resolved.rstrip("/")


def describe_target(url: str | None = None, *, what: str = "조사 질의를") -> str:
    """The sentence the skill requires before any query is sent.

    `what` names what is going: a question's planning pass sends a 검증 설계 요청, not a
    조사 질의, and the Lab printed the second for the first.
    """

    resolved = resolve_server(url)
    local = urlsplit(resolved).hostname in ("localhost", "127.0.0.1", "::1")
    where = "이 기계" if local else "외부 서버"
    return f"{what} {resolved} ({where}) 로 보냅니다."


def _interpreter() -> str:
    for name in _INTERPRETER_CANDIDATES:
        found = shutil.which(name)
        if found:
            return found
    raise AiqUnavailable("no python3 interpreter found for the aiq-research helper")


def _script(skill_dir: Path | None = None) -> Path:
    directory = skill_dir or Path(os.environ.get("AIQ_SKILL_DIR", DEFAULT_SKILL_DIR))
    script = directory / "scripts" / "aiq.py"
    if not script.is_file():
        raise AiqUnavailable(
            f"aiq-research skill not found at {script}. Install it with "
            "`npx skills add nvidia/skills --skill aiq-research`, or set AIQ_SKILL_DIR."
        )
    return script


def _run(
    arguments: list[str],
    *,
    server_url: str,
    skill_dir: Path | None,
    timeout: float,
) -> str:
    environment = {**os.environ, "AIQ_SERVER_URL": server_url}
    try:
        completed = subprocess.run(  # noqa: S603 — argv built here, never from user text
            [_interpreter(), str(_script(skill_dir)), *arguments],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=environment,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise AiqUnavailable(f"aiq-research timed out after {timeout:.0f}s") from error

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()
        tail = detail[-1] if detail else f"exit {completed.returncode}"
        raise AiqUnavailable(f"aiq-research failed: {tail}")
    return completed.stdout


def _last_json_object(text: str) -> dict[str, Any]:
    """The helper prints progress before its result; take the last complete object."""

    decoder = json.JSONDecoder()
    found: dict[str, Any] | None = None
    index = 0
    while True:
        start = text.find("{", index)
        if start == -1:
            break
        try:
            value, end = decoder.raw_decode(text[start:])
        except ValueError:
            index = start + 1
            continue
        if isinstance(value, dict):
            found = value
        index = start + end
    if found is None:
        raise AiqUnavailable("aiq-research returned no JSON object")
    return found


def health(*, server_url: str | None = None, skill_dir: Path | None = None) -> dict[str, Any]:
    """Whether a usable backend is there. Run before any query, per the skill."""

    resolved = resolve_server(server_url)
    return _last_json_object(_run(["health"], server_url=resolved, skill_dir=skill_dir, timeout=30))


def ensure_backend(server_url: str, *, skill_dir: Path | None = None) -> None:
    """Refuse unless the target answers as a healthy AI-Q backend.

    Resolving the URL proves only that it is well-formed and local. Something else can be
    listening there — on the machine this was built on, AI-Q's own Dask dashboard took the
    port this product's API defaults to. The skill says to check health before any query,
    and this is where a brief is kept from going to whatever happens to answer.
    """

    try:
        state = health(server_url=server_url, skill_dir=skill_dir)
    except AiqUnavailable as error:
        raise AiqUnavailable(f"{server_url} 에서 AI-Q가 응답하지 않습니다: {error}") from error
    if str(state.get("status") or "").lower() != "healthy":
        raise AiqUnavailable(f"{server_url} 의 AI-Q 상태가 healthy가 아닙니다: {state}")


def agents(*, server_url: str | None = None, skill_dir: Path | None = None) -> list[str]:
    payload = _last_json_object(
        _run(["agents"], server_url=resolve_server(server_url), skill_dir=skill_dir, timeout=30)
    )
    return [
        str(entry.get("agent_type"))
        for entry in payload.get("agents") or []
        if isinstance(entry, dict) and entry.get("agent_type")
    ]


def research(
    query: str,
    *,
    agent_type: str = "shallow_researcher",
    server_url: str | None = None,
    skill_dir: Path | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> AiqReport:
    """Submit, poll and return one report.

    **No retry.** A failed job comes back as `AiqUnavailable` with the backend's own
    message; deciding whether to ask again is the user's, which is what the skill says and
    what stops a research loop from spending an afternoon on a broken query.
    """

    resolved = resolve_server(server_url)
    output = _run(
        ["research", query, agent_type],
        server_url=resolved,
        skill_dir=skill_dir,
        timeout=timeout,
    )
    payload = _last_json_object(output)

    status = str(payload.get("status") or "").lower()
    if status in ("failed", "failure", "cancelled"):
        raise AiqUnavailable(f"AI-Q job {status}: {payload.get('error') or payload}")

    report = payload.get("report")
    return AiqReport(
        job_id=str(payload["job_id"]) if payload.get("job_id") else None,
        report=report if isinstance(report, str) else "",
        raw=payload,
        server_url=resolved,
    )


__all__ = [
    "DEFAULT_SKILL_DIR",
    "DEFAULT_TIMEOUT_SECONDS",
    "ENV_VAR",
    "AiqReport",
    "AiqUnavailable",
    "agents",
    "describe_target",
    "ensure_backend",
    "health",
    "research",
    "resolve_server",
]
