"""The NVIDIA NIM client, and the two places a Nemotron answer may and may not appear.

The endpoint is replaced at `urllib.request.urlopen`, the one call this module makes. What
is pinned here is not the wire format — NVIDIA owns that — but the four promises the rest
of the product is allowed to rely on:

- a failure **raises**, and the reason is the endpoint's own words
- nothing falls back to another model
- an unparseable answer is nothing, not fragments
- the key is read from the environment and never appears in a message
"""

from __future__ import annotations

import io
import json
import urllib.error
import urllib.request
from email.message import Message
from typing import Any

import pytest

from taste_inbox.research import nim


class _Response(io.BytesIO):
    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def _answer(content: str, *, model: str = "nvidia/nemotron-3-super-120b-a12b") -> _Response:
    return _Response(
        json.dumps({"model": model, "choices": [{"message": {"content": content}}]}).encode()
    )


@pytest.fixture
def key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(nim.KEY_ENV, "nvapi-" + "x" * 24)
    monkeypatch.delenv(nim.BASE_URL_ENV, raising=False)
    monkeypatch.delenv(nim.MODEL_ENV, raising=False)


# --- the boundary ---------------------------------------------------------------------


def test_no_key_refuses_before_sending(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unset key is a refusal, not a request without an Authorization header."""

    monkeypatch.delenv(nim.KEY_ENV, raising=False)
    sent: list[Any] = []
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: sent.append(a))

    with pytest.raises(nim.NimUnavailable, match=nim.KEY_ENV):
        nim.complete("anything", purpose="suggested_questions")
    assert sent == []


def test_the_key_travels_in_the_header_and_not_in_the_body(
    key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, Any] = {}

    def urlopen(request: Any, timeout: float = 0) -> _Response:
        captured["headers"] = dict(request.headers)
        captured["body"] = request.data.decode()
        captured["url"] = request.full_url
        return _answer("OK")

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    nim.complete("hello", purpose="suggested_questions")

    assert captured["url"] == f"{nim.DEFAULT_BASE_URL}/chat/completions"
    assert captured["headers"]["Authorization"].startswith("Bearer nvapi-")
    assert "nvapi-" not in captured["body"]


def test_the_model_and_endpoint_are_overridable(key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    """A self-hosted NIM is a variable, not a patch."""

    monkeypatch.setenv(nim.BASE_URL_ENV, "https://nim.internal/v1/")
    monkeypatch.setenv(nim.MODEL_ENV, "nvidia/other-model")
    assert nim.resolve() == ("https://nim.internal/v1", "nvidia/other-model")


# --- failure is failure ---------------------------------------------------------------


def test_an_http_error_carries_the_endpoints_own_words(
    key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A 401 is a key problem and a 429 is a rate limit; the difference is the content."""

    body = json.dumps({"error": {"message": "Service temporarily overloaded"}}).encode()

    def urlopen(*_: Any, **__: Any) -> None:
        raise urllib.error.HTTPError(
            "https://x/v1/chat/completions",
            503,
            "Service Unavailable",
            Message(),
            io.BytesIO(body),
        )

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)

    with pytest.raises(nim.NimUnavailable) as caught:
        nim.complete("hello", purpose="evidence_interpretation")
    assert "503" in str(caught.value)
    assert "Service temporarily overloaded" in str(caught.value)


def test_an_unreachable_endpoint_raises_rather_than_answering(
    key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    def urlopen(*_: Any, **__: Any) -> None:
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)

    with pytest.raises(nim.NimUnavailable, match="연결하지 못했습니다"):
        nim.complete("hello", purpose="suggested_questions")


def test_an_empty_answer_is_a_failure(key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: _answer("   "))

    with pytest.raises(nim.NimUnavailable, match="빈 답"):
        nim.complete("hello", purpose="suggested_questions")


# --- what a caller gets ---------------------------------------------------------------


def test_the_trace_names_provider_model_purpose_and_latency(
    key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`docs/next_step/next_step_nemotron` §9, in a column that already exists."""

    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: _answer("hi"))

    answer = nim.complete("hello", purpose="evidence_interpretation")
    trace = answer.trace()

    assert trace.startswith("nvidia_nim · nvidia/nemotron-3-super-120b-a12b")
    assert "evidence_interpretation" in trace
    assert trace.endswith("s")


def test_the_model_reported_is_the_endpoints_not_the_request(
    key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A screen that printed what was asked for would be reporting an intention."""

    monkeypatch.setattr(
        urllib.request, "urlopen", lambda *a, **k: _answer("hi", model="nvidia/served-this")
    )
    assert nim.complete("hello", purpose="suggested_questions").model == "nvidia/served-this"


# --- parsing --------------------------------------------------------------------------


def test_json_survives_a_fence_and_a_preamble() -> None:
    """Models fence JSON however firmly they are asked not to."""

    answer = 'Sure!\n```json\n[{"text": "a?", "because": "b"}]\n```\nHope that helps.'
    assert nim.json_array(answer) == [{"text": "a?", "because": "b"}]


@pytest.mark.parametrize(
    "answer",
    [
        "I could not think of any.",
        "[{oops]",
        '{"text": "not an array"}',
        "",
    ],
)
def test_an_unparseable_answer_is_nothing_rather_than_fragments(answer: str) -> None:
    """Salvaging pieces of a malformed answer is how a half-sentence becomes a question."""

    assert nim.json_array(answer) == []


def test_non_object_entries_are_dropped() -> None:
    assert nim.json_array('["a string", {"text": "kept"}, 3]') == [{"text": "kept"}]
