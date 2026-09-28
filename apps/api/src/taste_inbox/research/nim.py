"""NVIDIA Nemotron, through the hosted NIM endpoint.

    POST {NVIDIA_NIM_BASE_URL}/chat/completions      (OpenAI-compatible)

AI-Q already reasons with Nemotron — its own `llms:` block routes every research agent to
`integrate.api.nvidia.com`, and the relay traces prove it (`nemotron-3-ultra-550b-a55b`,
272 calls). This module is the *second* door to the same models: the two places the
product wants a sentence from a model without wanting a whole research run behind it.

- **widening the suggested questions** (`action/questions.py`) — the rules can only ask
  what a row's own fields support, which is exactly as far as a rule can see
- **reading a finished trial** (`sandbox/trial.py`) — turning exit codes, a transcript and
  a refusal list into what was and was not established

## Why `super`, measured rather than chosen

    nvidia/nemotron-3-super-120b-a12b     0.69 s
    nvidia/nemotron-3-ultra-550b-a55b    37.1  s

Both answered; only one can sit in a path a person waits on. `ultra` stays where it
belongs — inside AI-Q, behind a job that already takes minutes. `super` is also the model
NemoClaw's gateway is configured with, so the sandbox agent and this module reason with
the same weights.

## What crosses, and what does not

The same boundary `research/brief.py` draws, enforced by the same function: every prompt
built for this module goes through `brief.scrub()` before it is sent. Public identifiers,
AI-Q's own report text, topic terms and the sandbox's own output about a public
repository — never a handle, a token, a path, or another item's text.

## No silent fallback

A failure raises. Callers record the failure on the job step and keep whatever the
deterministic path produced; nothing substitutes a different model and reports success
(`docs/next_step/next_step_nemotron`, §10). A screen may only say `Nemotron` about a
sentence Nemotron actually wrote.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

#: NVIDIA's hosted catalog endpoint — the free prototyping path, and the one AI-Q's own
#: config points at. Overridable, so a self-hosted NIM is a variable rather than a patch.
BASE_URL_ENV = "NVIDIA_NIM_BASE_URL"
DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"

#: Verified on this host (see the module docstring for the measurement).
MODEL_ENV = "NVIDIA_NIM_MODEL"
DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b"

#: Reused rather than introduced: AI-Q's config and NemoClaw both already read this name.
KEY_ENV = "NVIDIA_API_KEY"

#: Generous against the 0.69 s that was measured, and short enough that a hung endpoint
#: cannot hold a job open. Both callers run inside a background job, never a request.
DEFAULT_TIMEOUT_SECONDS = 45.0


class NimUnavailable(RuntimeError):
    """Nemotron could not be reached or used, with the reason kept for the job step."""


@dataclass(frozen=True, slots=True)
class NimAnswer:
    """One completion, with the provenance a screen is allowed to print.

    `model` is what the endpoint said it used, not what was asked for — the two are the
    same today and a screen that printed the request would be reporting an intention.
    """

    text: str
    model: str
    base_url: str
    latency_seconds: float
    purpose: str

    def trace(self) -> str:
        """One line for `job_steps.message`: provider, model, purpose, how long.

        The telemetry `docs/next_step/next_step_nemotron` §9 asks for, in a column that
        already exists and is already on screen. Success and timestamp travel with the
        step itself.
        """

        return f"nvidia_nim · {self.model} · {self.purpose} · {self.latency_seconds:.1f}s"


def resolve() -> tuple[str, str]:
    """(base_url, model). Raises when there is no key rather than sending without one."""

    if not os.environ.get(KEY_ENV, "").strip():
        raise NimUnavailable(
            f"{KEY_ENV}가 설정되지 않아 Nemotron을 부르지 않았습니다. `.env`에 넣어주세요."
        )
    base = os.environ.get(BASE_URL_ENV, "").strip() or DEFAULT_BASE_URL
    return base.rstrip("/"), os.environ.get(MODEL_ENV, "").strip() or DEFAULT_MODEL


def complete(
    prompt: str,
    *,
    purpose: str,
    system: str | None = None,
    max_tokens: int = 700,
    temperature: float = 0.3,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> NimAnswer:
    """One turn. `purpose` is recorded, never sent.

    `prompt` is expected to have been scrubbed by the caller — this function does not know
    what a handle or a token looks like, and a second opinion here would be a second place
    for the boundary to be defined.
    """

    base_url, model = resolve()
    messages: list[dict[str, str]] = []
    if system is not None:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    body = json.dumps(
        {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": 0.9,
            # Nemotron's reasoning trace is not wanted here: both callers need a short,
            # parseable answer, and the trace triples the tokens to get to it.
            "chat_template_kwargs": {"enable_thinking": False},
        }
    ).encode("utf-8")

    request = urllib.request.Request(  # noqa: S310 — https, from a variable we resolved
        f"{base_url}/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {os.environ[KEY_ENV].strip()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            payload: Any = json.load(response)
    except urllib.error.HTTPError as error:
        # The endpoint's own words, truncated. A 401 here is a key problem and a 429 is a
        # rate limit, and the difference is the whole content of the failure.
        detail = error.read()[:400].decode("utf-8", "replace")
        raise NimUnavailable(f"NVIDIA NIM이 {error.code}로 답했습니다: {detail}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise NimUnavailable(f"NVIDIA NIM에 연결하지 못했습니다: {error}") from error
    except json.JSONDecodeError as error:
        raise NimUnavailable("NVIDIA NIM이 JSON이 아닌 응답을 보냈습니다.") from error

    latency = time.monotonic() - started
    try:
        choice = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise NimUnavailable("NVIDIA NIM 응답에서 본문을 찾지 못했습니다.") from error
    if not isinstance(choice, str) or not choice.strip():
        raise NimUnavailable("NVIDIA NIM이 빈 답을 보냈습니다.")

    return NimAnswer(
        text=choice.strip(),
        # What the endpoint reports, falling back to what we asked for.
        model=str(payload.get("model") or model),
        base_url=base_url,
        latency_seconds=latency,
        purpose=purpose,
    )


def json_array(answer: str) -> list[dict[str, Any]]:
    """The JSON array in a model's answer, or an empty list.

    Models fence JSON and prepend a sentence however firmly they are asked not to, so the
    outermost `[...]` is taken rather than the whole string parsed. **Anything that does
    not parse is nothing** — an unparseable answer is a failed call, not a reason to
    salvage fragments with a regular expression.
    """

    start = answer.find("[")
    end = answer.rfind("]")
    if start == -1 or end <= start:
        return []
    try:
        parsed = json.loads(answer[start : end + 1])
    except json.JSONDecodeError:
        return []
    return [row for row in parsed if isinstance(row, dict)] if isinstance(parsed, list) else []


__all__ = [
    "BASE_URL_ENV",
    "DEFAULT_BASE_URL",
    "DEFAULT_MODEL",
    "DEFAULT_TIMEOUT_SECONDS",
    "KEY_ENV",
    "MODEL_ENV",
    "NimAnswer",
    "NimUnavailable",
    "complete",
    "json_array",
    "resolve",
]
