"""What is worth asking about this item — offered, never decided.

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

#: How many chips the composer offers. Four is the reference's row; beyond it the chips
#: stop being suggestions and become a menu the user has to read instead of thinking.
MAX_SUGGESTIONS = 4


@dataclass(frozen=True, slots=True)
class SuggestedQuestion:
    """One question, and the fact in this database that makes it askable."""

    id: str
    text: str
    #: What this was read from. Shown, so an offered question can be judged before it is
    #: chosen — the same rule the rest of the product follows about inferred values.
    because: str

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "text": self.text, "because": self.because}


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

    return found[:MAX_SUGGESTIONS]


__all__ = ["MAX_SUGGESTIONS", "SuggestedQuestion", "build"]
