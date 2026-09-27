"""Decide which board a liked post belongs on.

**This is the first thing in Taste Inbox that sends collected content off this machine.**
Everything before it — the collectors, the ingester, the OCR enricher, the GitHub reader —
either stays local or talks to a public API about a public repository. This one hands the
user's own saved text to `claude -p`, a subprocess that reaches a service. Read
`docs/SECURITY_BOUNDARIES.md` §"분류기 경계" before changing anything here; the two-field
payload below is the boundary, and `redact` plus `strip_alt_attribution` are how it is
enforced rather than merely described.

## Why this exists at all

Instagram's saved *collections* stopped answering on 2026-08-09 — the feed endpoint 404s to
Instagram's own web app — and those named collections were the user's own filing, the one
classification `db/models.py` calls "a fact rather than an inference". They cannot grow any
more. The surface that still works is Likes, and a Like says nothing about a board.

So on 2026-08-12 the user decided this product may infer the board, and declined a
filed-versus-inferred distinction in the UI: *"그냥 카테고리를 수정할 수 있는 기능만
추가해줘"*. That is why the answer is written into `item_sources.collection_name`, the same
column the user's own filing lives in, and why `api/cards.py::board_filter` needs no change.
`docs/DECISIONS.md` records the widened meaning of that column.

## What it costs, measured rather than assumed

Run against the 126 already-filed saves, scored against the user's own labels:

* caption alone — **119/126**
* caption plus Instagram's `accessibility_caption` — **123/126**

Of the remaining three, two are posts with no text anywhere (`"🐰🍀"`) and one is a Kyoto
travel caption filed under fashion because the outfit was the point. The failure mode is the
safe one: the model answers `none` rather than filing something wrongly.

Two caveats this module adds on top of that measurement, both deliberate:

* the payload is redacted (URLs and `@handles` removed, the alt text's `Photo shared by …`
  attribution stripped) and **the 123/126 was measured on unredacted text**. Neither a link
  nor a handle is what decides a board, so the expected cost is small — but it is not zero
  and it has not been re-measured.
* only the text goes. Not the image, and the two text-free posts are text-free for the
  classifier too.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Evidence, Item, ItemSource, MediaAsset
from ..ingest.captures import ACCESSIBILITY_EVIDENCE, COVER_ROLE, LIKES_ACTION
from .providers import Unavailable

#: The subprocess. Absent on a machine that never installed it, which is a normal state
#: reported as `Unavailable` rather than raised — the same contract `enrich/ocr.py` uses for
#: `macvis`.
BINARY = "claude"

#: A batch of twenty captions is a few seconds of model time. Long enough that a hundred
#: items is five calls rather than a hundred, short enough that a timeout or a malformed
#: answer costs one batch and the run keeps its earlier work.
BATCH_SIZE = 20

#: Generous for a batch of twenty, short enough that a wedged subprocess cannot hold a run.
TIMEOUT_SECONDS = 180

#: Longest caption sent per item. Instagram allows 2,200 characters and the tail of a long
#: caption is hashtags and credits; the board is decided in the first few lines. Bounding it
#: bounds the payload, which is the thing crossing the boundary.
MAX_TEXT = 600

#: What the model may answer, exactly as the prompt names them.
LABELS: tuple[str, ...] = ("trends", "fashion", "music", "places", "none")

#: The model's label, and the `item_sources.collection_name` it is stored as.
#:
#: **The two vocabularies are not the same and must not be conflated.** `api/cards.py`
#: maps the board `trends` onto the collection the user themselves named `ai`, exactly as it
#: maps `style` onto `fashion`; their word for it is data and is never rewritten. The prompt
#: speaks the product's board names because those are what the four categories mean to a
#: person, and this table is where that is turned back into the value `board_filter`
#: compares against. `tests/test_classify.py` pins it against `BOARD_COLLECTIONS` so the two
#: cannot drift; nothing here imports `api/`, because an enricher reading the presentation
#: layer would be the wrong direction of dependency.
LABEL_COLLECTIONS: dict[str, str] = {
    "trends": "ai",
    "fashion": "fashion",
    "music": "music",
    "places": "places",
}

#: Stored when the model declines. **A value, not a null, and that is the whole point.**
#:
#: `collection_name IS NULL` already means something specific: nobody has decided yet. If a
#: declined post kept that null it would be re-sent on every run — the same hopeless caption
#: crossing the boundary nightly, forever, for an answer that has already been given twice.
#: Writing `none` makes "asked, and there is no board for this" a state the next run can see
#: and skip, which is the same distinction `authors.checked_at` draws between an empty bio
#: and an unread profile.
#:
#: It is safe to put in this column because nothing matches it: `BOARD_COLLECTIONS` holds
#: `ai`, `fashion`, `music`, `places`, and `board_filter`'s other branch requires a routed
#: platform, which Instagram is not. A `none` row is therefore on no board — the same place
#: an unclassified one is, reached deliberately instead of by omission. When the editing
#: affordance arrives it is the value that tells the UI this item was considered.
DECLINED = "none"

#: Verbatim from the measurement that scored 123/126. The board names, their Korean
#: descriptions, the "왜 저장했는가" instruction and the output format are one artefact and
#: are not edited casually — a change here invalidates the number above.
PROMPT = """아래는 인스타그램 게시물 캡션이다. 번호와 캡션이 탭으로 구분되어 있다.
각각을 다음 다섯 중 하나로 분류하라.

trends  — AI, 개발, 도구, UI/UX, 디자인 레퍼런스
fashion — 옷, 코디, 패션 아이템, 뷰티
music   — 음악, 노래, 플레이리스트, 공연
places  — 맛집, 카페, 여행지, 가보고 싶은 장소
none    — 위 어디에도 안 맞음

사용자는 "무엇에 대한 글인가"가 아니라 "왜 저장했는가"로 분류한다.
JSON 객체 하나만 출력하라. 설명 금지. 형식: {"0":"fashion"}"""


# ------------------------------------------------------------------ redaction

#: A link, in the three shapes a caption writes one. Removed because a URL is the single
#: most identifying thing a caption carries and it is never what decides a board.
_URL = re.compile(
    r"""(?xi)
    (?: https? :// \S+ )
    | (?: www\. \S+ )
    | (?: \b [\w-]+ (?: \.[\w-]+ )* \.
          (?: com|net|org|io|me|kr|co\.kr|shop|store|app|dev|ai|link|page )
          \b (?: /\S* )? )
    """
)

#: An `@handle`. Instagram handles are letters, digits, dots and underscores.
#:
#: It must **end** on a letter, digit or underscore, and that is not tidiness. A handle can
#: contain a dot (`@moodybaddie.zip`) and the naive `@[A-Za-z0-9._]{2,30}` therefore swallows
#: the full stop that ends the sentence it sits in — which deleted the period
#: `_ALT_ATTRIBUTION` stops at, and left the strip running to the end of the string and
#: eating the whole description. Measured on this user's own alt text; see `sendable_alt`.
_HANDLE = re.compile(r"@[A-Za-z0-9_](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9_])?")

#: Instagram's own attribution sentence, which names the account that posted.
#:
#: The measured shape is `Photo shared by <name> on <Month> <d>, <year>.` — the collector's
#: `_AUTO_ALT` recognises the same opening for the opposite purpose. The sentence carries no
#: signal about a board and carries the poster's handle, so it is the one part of the alt
#: text that is dropped rather than sent. What follows it — `May be an image of …` — is the
#: half that rescued four posts in the measurement, and it stays.
#:
#: The run to the full stop is **bounded**. Unbounded, an alt text whose attribution somehow
#: lost its period — a shape this has already produced once — matches all the way to the end
#: of the string and deletes the description along with it. 160 characters is far more than
#: any observed attribution and far less than a description worth keeping, so the degenerate
#: case degrades to "keep the description, keep a display name" rather than to silence. No
#: handle survives it either way: `redact` has already run.
_ALT_ATTRIBUTION = re.compile(
    r"^\s*(?:Photo|Video|Reel)\s+(?:shared\s+by|by)\b[^.]{0,160}\.\s*",
    re.IGNORECASE,
)

_WHITESPACE = re.compile(r"\s+")


def strip_alt_attribution(text: str) -> str:
    """Drop `Photo shared by <handle> on <date>.` and keep the description after it."""
    return _ALT_ATTRIBUTION.sub("", text, count=1)


def redact(text: str) -> str:
    """Remove every link and `@handle`, and flatten to one line.

    Applied to text this product did not write, so it is a filter and never a parser: a
    caption is untrusted input (`docs/SECURITY_BOUNDARIES.md`), and the only thing done to
    it here is deletion.

    Flattening matters as much as the deletions. The prompt is `번호 <TAB> 캡션`, one item
    per line, so a caption containing a newline or a tab would silently split into two
    entries and shift every answer after it by one — a misfiling with no error anywhere.
    """
    without_links = _URL.sub(" ", text)
    without_handles = _HANDLE.sub(" ", without_links)
    return _WHITESPACE.sub(" ", without_handles).strip()


@dataclass(frozen=True, slots=True)
class BoardInput:
    """The complete set of things about one item that may leave this machine.

    Two strings. Not the permalink, not the shortcode, not the author, not the `items.id`,
    not the image — none of which is a field of this class, which is the enforcement. A
    future caller cannot add the handle to the payload without adding it here first, and
    `tests/test_classify.py` asserts what the subprocess actually receives.
    """

    #: The author's caption, redacted and flattened.
    caption: str
    #: Instagram's alt text, attribution stripped, redacted and flattened.
    described: str

    @property
    def text(self) -> str:
        """One line, both fields, joined only when both have something to say."""
        return " | ".join(part for part in (self.caption, self.described) if part)[:MAX_TEXT]

    @property
    def is_empty(self) -> bool:
        return not self.text


def build_prompt(entries: Sequence[BoardInput]) -> str:
    """The exact string handed to the subprocess.

    One function so there is one answer to "what leaves this machine", and so a test can ask
    it directly instead of reconstructing it.
    """
    lines = "\n".join(f"{ordinal}\t{entry.text}" for ordinal, entry in enumerate(entries))
    return f"{PROMPT}\n\n{lines}"


# ----------------------------------------------------------------- providers


class BoardClassifier(Protocol):
    """Answers a prompt with `{index: label}`, or says why it could not."""

    def classify(self, prompt: str) -> dict[str, str] | Unavailable: ...


def parse_answer(payload: str) -> dict[str, str] | Unavailable:
    """Read `{"0":"fashion"}` out of whatever came back.

    The prompt says `설명 금지`, and that is an instruction rather than a guarantee. A model
    that wraps the object in a fence or a sentence has still answered, so the outermost
    braces are located instead of the whole of stdout being handed to `json.loads`. A label
    outside `LABELS` is dropped here rather than at the write, so a hallucinated board name
    can never reach `collection_name`.
    """
    start, end = payload.find("{"), payload.rfind("}")
    if start < 0 or end <= start:
        return Unavailable("분류 결과에서 JSON 객체를 찾지 못했어요.")
    try:
        document = json.loads(payload[start : end + 1])
    except json.JSONDecodeError:
        return Unavailable("분류 결과가 올바른 JSON이 아니었어요.")
    if not isinstance(document, dict):
        return Unavailable("분류 결과가 객체가 아니었어요.")

    answers: dict[str, str] = {}
    for key, value in document.items():
        if isinstance(value, str) and value.strip() in LABELS:
            answers[str(key).strip()] = value.strip()
    return answers


class ClaudeCliClassifier:
    """The one that ships: `claude -p <prompt>` as a subprocess.

    Three things about how it is invoked, each of them the reason a line is written the way
    it is:

    * **An argument list, never a shell string.** The prompt contains captions the user did
      not write, and a shell would make that text executable.
    * **The prompt is built by `build_prompt` and nothing else.** This class receives a
      finished string; it cannot reach for an item, a URL or a handle even by accident.
    * **A missing binary is a state, not an exception.** A machine without `claude` reports
      it in Korean and the run ends having changed nothing, exactly as `MacvisOcrProvider`
      does for `macvis`.
    """

    def classify(self, prompt: str) -> dict[str, str] | Unavailable:
        if shutil.which(BINARY) is None:
            return Unavailable(
                f"{BINARY} 명령을 찾지 못해 분류를 건너뛰었어요. "
                "설치한 뒤 다시 실행하면 남은 항목부터 이어서 분류합니다."
            )
        try:
            completed = subprocess.run(  # noqa: S603 - argv list, no shell, fixed binary
                self.command(prompt),
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return Unavailable(f"{BINARY}가 {TIMEOUT_SECONDS}초 안에 답하지 않았어요.")
        except OSError as error:  # pragma: no cover - depends on the host
            return Unavailable(f"{BINARY}를 실행하지 못했어요: {error}")

        if completed.returncode != 0:
            reason = (completed.stderr or "").strip().splitlines()
            return Unavailable(f"{BINARY}가 실패했어요: {reason[-1] if reason else '이유 없음'}")
        return parse_answer(completed.stdout)

    @staticmethod
    def command(prompt: str) -> list[str]:
        """The argv, exposed so a test can assert what the payload contains."""
        return [BINARY, "-p", prompt]


class NoBoardClassifier:
    """For tests, and for a run that should look without sending anything."""

    def classify(self, prompt: str) -> dict[str, str] | Unavailable:
        del prompt
        return Unavailable("분류기가 꺼져 있어요.")


# ------------------------------------------------------------------- reading


@dataclass(slots=True)
class ClassifyReport:
    considered: int = 0
    #: Given a board — `ai`, `fashion`, `music` or `places`.
    classified: int = 0
    #: Answered `none`. Stored, so the next run does not ask again.
    declined: int = 0
    #: Nothing to send: no caption and no alt text. Never handed to the subprocess.
    empty: int = 0
    #: The classifier answered, and the board it named was already recorded for this item
    #: from the user's own filing. See `_assign`.
    merged: int = 0
    #: Batches the classifier could not answer. Their items stay null and are retried.
    unavailable: int = 0
    boards: dict[str, int] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "considered": self.considered,
            "classified": self.classified,
            "declined": self.declined,
            "empty": self.empty,
            "merged": self.merged,
            "unavailable": self.unavailable,
            "boards": self.boards,
            "reasons": self.reasons[:10],
        }


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _described(session: Session, item: Item) -> str:
    """Instagram's alt text, from wherever this item's surface put it.

    Two homes, because two surfaces. A Saved capture carries a photo, so `record_media`
    keeps the alt text on the cover asset; a Likes capture carries no image at all, so
    `record_accessibility_caption` keeps it as evidence. Reading both is what lets one
    classifier serve items collected either way, and the evidence row wins because it is the
    one written by the surface this classifier exists for.

    Returned raw. The caller redacts *before* stripping the attribution, and the order is
    load-bearing — see `sendable_alt`.
    """
    stored = session.scalar(
        select(Evidence.value).where(
            Evidence.item_id == item.id, Evidence.type == ACCESSIBILITY_EVIDENCE
        )
    )
    if not stored:
        stored = session.scalar(
            select(MediaAsset.alt_text).where(
                MediaAsset.item_id == item.id, MediaAsset.role == COVER_ROLE
            )
        )
    return stored or ""


def sendable_alt(raw: str) -> str:
    """Redact, then strip the attribution. **In that order, and measured.**

    The obvious order is the wrong one. A real alt text from this user's own data reads:

        Photo shared by 무디배디 | 윤달 on August 04, 2026 tagging @moodybaddie.zip. May be
        an image of text that says …

    `_ALT_ATTRIBUTION` ends at the first `.`, and that period is **inside the handle** — so
    stripping first ate `…tagging @moodybaddie.` and left `zip.` standing at the front, a
    fragment of the very handle the strip existed to remove. Redacting first deletes
    `@moodybaddie.zip` whole, which puts the sentence's real full stop back where the
    attribution pattern expects it, and the display name goes with it.
    """
    return strip_alt_attribution(redact(raw))


def classification_targets(session: Session) -> list[tuple[ItemSource, BoardInput]]:
    """Liked Instagram posts nobody has decided a board for.

    Three conditions, and each excludes something specific:

    * `collection_name IS NULL` — not yet decided. A row already holding `ai` or `none` has
      been answered and is never re-sent, which is what makes a run resumable.
    * `action_type = "like"` — the Saved memberships already carry the user's own filing and
      must not be overwritten by a guess.
    * `platform = "instagram"` — LinkedIn reactions are also stored as `like` with a null
      collection (`ingest/captures.py::BROWSER_SURFACES`), and they are routed to a board by
      rule rather than classified. Without this, every LinkedIn reaction would be sent.
    """
    rows = session.execute(
        select(ItemSource, Item)
        .join(Item, Item.id == ItemSource.item_id)
        .where(
            ItemSource.collection_name.is_(None),
            ItemSource.action_type == LIKES_ACTION,
            Item.platform == "instagram",
        )
        .order_by(Item.first_seen_at)
    ).all()

    targets: list[tuple[ItemSource, BoardInput]] = []
    for source, item in rows:
        targets.append(
            (
                source,
                BoardInput(
                    caption=redact(item.body_text or ""),
                    described=sendable_alt(_described(session, item)),
                ),
            )
        )
    return targets


# ------------------------------------------------------------------- writing


def _assign(session: Session, source: ItemSource, collection: str, report: ClassifyReport) -> bool:
    """Write one answer, and resolve the one collision the schema allows.

    Returns whether a row was actually given this board. A merge is not a filing — the item
    was already on that board — and counting it as one would make `classified` a number that
    does not match how many rows moved.

    `item_sources` is unique on `(item_id, source_account_id, collection_name)`, and Saved
    and Likes share the single Instagram account row — `source_accounts` is unique on
    `(platform, handle)` and Instagram's handle is null, so there is exactly one. A post the
    user both filed under `fashion` and liked therefore has two membership rows, and the
    moment this writes `fashion` onto the second one they collide.

    The collision is resolved by **dropping the row this classifier owns**. The surviving row
    says the user filed this post onto this board, which is the stronger claim and the one
    `db/models.py` calls a fact; the duplicate would put the item on the board twice, because
    `board_query` joins `item_sources` and would return it once per matching row. What is
    lost is "and they also liked it" — a fact about a post already on the board it belongs
    to, which is the cheapest thing on the table.
    """
    twin = session.scalar(
        select(ItemSource).where(
            ItemSource.item_id == source.item_id,
            ItemSource.source_account_id == source.source_account_id,
            ItemSource.collection_name == collection,
            ItemSource.id != source.id,
        )
    )
    if twin is not None:
        session.delete(source)
        report.merged += 1
        return False
    source.collection_name = collection
    return True


def classify_boards(
    session: Session,
    *,
    classifier: BoardClassifier | None = None,
    limit: int | None = None,
    batch_size: int = BATCH_SIZE,
) -> ClassifyReport:
    """Give every undecided liked post a board, in batches, resumably.

    **The collection cycle calls this** (`ingest/collect.py::_classify_pending`), so content
    leaves this machine on a timer. That was not the first design — it was a printed reminder,
    on the reasoning that a timer cannot authorise a transmission — and the user overrode it
    on 2026-08-12 because a reminder made the feature manual in practice.

    What replaced supervision is construction: `BoardInput` has two fields, so the payload
    cannot grow to include a handle or a permalink without someone editing that class; a
    decided row is never asked twice, including a declined one; and the cycle is capped, so a
    backlog is worked off over several rather than sent at once. `--no-classify` refuses it.

    Resumability is a property of the data rather than of a checkpoint: an answered row is no
    longer null, so it is not a target, so it is never sent twice. A batch the classifier
    could not answer leaves its rows null and is retried next run, and every batch commits on
    its own so a failure at item 80 keeps the first 79.
    """
    reader = classifier or ClaudeCliClassifier()
    report = ClassifyReport()

    targets = classification_targets(session)
    if limit is not None:
        targets = targets[:limit]

    sendable: list[tuple[ItemSource, BoardInput]] = []
    for source, entry in targets:
        report.considered += 1
        if entry.is_empty:
            # No caption and no alt text. There is nothing to classify and nothing worth
            # sending, so it is declined here without a subprocess ever seeing it — two of
            # the three misses in the measurement were posts of exactly this shape.
            report.empty += 1
            report.declined += 1
            _assign(session, source, DECLINED, report)
            continue
        sendable.append((source, entry))
    session.commit()

    for start in range(0, len(sendable), batch_size):
        batch = sendable[start : start + batch_size]
        answers = reader.classify(build_prompt([entry for _, entry in batch]))
        if isinstance(answers, Unavailable):
            report.unavailable += 1
            report.reasons.append(answers.reason)
            # Left null on purpose: unanswered is not declined, and the next run must ask
            # again rather than record a refusal nobody made.
            continue
        _apply(session, batch, answers, report)
        session.commit()

    return report


def _apply(
    session: Session,
    batch: Sequence[tuple[ItemSource, BoardInput]],
    answers: dict[str, str],
    report: ClassifyReport,
) -> None:
    stamp = _now()
    for ordinal, (source, _entry) in enumerate(batch):
        label = answers.get(str(ordinal))
        if label is None:
            # The model skipped this index. Not an answer, so not recorded as one.
            continue
        if label == DECLINED:
            _assign(session, source, DECLINED, report)
            report.declined += 1
            continue
        if label not in LABEL_COLLECTIONS:
            # `parse_answer` already drops these, and this guards the same thing one layer
            # in: `BoardClassifier` is a protocol, so the dictionary reaching here has only
            # been checked if the provider that produced it did the checking. A board name
            # nobody offered must never reach `collection_name`, where it would be a
            # collection no screen renders and no filter can clear.
            report.reasons.append(f"알 수 없는 분류 '{label}'")
            continue
        collection = LABEL_COLLECTIONS[label]
        if _assign(session, source, collection, report):
            report.classified += 1
            report.boards[collection] = report.boards.get(collection, 0) + 1
        # Outside the branch: a merged item was looked at too, and `checked_at` is the
        # promise that something looked rather than the record of a row having moved.
        item = session.get(Item, source.item_id)
        if item is not None:
            item.checked_at = stamp
            item.updated_at = stamp


__all__ = [
    "BATCH_SIZE",
    "BINARY",
    "DECLINED",
    "LABELS",
    "LABEL_COLLECTIONS",
    "PROMPT",
    "BoardClassifier",
    "BoardInput",
    "ClassifyReport",
    "ClaudeCliClassifier",
    "NoBoardClassifier",
    "build_prompt",
    "classification_targets",
    "classify_boards",
    "parse_answer",
    "redact",
    "sendable_alt",
    "strip_alt_attribution",
]
