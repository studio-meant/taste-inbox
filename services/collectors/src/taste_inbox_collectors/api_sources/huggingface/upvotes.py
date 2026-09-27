"""Paper upvotes — a source that does not exist yet, saying so.

This module implements nothing. It exists because "we cannot collect upvoted papers" is a
*finding*, and a finding that lives only in a design document rots the first time someone
wonders whether it was ever checked.

## What was checked, on 2026-09-28

| Probe | Result |
| --- | --- |
| Hub OpenAPI spec, 295 paths, searched for a user-upvote listing | none |
| `GET /api/users/{u}/upvotes` | 404 |
| `GET /api/users/{u}/papers` | 404 |
| `GET /api/users/{u}/activity` (and `?activityType=upvote`) | 404 |
| `GET https://huggingface.co/{u}/upvotes` (the HTML profile tab) | **401** |
| `GET /api/users/{u}/overview` | 200 — `numUpvotes` and `numPapers` are **counts**, no list |

So upvotes are public as a *number* and private as a *list*.

## Why we do not reach for the remaining option

The logged-in HTML page could be scraped. That would break the collector boundary this
product inherited — `CLAUDE.md` §2 forbids imitating a login session, and
`SECURITY_BOUNDARIES.md` limits inputs to official APIs and platform exports. Being
local-first does not change either rule; the boundary travels with the product, not with
the deployment.

## What happens instead

Papers arrive through the artifacts the user liked (`papers.py`), and a specific paper can
be added by hand through the inherited `POST /api/items/manual` with its
`huggingface.co/papers/<id>` URL. Neither needs a source that is not offered.

If the Hub publishes a listing, this module becomes about fifteen lines and the surface
turns on. Until then it returns a reason, in the shape the rest of the product already
uses for "no answer, and why" rather than an empty answer that reads as "nothing found".
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Unavailable:
    """No answer, and why — never an empty answer that reads as "nothing found"."""

    reason: str


#: Verbatim, for the Settings screen and the run notes. Korean because it is user-facing
#: copy in a Korean-first product, and the sentence has to say *why* rather than just no.
REASON = (
    "Hugging Face는 업보트한 논문 목록을 공개 API로 제공하지 않습니다 "
    "(개수만 공개, 목록은 401). 좋아요한 모델·데이터셋의 arXiv 태그를 따라 "
    "논문을 가져오며, 특정 논문은 링크로 직접 추가할 수 있어요."
)


def get_upvoted_papers() -> Unavailable:
    """Always unavailable. See the module docstring for what was measured."""

    return Unavailable(reason=REASON)


__all__ = ["REASON", "Unavailable", "get_upvoted_papers"]
