import type { TodayPayload } from "@taste-inbox/shared";

/**
 * Mock Today payload.
 *
 * Content follows the IA §7.2 wireframe with the items in `./seed`. Every value is
 * invented; no real account, repository or paper appears.
 *
 * It deliberately includes a partial-failure case (the paper-upvote reader stopped) and a
 * low-confidence related item, because those are the two states the Today page is most
 * likely to render wrong. `leadConnection` is always null from the live service today; the
 * fixture carries one so the panel that will draw it keeps rendering in tests.
 */
export const MOCK_TODAY: TodayPayload = {
  date: "2026-08-08",
  greeting: "지난 수집 이후의 발견을 정리했어요.",
  counts: {
    newItems: 4,
    readyActions: 1,
    attention: 1,
  },
  leadConnection: {
    id: "sample-reasoning-paper",
    kind: "paper",
    title: "Sample Reasoning: Small Models That Check Their Own Work",
    summary: "작은 모델이 스스로 답을 검산하도록 학습하는 방법을 제안한 논문이에요.",
    relationNote: "논문의 코드 저장소와 데모 Space가 함께 공개되어 있어요.",
    source: {
      platform: "huggingface",
      label: "Hugging Face",
      originalUrl: "https://huggingface.co/papers/2599.00001",
      author: null,
      actionType: "upvote",
      firstSeenAt: "2026-08-08T06:30:00Z",
    },
    readiness: null,
    href: "/items/sample-reasoning-paper",
    confidence: 0.94,
  },
  relatedConnections: [
    {
      id: "tiny-distilled-model",
      kind: "model",
      title: "sample-org/tiny-distilled",
      summary: "4-bit 기준 4.2GB, 간단한 tool-use 데모 포함.",
      relationNote: "같은 작업 흐름에서 함께 쓰기 좋아요.",
      source: {
        platform: "huggingface",
        label: "Hugging Face",
        originalUrl: "https://huggingface.co/sample-org/tiny-distilled",
        author: "sample-org",
        actionType: "like",
        firstSeenAt: "2026-08-08T06:33:00Z",
      },
      readiness: null,
      href: "/items/tiny-distilled-model",
      confidence: 0.71,
    },
    {
      id: "evaluation-harness-manifest-patterns",
      kind: "repo",
      title: "sample-org/evaluation-harness-manifest-patterns",
      summary: "row artifact → dataset artifact → validator gate 구조를 참고할 수 있어요.",
      relationNote: "검증 단계 설계에 참고할 만합니다.",
      source: {
        platform: "github",
        label: "GitHub",
        originalUrl: "https://github.com/sample-org/evaluation-harness-manifest-patterns",
        author: "sample-org",
        actionType: "star",
        firstSeenAt: "2026-08-08T06:29:00Z",
      },
      readiness: null,
      href: "/items/evaluation-harness-manifest-patterns",
      // Low confidence, so it sits in a related slot rather than the lead
      // (PAGE_SPECIFICATIONS §5.2 Ranking).
      confidence: 0.42,
    },
  ],
  savedSummary: {
    newItemCount: 4,
    kindCounts: { repo: 2, model: 1, paper: 1 },
    sources: ["github", "huggingface"],
    href: "/library?day=2026-08-08",
  },
  workingQueue: [
    {
      id: "queue-sample-reasoning-paper",
      kind: "research_running",
      target: "Sample Reasoning",
      nextStep: "AI-Q가 조사하는 중",
      href: "/focus/sample-reasoning-paper",
      progress: 0.5,
    },
    {
      id: "queue-garden-lens",
      kind: "approval_required",
      target: "sample-org/garden-lens",
      nextStep: "안전하게 실행할지 결정하기",
      href: "/focus/garden-lens",
      progress: null,
    },
    {
      id: "queue-large-batch-trainer",
      kind: "trial_blocked",
      target: "sample-org/large-batch-trainer",
      nextStep: "샌드박스가 차단된 연결을 보고했어요",
      href: "/focus/cuda-only-trainer",
      progress: null,
    },
  ],
  previousDays: [
    {
      date: "2026-08-07",
      label: "어제",
      itemCount: 3,
      highlights: [
        {
          id: "tiny-eval-set",
          kind: "dataset",
          platform: "huggingface",
          title: "sample-org/tiny-eval-set",
          meta: "Hugging Face",
          href: "/items/tiny-eval-set",
        },
        {
          id: "sketch-to-scene",
          kind: "space",
          platform: "huggingface",
          title: "sample-org/sketch-to-scene",
          meta: "Hugging Face",
          href: "/items/sketch-to-scene",
        },
        {
          id: "cuda-only-trainer",
          kind: "repo",
          platform: "github",
          title: "sample-org/large-batch-trainer",
          meta: "GitHub",
          href: "/items/cuda-only-trainer",
        },
      ],
    },
  ],
  suggestedQueries: [
    {
      id: "q-with-code",
      text: "코드가 공개된 논문만 보여줘",
      reason: "오늘 들어온 논문 1개에 코드 저장소가 있어요.",
    },
    {
      id: "q-needs-me",
      text: "내가 처리해야 하는 것부터 정리해줘",
      reason: "확인이 필요한 항목이 1개 있어요.",
    },
  ],
  sourceStatusSummary: {
    sources: [
      {
        platform: "github",
        label: "GitHub",
        state: "collected",
        collectedCount: 3,
        lastRunAt: "2026-08-08T06:31:00Z",
      },
      {
        platform: "huggingface",
        label: "Hugging Face",
        state: "failed",
        collectedCount: 4,
        lastRunAt: "2026-08-08T06:33:04Z",
      },
    ],
  },
};
