"""Reading a research report into something the user can act on.

Two products come out of one report:

- a **SuggestedAction** — one sentence saying what is worth doing, with the report behind it
- a **TrialPlan** — what the sandbox agent is asked to do, and what would prove it worked

**The plan stays prose.** It is tempting to parse the report into a command list and
execute that, but the thing on the other side is an agent, not a shell: it reads the
intent, finds the actual entry point, and adapts when the documented command is wrong —
which it often is. Extracting a rigid script would throw away the capability that makes
`Try safely` more than a `Makefile`, and would fail on exactly the repositories where a
human would also have had to improvise.

What *is* extracted mechanically is the part that must not be improvised: **which hosts
the plan needs**. Those become the egress allowlist (`sandbox/policy.py`), and a domain
the agent needs but nobody declared is a blocked request the user sees rather than a
silent widening of the boundary.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

#: Headings AI-Q tends to use for the actionable section. Matched case-insensitively.
#:
#: A miss is not a failure: `plan_text` falls back to the whole report, and the agent is
#: perfectly able to find the relevant part itself. The extraction exists to keep the
#: prompt short, not to keep it correct.
_STEP_HEADING = re.compile(
    # The leading `\d+[.)]` is not decoration: the brief asks three numbered questions, so
    # AI-Q answers under `### 3. Smallest verifiable first step`. Without it the heading
    # never matched and every suggestion came back `actionable: false` — measured on a real
    # report before this was fixed.
    r"^#{0,6}\s*\**\s*(?:\d+\s*[.)]\s*)?\**\s*(?:"
    r"smallest\s+(?:runnable\s+|verifiable\s+)?first\s+step"
    r"|first\s+step"
    r"|getting\s+started"
    r"|quick\s*start"
    r"|how\s+to\s+(?:try|run)\s+it"
    r"|try\s+it\s+locally"
    r")\b.*$",
    re.IGNORECASE | re.MULTILINE,
)

_NEXT_HEADING = re.compile(r"^#{1,6}\s+\S", re.MULTILINE)

_FENCE = re.compile(r"```[a-zA-Z0-9_+-]*\n(.*?)```", re.DOTALL)

_HOST = re.compile(r"https?://([A-Za-z0-9.\-]+\.[A-Za-z]{2,})")

#: Hosts a trial is allowed to ask for. Anything outside this set is dropped from the plan
#: rather than opened: the boundary is the product, and a report is untrusted input that
#: must not be able to widen it by naming a domain (`CLAUDE.md` §7 — web text is data).
ALLOWED_TRIAL_HOSTS = frozenset(
    {
        "github.com",
        "api.github.com",
        "codeload.github.com",
        "raw.githubusercontent.com",
        "objects.githubusercontent.com",
        "pypi.org",
        "files.pythonhosted.org",
        "huggingface.co",
        "cdn-lfs.huggingface.co",
        "registry.npmjs.org",
    }
)


@dataclass(frozen=True, slots=True)
class TrialPlan:
    """What the sandbox agent is asked to do, and what counts as success."""

    subject_id: str
    subject_url: str
    #: The instruction handed to the agent. Prose, deliberately.
    plan_text: str
    #: Success stated before the run, so the result is a comparison rather than an opinion.
    success_criteria: str
    #: Hosts the plan mentions, filtered to the ones a trial may have.
    required_hosts: list[str] = field(default_factory=list)
    #: Hosts the report named that are *not* allowed. Shown, not opened.
    refused_hosts: list[str] = field(default_factory=list)
    commands_seen: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "subjectId": self.subject_id,
            "subjectUrl": self.subject_url,
            "planText": self.plan_text,
            "successCriteria": self.success_criteria,
            "requiredHosts": self.required_hosts,
            "refusedHosts": self.refused_hosts,
            "commandsSeen": self.commands_seen,
        }


@dataclass(frozen=True, slots=True)
class SuggestedAction:
    """The one thing worth doing, and why."""

    subject_id: str
    headline: str
    rationale: str
    plan: TrialPlan
    #: True when the report gave a concrete step. False means the card must not offer
    #: `Try safely` as though there were a plan behind it.
    actionable: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "subjectId": self.subject_id,
            "headline": self.headline,
            "rationale": self.rationale,
            "actionable": self.actionable,
            "plan": self.plan.as_dict(),
        }


def _section(report: str) -> str | None:
    """The actionable section, when the report has one under a recognisable heading."""

    match = _STEP_HEADING.search(report)
    if match is None:
        return None
    rest = report[match.end() :]
    following = _NEXT_HEADING.search(rest)
    body = rest[: following.start()] if following else rest
    body = body.strip()
    return body or None


def _first_sentence(text: str) -> str:
    stripped = re.sub(r"[*_`#]", "", text).strip()
    for line in stripped.splitlines():
        line = line.strip()
        if len(line) > 24:
            parts = re.split(r"(?<=[.!?])\s+", line)
            return parts[0].strip()
    return stripped[:200].strip()


def hosts_in(text: str) -> tuple[list[str], list[str]]:
    """(allowed, refused) hosts named anywhere in the text, deduped and ordered."""

    allowed: list[str] = []
    refused: list[str] = []
    for host in _HOST.findall(text):
        lowered = host.lower()
        bucket = allowed if lowered in ALLOWED_TRIAL_HOSTS else refused
        if lowered not in bucket:
            bucket.append(lowered)
    return allowed, refused


def build(
    *,
    subject_id: str,
    subject_title: str,
    subject_url: str,
    report: str,
) -> SuggestedAction:
    """Read one report into a suggestion and a plan."""

    section = _section(report)
    actionable = section is not None
    plan_body = section or report.strip()

    commands = [block.strip() for block in _FENCE.findall(plan_body) if block.strip()][:6]
    allowed, refused = hosts_in(plan_body)

    # The subject's own host is always needed and is not always mentioned in the prose.
    subject_allowed, _ = hosts_in(subject_url)
    for host in subject_allowed:
        if host not in allowed:
            allowed.insert(0, host)

    headline = (
        _first_sentence(section) if section else f"{subject_title}에 대한 조사 결과를 확인하세요"
    )

    plan_text = (
        f"Work on {subject_title} ({subject_url}).\n\n"
        f"The research below proposes the smallest verifiable first step. Follow its "
        f"intent rather than its exact wording: if a command is wrong or a file has moved, "
        f"find the real entry point and say what you changed.\n\n"
        f"{plan_body}\n\n"
        f"Work only inside the current directory. Do not attempt to reach any host that is "
        f"not required by the steps above; if a request is blocked, report it rather than "
        f"working around it."
    )

    success = (
        "The repository is fetched, its dependencies resolve, and the documented entry "
        "point starts or its test suite runs — or the exact failure is reported with the "
        "command that produced it."
    )

    return SuggestedAction(
        subject_id=subject_id,
        headline=headline,
        rationale=report.strip(),
        actionable=actionable,
        plan=TrialPlan(
            subject_id=subject_id,
            subject_url=subject_url,
            plan_text=plan_text,
            success_criteria=success,
            required_hosts=allowed,
            refused_hosts=refused,
            commands_seen=commands,
        ),
    )


__all__ = ["ALLOWED_TRIAL_HOSTS", "SuggestedAction", "TrialPlan", "build", "hosts_in"]
