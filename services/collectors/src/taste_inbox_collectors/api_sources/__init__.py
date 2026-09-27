"""The surfaces this package collects, as data.

Two rows. Adding a third should be a row here rather than a branch in the CLI — the same
shape the inherited driver uses on the other side of the seam
(`taste_inbox.ingest.collect.COLLECTOR_SHAPES`).

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
    """How this package reaches one official API."""

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
    #: Environment variable naming whose account to read.
    account_env: str
    collect: Callable[..., SourceRun]


SURFACES: dict[str, ApiSurface] = {
    github_stars.SURFACE: ApiSurface(
        surface=github_stars.SURFACE,
        platform=github_stars.PLATFORM,
        label="GitHub 스타",
        token_env="GITHUB_TOKEN",
        # 60 requests an hour unauthenticated is not enough to walk a real star list, and
        # `/user/starred` needs a token to know whose stars are meant at all.
        token_required=True,
        account_env="GITHUB_LOGIN",
        collect=github_stars.collect,
    ),
    huggingface.SURFACE: ApiSurface(
        surface=huggingface.SURFACE,
        platform=huggingface.PLATFORM,
        label="Hugging Face 활동",
        token_env="HF_TOKEN",
        # Public likes answered 200 with no token when this was written; a token only
        # raises the ceiling and covers private repositories.
        token_required=False,
        account_env="HF_USERNAME",
        collect=huggingface.collect_activity,
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
        "accountEnv": entry.account_env,
    }


__all__ = ["SURFACES", "ApiSurface", "describe", "github_stars", "huggingface", "surface_names"]
