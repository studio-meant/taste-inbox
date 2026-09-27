"""The surfaces this package collects, as data.

Three rows. A fourth should be a row here rather than a branch in the CLI — the same
shape the inherited driver uses on the other side of the seam
(`taste_inbox.ingest.collect.COLLECTOR_SHAPES`). `huggingface_upvotes` was the first to
test that: it arrived as a row and no caller changed.

Surface ids are the contract between the two packages: `apps/api` names them in
`API_SOURCE_ORDER`, stores them in `checkpoints.collector_id`, and writes them into the
capture filename. They are not display strings and must not be renamed casually.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from ..capture_file import SourceRun
from . import github_stars, huggingface


@dataclass(frozen=True, slots=True)
class ApiSurface:
    """How this package reaches one collection surface."""

    #: The collector id shared with `apps/api`. Also the capture filename.
    surface: str
    #: Which platform's rows this produces, for the ingester's account lookup.
    platform: str
    #: Human label, Korean-first, for run output and the Settings screen.
    label: str
    #: Environment variable holding the token, when one is needed.
    token_env: str
    #: Whether a run is impossible without that token, or merely rate-limited.
    token_required: bool
    #: False when the surface is not in the Hub's published OpenAPI spec.
    #:
    #: `huggingface_upvotes` reads the public JSON the Hub's own activity page reads, which
    #: is a user-approved exception with conditions (`docs/DECISIONS.md` §2026-09-28). The
    #: flag exists so the Settings screen can say so rather than presenting an unofficial
    #: path as an official one — and so a future reader can find every such path by
    #: grepping one field instead of reading three modules.
    official: bool
    #: Environment variable naming whose account to read.
    account_env: str
    collect: Callable[..., SourceRun]


SURFACES: dict[str, ApiSurface] = {
    github_stars.SURFACE: ApiSurface(
        surface=github_stars.SURFACE,
        platform=github_stars.PLATFORM,
        label="GitHub 스타",
        token_env="GITHUB_TOKEN",  # noqa: S106 — the variable's name, not its value
        # 60 requests an hour unauthenticated is not enough to walk a real star list, and
        # `/user/starred` needs a token to know whose stars are meant at all.
        token_required=True,
        official=True,
        account_env="GITHUB_LOGIN",
        collect=github_stars.collect,
    ),
    huggingface.SURFACE: ApiSurface(
        surface=huggingface.SURFACE,
        platform=huggingface.PLATFORM,
        label="Hugging Face 좋아요",
        token_env="HF_TOKEN",  # noqa: S106 — the variable's name, not its value
        # Public likes answered 200 with no token when this was written; a token only
        # raises the ceiling and covers private repositories.
        token_required=False,
        official=True,
        account_env="HF_USERNAME",
        collect=huggingface.collect_activity,
    ),
    huggingface.UPVOTES_SURFACE: ApiSurface(
        surface=huggingface.UPVOTES_SURFACE,
        platform=huggingface.PLATFORM,
        label="Hugging Face 논문 업보트",
        token_env="HF_TOKEN",  # noqa: S106 — the variable's name, not its value
        # The listing is read with no token at all — that is a condition of the exception,
        # not an optimisation. A token, when present, is used only for the paper documents.
        token_required=False,
        official=False,
        account_env="HF_USERNAME",
        collect=huggingface.upvotes.collect,
    ),
}


def surface_names() -> tuple[str, ...]:
    return tuple(SURFACES)


def describe(surface: str) -> dict[str, Any]:
    entry = SURFACES[surface]
    return {
        "surface": entry.surface,
        "platform": entry.platform,
        "label": entry.label,
        "tokenEnv": entry.token_env,
        "tokenRequired": entry.token_required,
        "official": entry.official,
        "accountEnv": entry.account_env,
    }


__all__ = ["SURFACES", "ApiSurface", "describe", "github_stars", "huggingface", "surface_names"]
