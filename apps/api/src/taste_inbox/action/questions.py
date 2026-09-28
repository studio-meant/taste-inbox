"""What is worth asking about this item — offered, never decided.

**Two producers, one list.** The rules below are deterministic and can only ask what a
row's own fields support, which is exactly as far as a rule can see: a repository gets
"does it install", a bundle with models gets "weights or API", and nothing else is
reachable however interesting the paper is. `propose_more()` hands the same evidence to
Nemotron and asks for questions the rules have no field for — the ones that come from
*reading* the report rather than from counting the bundle.

The model widens the range; it does not relax the standard. Every model question carries
the same `because` the rules carry, is dropped when that sentence is missing, and is
labelled `origin="model"` so the screen can say which half of the list wrote it. A
question nobody can act on is still worse than no question, whoever proposed it.

`무엇을 확인할지는 사람, 어떻게 확인할지는 Agent.` This module is the first half of that
sentence and therefore the smaller half: it opens the question, it does not answer it and
it does not pick one. The agent's work starts in `research/question.py`, after a person has
chosen.

**Every suggestion is conditioned on something this product actually holds**, and carries
the sentence that says what. A chip reading "이 모델은 어떤 입력에 약한가요?" on an item with
no model anywhere near it is a question about a thing that does not exist, and the user
cannot tell that from looking at it. So each rule below states a premise, the premise is
checked against the row, and a rule whose premise is false produces nothing — which is why
a bare repository offers three chips and a paper with a full bundle offers four.

Deterministic on purpose. These are *prompts for a person*, and a list that reshuffles
between two renders of the same screen would make the screen untrustworthy for no gain.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: How many chips the composer offers in total, rules and model together.
MAX_SUGGESTIONS = 6

#: How many the model may add. Three rules plus three model questions is the shape the
#: composer was measured against; beyond six the chips stop being suggestions and become a
#: menu the user has to read instead of think.
MAX_MODEL_SUGGESTIONS = 3


@dataclass(frozen=True, slots=True)
class SuggestedQuestion:
    """One question, and the fact in this database that makes it askable."""

    id: str
    text: str
    #: What this was read from. Shown, so an offered question can be judged before it is
    #: chosen — the same rule the rest of the product follows about inferred values.
    because: str
    #: `rule` — a deterministic rule over this row's own fields.
    #: `model` — Nemotron, from the research report. Labelled on screen, because a
    #: sentence a model wrote and a fact this database holds are different things.
    origin: str = "rule"

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "text": self.text,
            "because": self.because,
            "origin": self.origin,
        }


def _normalised(text: str) -> str:
    """For duplicate detection only. Korean spacing varies; the question does not."""

    # `\uff1f` is the fullwidth question mark a Korean IME produces.
    return "".join(text.split()).rstrip("?\uff1f").lower()


def _repo_of(bundle: dict[str, Any] | None) -> str | None:
    if not bundle:
        return None
    repo = bundle.get("repo")
    return repo.get("value") if isinstance(repo, dict) and repo.get("value") else None


def _count(bundle: dict[str, Any] | None, key: str) -> int:
    if not bundle:
        return 0
    rows = bundle.get(key)
    return len(rows) if isinstance(rows, list) else 0


def build(
    *,
    kind: str,
    title: str,
    platform: str,
    bundle: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
    has_research: bool = False,
    actionable: bool | None = None,
    extra: list[dict[str, Any]] | None = None,
) -> list[SuggestedQuestion]:
    """The questions this particular row can support, best first.

    `actionable` is the research suggestion's own verdict: `False` means the report gave no
    concrete step, which changes what is worth asking — the interesting question is then
    what it would take to run the thing at all, not how it behaves once running.
    """

    # Nothing is offered before research, and that is the flow rather than a shortage of
    # rules: the Lab researches first so that a question has something to be *about*, and
    # the planning pass is handed that report for continuity (`api/app.py` refuses a
    # question without one). Chips the user could pick and not act on would be worse than
    # no chips.
    if not has_research:
        return []

    found: list[SuggestedQuestion] = []
    repo = _repo_of(bundle)
    runnable_code = kind in ("repo", "tool") or repo is not None

    # 1. The product's own question, and the only one that needs the sandbox to answer.
    if runnable_code:
        subject = repo or title
        found.append(
            SuggestedQuestion(
                id="runs-here",
                text="이 코드가 내 환경에서 실제로 설치되고 돌아가나요?",
                because=f"실행할 코드가 있어요 — {subject}",
            )
        )

    # 2. Only askable once a report exists to check the claims *of*.
    if has_research:
        found.append(
            SuggestedQuestion(
                id="claims-published",
                text="문서가 말하는 기능이 실제로 전부 공개돼 있나요?",
                because="AI-Q 조사 리포트가 있어서 문서의 주장과 실제 공개 범위를 맞춰볼 수 있어요",
            )
        )

    # 3. A model is a weights question before it is anything else.
    if kind == "model" or _count(bundle, "models") > 0:
        where = "이 항목이 모델이에요" if kind == "model" else "번들에 연결된 모델이 있어요"
        found.append(
            SuggestedQuestion(
                id="weights-or-api",
                text="가중치를 직접 받아 쓸 수 있나요, 아니면 API·데모뿐인가요?",
                because=where,
            )
        )

    # 4. A Space is already running somewhere, which is a different question from a repo.
    if kind == "space" or _count(bundle, "spaces") > 0:
        found.append(
            SuggestedQuestion(
                id="demo-or-library",
                text="데모 수준인가요, 실제로 가져다 쓸 라이브러리·API가 있나요?",
                because="실행 가능한 Space가 연결돼 있어요",
            )
        )

    if kind == "dataset" or _count(bundle, "datasets") > 0:
        found.append(
            SuggestedQuestion(
                id="dataset-shape",
                text="실제 형식과 크기가 어떻게 되고, 바로 읽을 수 있나요?",
                because="데이터셋이 연결돼 있어요",
            )
        )

    # 5. Personal, and the only one that could not be asked about this item in isolation.
    neighbours = (context or {}).get("neighbours") or []
    shared = (context or {}).get("sharedTerms") or []
    if neighbours and isinstance(neighbours[0], dict) and neighbours[0].get("title"):
        neighbour = str(neighbours[0]["title"])
        overlap = ", ".join(str(term) for term in shared[:2]) if shared else None
        found.append(
            SuggestedQuestion(
                id="versus-saved",
                text=f"이미 저장한 {neighbour}와 무엇이 다른가요?",
                because=(
                    f"같은 주제를 공유해요 — {overlap}"
                    if overlap
                    else "저장 이력에서 가까운 항목이에요"
                ),
            )
        )

    # 6. Said last because it is the fallback shape of the first question, and it replaces
    #    it rather than joining it: a report with no runnable step makes "does it run" a
    #    question nobody can plan yet.
    if has_research and actionable is False:
        found = [row for row in found if row.id != "runs-here"]
        found.insert(
            0,
            SuggestedQuestion(
                id="what-would-it-take",
                text="이걸 실제로 한 번 돌려보려면 무엇이 필요한가요?",
                because="리포트에 실행할 수 있는 구체적인 단계가 없었어요",
            ),
        )

    if platform == "arxiv" and not runnable_code:
        found.append(
            SuggestedQuestion(
                id="find-implementation",
                text="구현 저장소가 실제로 존재하나요?",
                because="아직 연결된 코드가 없어요",
            )
        )

    # Nemotron's, stored by the research run that produced them (`research/runner.py`).
    # They join the end of the list rather than the front: a rule's premise was checked
    # against a column, and a model's was checked against a sentence.
    if extra:
        seen = {_normalised(row.text) for row in found}
        for row in extra:
            text = str(row.get("text") or "").strip()
            because = str(row.get("because") or "").strip()
            if not text or not because or _normalised(text) in seen:
                continue
            seen.add(_normalised(text))
            found.append(
                SuggestedQuestion(
                    id=str(row.get("id") or f"model-{len(found)}"),
                    text=text,
                    because=because,
                    origin="model",
                )
            )

    return found[:MAX_SUGGESTIONS]


# --- the model's half ---------------------------------------------------------------


#: What Nemotron is told it is doing. Short on purpose: the constraints that matter are
#: in the prompt beside the evidence, where the model reads them last.
_SYSTEM = (
    "You help someone decide what to verify about a piece of AI research they saved. "
    "You never decide for them. You answer only with JSON."
)

#: How much of the report travels. It is AI-Q's own text going back to a sibling model, so
#: nothing new crosses the boundary — but a 10,000-character report buries the instruction.
REPORT_EXCERPT_CHARS = 3000


def _excerpt(report: str) -> str:
    body = report.strip()
    if len(body) <= REPORT_EXCERPT_CHARS:
        return body
    return body[:REPORT_EXCERPT_CHARS].rsplit("\n", 1)[0] + "\n…"


def propose_more(
    *,
    title: str,
    kind: str,
    canonical_url: str,
    report: str,
    existing: list[SuggestedQuestion],
    bundle: dict[str, Any] | None = None,
    terms: list[str] | None = None,
    limit: int = MAX_MODEL_SUGGESTIONS,
) -> list[dict[str, Any]]:
    """Questions the rules have no field for, read out of the research report.

    Raises `NimUnavailable` — the caller records that on its job step and keeps the
    deterministic questions. There is no second model and no template behind this: a
    failure means the rules alone, which is what the product shipped with.

    **Grounding is the whole contract.** Each answer must carry the fact that makes the
    question askable, and one that does not is dropped here rather than shown with an
    empty reason. That is the same standard the rules meet by construction; a model cannot
    be held to it by construction, so it is held to it by filter.
    """

    from ..research import brief, nim

    arms: list[str] = []
    if bundle:
        repo = bundle.get("repo")
        if isinstance(repo, dict) and repo.get("value"):
            arms.append(f"linked code: {repo['value']}")
        for key, label in (("models", "models"), ("datasets", "datasets"), ("spaces", "demos")):
            rows = bundle.get(key)
            if isinstance(rows, list) and rows:
                arms.append(f"{label}: {len(rows)}")

    already = "\n".join(f"- {row.text}" for row in existing) or "- (none)"
    known = "\n".join(f"- {line}" for line in arms) or "- (the source stated nothing)"
    topics = ", ".join((terms or [])[:8]) or "(none recorded)"

    prompt = brief.scrub(
        f"Subject: {title} ({kind})\n"
        f"URL: {canonical_url}\n"
        f"What the source stated about it:\n{known}\n"
        f"Topics this person keeps saving: {topics}\n\n"
        f"Research report:\n\n{_excerpt(report)}\n\n"
        f"These questions are already offered, so do not repeat them:\n{already}\n\n"
        f"Propose at most {limit} further questions this person could ask about this "
        f"subject, that the list above does not already cover.\n\n"
        "Rules:\n"
        "1. Each question must be answerable by installing or running something inside a "
        "Linux sandbox with no GPU, no Docker and no network beyond the hosts a plan "
        "names, in under 15 minutes. Do not propose training, benchmarking against a "
        "leaderboard, or anything needing hardware.\n"
        "2. Each question must be grounded in a specific claim in the report or a stated "
        "artifact above. Quote or name that claim in `because`. If you cannot name one, "
        "do not include the question.\n"
        "3. Ask about this subject specifically. A question that would fit any repository "
        "is not useful here.\n"
        "4. Write `text` in Korean, as a question the person would ask. Write `because` "
        "in Korean, naming the claim it came from.\n\n"
        'Answer with a JSON array only: [{"text": "...", "because": "..."}]'
    )

    answer = nim.complete(prompt, purpose="suggested_questions", system=_SYSTEM, max_tokens=800)
    rows = nim.json_array(answer.text)

    seen = {_normalised(row.text) for row in existing}
    kept: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        text = str(row.get("text") or "").strip()
        because = str(row.get("because") or "").strip()
        # A reason too short to name anything is not a reason. Measured against the rules'
        # own sentences, the shortest of which is 17 characters.
        if not text or len(because) < 8 or _normalised(text) in seen:
            continue
        seen.add(_normalised(text))
        kept.append({"id": f"model-{index}", "text": text, "because": because})
        if len(kept) >= limit:
            break
    return kept


__all__ = [
    "MAX_MODEL_SUGGESTIONS",
    "MAX_SUGGESTIONS",
    "REPORT_EXCERPT_CHARS",
    "SuggestedQuestion",
    "build",
    "propose_more",
]
