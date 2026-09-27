"""Read the words printed on a saved cover image.

Twenty of the forty-one Music Reels carry no Instagram audio attribution, so the caption
parser and the attribution parser both have nothing to work with and the card can only say
"릴스를 열어 직접 확인해 주세요". On several of those the song list is *printed on the
cover* — the one place neither parser looks.

`macvis` is a single Swift binary over Apple's Vision framework. It matters here for one
reason beyond convenience: **it runs on this machine and the image never leaves it**. The
alternative — a hosted vision API — would mean uploading the user's saved images, which
`CLAUDE.md` §10 puts behind explicit approval. This does not need that approval because
there is no third party.

Two properties of the real output shaped everything below, measured over the twenty covers:

- **It misreads.** `Lullaby / JayDon, Paradise` came back as `ullaby / Jay pon, Paraoise`.
  That is why nothing here is a `fact`: the text on the image is a fact, but what the
  recogniser returned is a reading of it, and the two differ often enough to matter.
- **Its confidence is effectively binary** — every line scored 1.0 or 0.5, and 0.5 held
  both pure noise (`DO`, `MO`, `~`) and two real tracks (`chanel - 40`, `say so - byjaye`).
  So confidence is recorded and never used as a filter; it would drop real answers.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from .providers import Unavailable

#: The binary. Absent on a machine that never installed it, which is a normal state
#: reported as `Unavailable` rather than an exception.
BINARY = "macvis"

#: Generous for a ~0.3s call, short enough that a wedged process cannot hold a nightly run.
TIMEOUT_SECONDS = 20


@dataclass(frozen=True, slots=True)
class OcrLine:
    text: str
    #: As returned. Recorded for the evidence row, never used to include or exclude a line.
    confidence: float


@dataclass(frozen=True, slots=True)
class OcrRead:
    """What the recogniser returned for one image. Possibly nothing, which is normal."""

    lines: tuple[OcrLine, ...] = field(default_factory=tuple)

    @property
    def text(self) -> str:
        return "\n".join(line.text for line in self.lines)

    @property
    def mean_confidence(self) -> float | None:
        if not self.lines:
            return None
        return sum(line.confidence for line in self.lines) / len(self.lines)


class OcrProvider(Protocol):
    """Reads printed text out of a local image."""

    def read(self, image_path: str) -> OcrRead | Unavailable: ...


class MacvisOcrProvider:
    """The one that ships, when the binary is present.

    Two things about how it is invoked:

    - **An argument list, never a shell string.** The path comes out of the database, and a
      shell would make it executable text.
    - **Resolved to an absolute path first.** The stored value is relative, and a relative
      path that began with `-` would be handed to an argument parser as something that
      could be read as a flag. An absolute path starts with `/` and cannot be. The file is
      also confirmed to exist here, so a missing cached cover is reported as missing rather
      than reaching the recogniser and coming back as a failure to describe.
    """

    def read(self, image_path: str) -> OcrRead | Unavailable:
        if shutil.which(BINARY) is None:
            return Unavailable(
                f"{BINARY}가 설치되어 있지 않아 표지 글자를 읽지 못했어요. "
                f"`brew install junmo-kim/tap/{BINARY}`로 설치할 수 있어요."
            )

        target = Path(image_path).resolve()
        if not target.is_file():
            return Unavailable(f"표지 파일이 없어요: {image_path}")

        try:
            completed = subprocess.run(  # noqa: S603 - argv list, absolute path, no shell
                [BINARY, "ocr", "--format", "json", str(target)],
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return Unavailable(f"{BINARY}가 {TIMEOUT_SECONDS}초 안에 끝나지 않았어요.")
        except OSError as error:  # pragma: no cover - depends on the host
            return Unavailable(f"{BINARY}를 실행하지 못했어요: {error}")

        if completed.returncode != 0:
            return Unavailable(f"{BINARY}가 실패했어요: {_failure_reason(completed)}")

        return parse(completed.stdout)


def _failure_reason(completed: subprocess.CompletedProcess[str]) -> str:
    """Why it failed, from wherever it said so.

    `macvis` reports a load failure as JSON on **stdout** with a non-zero exit — reading
    only stderr yielded "이유 없음" for the one failure mode most likely to occur, a cover
    that is no longer on disk.
    """
    try:
        document = json.loads(completed.stdout)
    except json.JSONDecodeError:
        document = None
    if isinstance(document, dict) and document.get("error"):
        return f"{document['error']} ({document.get('reason', '')})".strip()

    lines = (completed.stderr or "").strip().splitlines()
    return lines[-1] if lines else "이유 없음"


def parse(payload: str) -> OcrRead | Unavailable:
    """Read `macvis ocr --format json` output.

    Tolerant about the schema rather than trusting it: a version bump that renames a field
    should degrade to "nothing read", not to a traceback in the middle of a nightly run.
    """
    try:
        document = json.loads(payload)
    except json.JSONDecodeError:
        return Unavailable(f"{BINARY} 출력을 읽지 못했어요.")
    if not isinstance(document, dict):
        return Unavailable(f"{BINARY} 출력 형식이 예상과 달라요.")

    raw = document.get("lines")
    if not isinstance(raw, list):
        return OcrRead()

    lines: list[OcrLine] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        text = entry.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        confidence = entry.get("confidence")
        lines.append(
            OcrLine(
                text=text.strip(),
                confidence=float(confidence) if isinstance(confidence, int | float) else 0.0,
            )
        )
    return OcrRead(tuple(lines))


class NoOcrProvider:
    """For tests and for anyone who would rather not run a recogniser at all."""

    def read(self, image_path: str) -> OcrRead | Unavailable:
        del image_path
        return Unavailable("표지 글자 인식이 꺼져 있어요.")


__all__ = [
    "BINARY",
    "TIMEOUT_SECONDS",
    "MacvisOcrProvider",
    "NoOcrProvider",
    "OcrLine",
    "OcrProvider",
    "OcrRead",
    "parse",
]
