"""Reading a research report into something the user can act on.

Two products come out of one report:

- a **SuggestedAction** — one sentence saying what is worth doing, with the report behind it
- a **TrialPlan** — what the sandbox agent is asked to do, and what would prove it worked

**Two inputs, and the difference between them is the product.** With the research report
alone this builds the *Suggested Trial*: AI-Q's own idea of the smallest first step, offered
before anyone has said what they want. With a user question and the planning report that
answered it (`research/question.py`), it builds the trial for *that question* instead — the
verification goal and the acceptance criteria come from the plan, so success is stated in
the user's terms rather than in "it installed". The first is a suggestion; the second is
the thing this product exists to do, and only a person can start it.

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

#: The three headings `research/question.py` asks the planning pass for, by name.
#:
#: Matched loosely on the wording and strictly on the order, because AI-Q reliably keeps the
#: numbering it is given and less reliably keeps the exact words. A heading that does not
#: come back leaves its field `None`, and the screen says the agent did not state it —
#: writing an acceptance criterion here would be this product grading its own homework.
_PLAN_HEADINGS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "goal",
        re.compile(
            r"^#{0,6}\s*\**\s*(?:1\s*[.)]\s*)?\**\s*verification\s+goal\b.*$",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    (
        "criteria",
        re.compile(
            r"^#{0,6}\s*\**\s*(?:2\s*[.)]\s*)?\**\s*acceptance\s+criteri(?:a|on)\b.*$",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    (
        "plan",
        re.compile(
            r"^#{0,6}\s*\**\s*(?:3\s*[.)]\s*)?\**\s*trial\s+plan\b.*$",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
)

#: `**Option A — Docker …**`, `Option 2: …` — a report offering alternatives.
_OPTION = re.compile(r"^\W{0,4}option\s+[a-z0-9]\b", re.IGNORECASE | re.MULTILINE)

#: What the sandbox is, stated to the agent up front. Each line was observed rather than
#: assumed: the OpenShell image has no Docker daemon (a report's `docker run` path fails
#: there), `Sandbox GPU: disabled` in `nemoclaw status`, and the policy binary lists name
#: git, python3, pip/uv, node and npm. Saying so costs one paragraph; discovering it costs
#: tool calls and model time — the first Golden Path run spent fifty calls and then timed
#: out on the model. The interpreter line is from the second run's policy ledger: `uv` tried
#: releases.astral.sh and github.com for a Python build, four times each, and was refused.
SANDBOX_FACTS = (
    "About this environment: a Linux shell inside an OpenShell sandbox. Available: git, "
    "python3 with pip and uv, node and npm. Not available: Docker, a display or GUI, a GPU, "
    "sudo. Use the system python3: interpreter downloads (`uv python install`, pyenv) are "
    "not reachable from here. If the first option below needs one of those, take the next "
    "option that does not — usually running from source — and say which one you took and why."
)

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
    #: The user's own question, when one was asked. None means this is the suggested trial.
    question: str | None = None
    #: What would answer it, in one sentence, as AI-Q stated it. None when the planning
    #: pass did not state it — never written here.
    verification_goal: str | None = None
    #: The observable results that would settle it, verbatim from the planning report.
    acceptance_criteria: str | None = None
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
            "question": self.question,
            "verificationGoal": self.verification_goal,
            "acceptanceCriteria": self.acceptance_criteria,
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
    #: `"suggested"` when AI-Q proposed this unprompted, `"question"` when it was designed
    #: for something the user asked. The screen says which, because the two are different
    #: claims about whose idea the trial was.
    origin: str = "suggested"

    def as_dict(self) -> dict[str, Any]:
        return {
            "subjectId": self.subject_id,
            "headline": self.headline,
            "rationale": self.rationale,
            "actionable": self.actionable,
            "origin": self.origin,
            "plan": self.plan.as_dict(),
        }


def _plan_sections(report: str) -> dict[str, str]:
    """The three headings the planning pass was asked for, each with its body.

    Missing headings are simply absent from the result. The caller must treat absence as
    "the agent did not say", never as a cue to write one.
    """

    found: dict[str, str] = {}
    for name, pattern in _PLAN_HEADINGS:
        match = pattern.search(report)
        if match is None:
            continue
        rest = report[match.end() :]
        following = _NEXT_HEADING.search(rest)
        body = (rest[: following.start()] if following else rest).strip()
        if body:
            found[name] = body
    return found


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
    question: str | None = None,
    plan_report: str | None = None,
) -> SuggestedAction:
    """Read one report into a suggestion and a plan.

    With `question` and `plan_report`, the trial is built for that question instead: the
    plan body, the verification goal and the acceptance criteria all come from the planning
    pass, and `report` stays only as the rationale behind them. Passing a question without a
    planning report is a plan that has not arrived yet, and produces the suggested trial —
    the caller says which state the screen is in, this does not guess.
    """

    planned = _plan_sections(plan_report) if (question and plan_report) else {}
    goal = planned.get("goal")
    criteria = planned.get("criteria")
    # A question with no plan behind it is a planning pass that is still running or that
    # failed, and the answer is the *suggested* trial — unchanged, and not dressed up as
    # an answer to a question nobody has designed a check for. The screen shows the open
    # question separately, from `asked`.
    question = question if planned else None

    if planned:
        # The plan section is the instruction; the goal and criteria travel with it so the
        # agent is told what it is trying to establish, not only what to type.
        section = planned.get("plan") or plan_report
        actionable = "plan" in planned
    else:
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

    options = len(_OPTION.findall(section)) if section else 0
    if goal is not None:
        # The user asked; the headline is what answering them would establish, in AI-Q's
        # words rather than this module's.
        headline = _first_sentence(goal)
    elif section is None:
        headline = f"{subject_title}에 대한 조사 결과를 확인하세요"
    elif options >= 2:
        # Quoting the first option would promise it — and the first is often the one the
        # sandbox cannot do (`docker run`, a desktop installer). The agent picks.
        headline = f"리포트가 제시한 방법 {options}가지 중 샌드박스에서 되는 것부터 시도하기"
    else:
        headline = _first_sentence(section)

    if question:
        # The question leads, because it is the thing the run has to answer. Everything
        # after it is how — and the agent is told to report the question unanswered rather
        # than to substitute an easier one it can answer.
        intent = (
            f"Work on {subject_title} ({subject_url}).\n\n"
            f"The person wants to know one thing:\n\n    {question.strip()}\n\n"
            + (f"What would answer it: {goal}\n\n" if goal else "")
            + (f"What counts as an answer:\n\n{criteria}\n\n" if criteria else "")
            + "Below is the plan for getting there. Follow its intent rather than its "
            "exact wording: if a command is wrong or a file has moved, find the real entry "
            "point and say what you changed. If the plan turns out not to answer the "
            "question, say that — do not answer a different question instead."
        )
    else:
        intent = (
            f"Work on {subject_title} ({subject_url}).\n\n"
            f"The research below proposes the smallest verifiable first step. Follow its "
            f"intent rather than its exact wording: if a command is wrong or a file has "
            f"moved, find the real entry point and say what you changed."
        )

    plan_text = (
        f"{intent}\n\n"
        f"{SANDBOX_FACTS}\n\n"
        f"{plan_body}\n\n"
        f"Stop as soon as the success condition is met; do not download model weights or "
        f"build more than the check needs.\n\n"
        f"Work only inside the current directory. Do not attempt to reach any host that is "
        f"not required by the steps above; if a request is blocked, report it rather than "
        f"working around it."
    )

    #: The generic one, used when nobody has asked anything specific. It describes the run
    #: rather than an answer, which is exactly right for a step nobody requested.
    default_success = (
        "The repository is fetched, its dependencies resolve, and the documented entry "
        "point starts or its test suite runs — or the exact failure is reported with the "
        "command that produced it."
    )

    return SuggestedAction(
        subject_id=subject_id,
        headline=headline,
        rationale=report.strip(),
        actionable=actionable,
        origin="question" if planned else "suggested",
        plan=TrialPlan(
            subject_id=subject_id,
            subject_url=subject_url,
            plan_text=plan_text,
            success_criteria=criteria or default_success,
            question=question,
            verification_goal=goal,
            acceptance_criteria=criteria,
            required_hosts=allowed,
            refused_hosts=refused,
            commands_seen=commands,
        ),
    )


__all__ = [
    "ALLOWED_TRIAL_HOSTS",
    "SANDBOX_FACTS",
    "SuggestedAction",
    "TrialPlan",
    "build",
    "hosts_in",
]
