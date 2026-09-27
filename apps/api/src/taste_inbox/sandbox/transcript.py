"""Reading what came back from the sandbox.

Two things are extracted and they are not the same kind of fact:

- **what the agent did** — the `--json` envelope's tool calls, turns, stop reason
- **what the boundary refused** — connections OpenShell blocked while it worked

The second is the one this product shows. A blocked egress attempt is not a log line
here: it is a finding the user is told about, because "the repository you starred tried to
reach X while installing" is an observation nothing but the sandbox could have made.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

#: How a refusal shows up in the tooling's own words. Collected from observed output
#: rather than invented: OpenShell's proxy refuses CONNECT, and the clients each phrase it
#: differently, so the host has to be recovered from whichever phrasing appeared.
_BLOCK_PATTERNS = (
    re.compile(r"CONNECT tunnel failed.*?response 403", re.IGNORECASE),
    re.compile(r"(?:blocked|denied|refused) by (?:network )?policy", re.IGNORECASE),
    re.compile(r"Request was cancelled", re.IGNORECASE),
)

_HOST_IN_LINE = re.compile(
    r"https?://([A-Za-z0-9.\-]+\.[A-Za-z]{2,})|\b([A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+){1,}):443\b"
)


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    """One connection the boundary refused, as the user is shown it."""

    host: str | None
    evidence_line: str

    def as_dict(self) -> dict[str, Any]:
        return {"host": self.host, "line": self.evidence_line}


@dataclass(frozen=True, slots=True)
class TrialTranscript:
    """What one sandbox run produced."""

    ok: bool
    stop_reason: str | None
    tool_calls: int
    tool_failures: int
    tools: list[str]
    final_text: str
    model: str | None
    blocked: list[PolicyDecision]

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "stopReason": self.stop_reason,
            "toolCalls": self.tool_calls,
            "toolFailures": self.tool_failures,
            "tools": self.tools,
            "finalText": self.final_text,
            "model": self.model,
            "blocked": [decision.as_dict() for decision in self.blocked],
        }


def envelope_of(text: str) -> dict[str, Any] | None:
    """The last complete JSON object in the output.

    The runtime prints warnings before its envelope (`UNDICI-EHPA`, gateway notices), so
    the envelope is found by decoding rather than by assuming the output starts with `{`.
    """

    decoder = json.JSONDecoder()
    found: dict[str, Any] | None = None
    index = 0
    while True:
        start = text.find("{", index)
        if start == -1:
            return found
        try:
            value, end = decoder.raw_decode(text[start:])
        except ValueError:
            index = start + 1
            continue
        if isinstance(value, dict):
            found = value
        index = start + end


def _search(node: Any, key: str) -> Any:
    """First value for `key` anywhere in a nested structure.

    The envelope's shape is not documented and has moved between versions, so fields are
    located rather than addressed. A missing field then reads as `None` instead of raising
    a KeyError three releases from now.
    """

    if isinstance(node, dict):
        if key in node:
            return node[key]
        for value in node.values():
            found = _search(value, key)
            if found is not None:
                return found
    elif isinstance(node, list):
        for value in node:
            found = _search(value, key)
            if found is not None:
                return found
    return None


def blocked_in(text: str) -> list[PolicyDecision]:
    """Refused connections named anywhere in the output, deduped by host."""

    decisions: list[PolicyDecision] = []
    seen: set[str] = set()
    for line in text.splitlines():
        if not any(pattern.search(line) for pattern in _BLOCK_PATTERNS):
            continue
        match = _HOST_IN_LINE.search(line)
        host = (match.group(1) or match.group(2)).lower() if match else None
        key = host or line.strip()[:80]
        if key in seen:
            continue
        seen.add(key)
        decisions.append(PolicyDecision(host=host, evidence_line=line.strip()[:300]))
    return decisions


def read(stdout: str, stderr: str = "") -> TrialTranscript:
    """Parse one run's output into the shape the Focus Canvas draws."""

    envelope = envelope_of(stdout) or {}
    summary = _search(envelope, "toolSummary") or {}
    completion = _search(envelope, "completion") or {}

    tools = summary.get("tools") if isinstance(summary, dict) else None
    final = _search(envelope, "final") or _search(envelope, "text") or ""

    return TrialTranscript(
        ok=bool(_search(envelope, "ok")),
        stop_reason=completion.get("stopReason") if isinstance(completion, dict) else None,
        tool_calls=int(summary.get("calls") or 0) if isinstance(summary, dict) else 0,
        tool_failures=int(summary.get("failures") or 0) if isinstance(summary, dict) else 0,
        tools=[str(tool) for tool in tools] if isinstance(tools, list) else [],
        final_text=final if isinstance(final, str) else json.dumps(final, ensure_ascii=False),
        model=_search(envelope, "model"),
        # Both streams: the refusal surfaces wherever the tool that hit it wrote.
        blocked=blocked_in(stdout + "\n" + stderr),
    )


__all__ = ["PolicyDecision", "TrialTranscript", "blocked_in", "envelope_of", "read"]
