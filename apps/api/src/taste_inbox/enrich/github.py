"""Read what a GitHub repository declares about itself.

Unauthenticated, read-only, and strictly limited to files the repository publishes. It
answers one question — *what does this project say it needs?* — and no longer feeds a
second one. Deciding whether a repository would run on this Mac went with the sandbox
runner (docs/DECISIONS.md, 2026-08-09); the declarations survived it, because what a
README states is a fact about the README.

Nothing here estimates. A README that says "needs a beefy GPU" produces `mentions_cuda`,
not a memory figure: `DESIGN.md` §3.5 puts inference beside its evidence, and a number with
no source is not evidence of anything.

Rate limits are real — 60 requests an hour unauthenticated — so this is polite about them
and reports being throttled rather than retrying into a block (`CLAUDE.md` §7).
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

from .providers import Fact, RepositoryFacts, Unavailable

API_ROOT = "https://api.github.com"
RAW_ROOT = "https://raw.githubusercontent.com"
_TIMEOUT_SECONDS = 12
#: A manifest is small. Anything larger is not the file we asked for.
MAX_FILE_BYTES = 256 * 1024

_HEADERS = {
    "User-Agent": "TasteInbox/0.1 (local personal archive)",
    "Accept": "application/vnd.github+json",
}

#: Files that *declare* rather than describe.
#:
#: Fetched only when the root listing says they exist. Trying all four blindly cost four
#: requests per repository and, measured across the five collected ones, produced nothing
#: at all — they are TypeScript and Jupyter projects with no `pyproject.toml` to find. One
#: listing request replaces four guesses and is right about which files are there.
MANIFESTS = ("pyproject.toml", ".python-version", "requirements.txt", "package.json")

_PYTHON_REQUIRES = re.compile(r'requires-python\s*=\s*["\']([^"\']+)["\']')
_PYTHON_VERSION_FILE = re.compile(r"^\s*(\d+\.\d+(?:\.\d+)?)")
_CUDA = re.compile(r"\b(cuda|nvidia|cudnn|nvcc|torch\+cu\d+)\b", re.IGNORECASE)
_ARM64 = re.compile(r"\b(arm64|aarch64|apple\s*silicon|m[1-4]\s*(mac|chip))\b", re.IGNORECASE)
#: Environment variable names only — never a value (SECURITY_BOUNDARIES).
_ENV_NAME = re.compile(r"\b([A-Z][A-Z0-9]{2,}_(?:API_)?(?:KEY|TOKEN|SECRET))\b")


def owner_and_repo(canonical_url: str) -> tuple[str, str] | None:
    parts = urlparse(canonical_url)
    if parts.hostname not in {"github.com", "www.github.com"}:
        return None
    segments = [segment for segment in parts.path.split("/") if segment]
    if len(segments) < 2:
        return None
    return segments[0], segments[1].removesuffix(".git")


def _get(url: str) -> tuple[bytes | None, str | None]:
    # Checked rather than asserted by comment: both roots are literals in this module, but
    # a future caller passing something else should fail here, not reach the network.
    if not url.startswith((API_ROOT + "/", RAW_ROOT + "/")):
        return None, "refused"

    request = urllib.request.Request(url, headers=_HEADERS)  # noqa: S310 - checked above
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:  # noqa: S310
            return response.read(MAX_FILE_BYTES), None
    except urllib.error.HTTPError as error:
        if error.code == 403:
            # Unauthenticated GitHub allows 60 requests an hour. Saying so beats retrying
            # into a block.
            return None, "rate_limited"
        if error.code == 404:
            return None, "not_found"
        return None, f"http_{error.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return None, type(error).__name__


class GitHubRepositoryProvider:
    """Reads the repository API and a handful of declared manifests."""

    def fetch(self, canonical_url: str) -> RepositoryFacts | Unavailable:
        names = owner_and_repo(canonical_url)
        if names is None:
            return Unavailable("GitHub 저장소 주소가 아니에요.")
        owner, repo = names

        body, error = _get(f"{API_ROOT}/repos/{owner}/{repo}")
        if body is None:
            return Unavailable(
                {
                    "rate_limited": "GitHub 요청 한도에 걸렸어요. 잠시 뒤에 다시 시도합니다.",
                    "not_found": "저장소를 찾을 수 없어요. 비공개이거나 삭제됐을 수 있습니다.",
                }.get(error or "", f"저장소 정보를 읽지 못했어요 ({error}).")
            )

        try:
            payload: dict[str, Any] = json.loads(body)
        except json.JSONDecodeError:
            return Unavailable("저장소 응답을 읽지 못했어요.")

        facts: list[Fact] = []
        description = payload.get("description")
        language = payload.get("language")
        license_name = (payload.get("license") or {}).get("name")
        branch = payload.get("default_branch") or "main"

        if description:
            facts.append(Fact("저장소 설명", str(description), canonical_url))
        if language:
            facts.append(Fact("주 언어", str(language), canonical_url))
        if license_name:
            facts.append(Fact("라이선스", str(license_name), canonical_url))

        declared_python: str | None = None
        secrets: list[str] = []
        cuda = False
        arm64 = False

        for name in self._present_manifests(owner, repo):
            raw_url = f"{RAW_ROOT}/{owner}/{repo}/{branch}/{name}"
            content, _ = _get(raw_url)
            if content is None:
                continue
            text = content.decode("utf-8", errors="replace")

            if declared_python is None:
                declared_python = _declared_python(name, text)
                if declared_python:
                    facts.append(Fact(f"{name}이 선언한 Python", declared_python, raw_url))

            if not cuda and _CUDA.search(text):
                cuda = True
                facts.append(Fact(f"{name}에 CUDA/NVIDIA 언급", "있음", raw_url))
            if not arm64 and _ARM64.search(text):
                arm64 = True
                facts.append(Fact(f"{name}에 arm64 언급", "있음", raw_url))

            for match in _ENV_NAME.findall(text):
                if match not in secrets:
                    secrets.append(match)

        return RepositoryFacts(
            full_name=f"{owner}/{repo}",
            description=str(description) if description else None,
            primary_language=str(language) if language else None,
            declared_python=declared_python,
            mentions_cuda=cuda,
            mentions_arm64=arm64,
            declared_secrets=tuple(secrets[:12]),
            license_name=str(license_name) if license_name else None,
            facts=tuple(facts),
        )

    def _present_manifests(self, owner: str, repo: str) -> list[str]:
        """Which of `MANIFESTS` the repository actually has.

        One request instead of four blind ones. If the listing itself fails, nothing is
        fetched rather than falling back to guessing — a rate limit is exactly when extra
        requests are worst.
        """
        body, _ = _get(f"{API_ROOT}/repos/{owner}/{repo}/contents/")
        if body is None:
            return []
        try:
            entries = json.loads(body)
        except json.JSONDecodeError:
            return []
        if not isinstance(entries, list):
            return []

        names = {
            str(entry.get("name"))
            for entry in entries
            if isinstance(entry, dict) and entry.get("type") == "file"
        }
        return [name for name in MANIFESTS if name in names]


def _declared_python(filename: str, text: str) -> str | None:
    if filename == "pyproject.toml":
        found = _PYTHON_REQUIRES.search(text)
        return found.group(1) if found else None
    if filename == ".python-version":
        found = _PYTHON_VERSION_FILE.match(text)
        return found.group(1) if found else None
    return None


__all__ = ["GitHubRepositoryProvider", "owner_and_repo"]
