import type { TodayPayload } from "@taste-inbox/shared";

/**
 * Mock Today payload.
 *
 * Content follows the IA §7.2 wireframe. Every value is invented; no real account,
 * handle, post or price appears. Phase 2 replaces this with `GET /api/today`.
 *
 * It deliberately includes a partial-failure case (LinkedIn `auth_required`) and a
 * low-confidence related item, because those are the two states the Today page is most
 * likely to render wrong.
 */
export const MOCK_TODAY: TodayPayload = {
  date: "2026-08-08",
  greeting: "지난 수집 이후의 발견을 정리했어요.",
  counts: {
    newItems: 17,
    readyActions: 2,
    attention: 1,
  },
  leadConnection: {
    id: "garden-lens",
    domain: "trends",
    title: "Garden Lens",
    summary: "여러 버전의 학습 데이터를 시각적으로 비교하고 행 단위 lineage를 추적하는 탐색기예요.",
    relationNote: "직접 만들고 있는 데이터 검증 흐름과 구조가 겹칩니다.",
    source: {
      platform: "github",
      label: "GitHub Star",
      originalUrl: "https://github.com/example/garden-lens",
      author: "example",
      actionType: "star",
      firstSeenAt: "2026-08-08T06:31:00Z",
    },
    readiness: null,
    href: "/items/garden-lens",
    media: null,
    confidence: 0.94,
  },
  relatedConnections: [
    {
      id: "tiny-distilled-model",
      domain: "trends",
      title: "Tiny distilled model for Apple Silicon",
      summary: "4-bit 기준 4.2GB, 간단한 tool-use 데모 포함.",
      relationNote: "같은 작업 흐름에서 함께 쓰기 좋아요.",
      source: {
        platform: "huggingface",
        label: "Threads Repost",
        originalUrl: "https://huggingface.co/example/tiny-distilled",
        author: "example",
        actionType: "repost",
        firstSeenAt: "2026-08-08T06:33:00Z",
      },
      readiness: null,
      href: "/items/tiny-distilled-model",
      media: null,
      confidence: 0.71,
    },
    {
      id: "evaluation-harness-manifest-patterns",
      domain: "trends",
      title: "Evaluation harness manifest patterns",
      summary: "row artifact → dataset artifact → validator gate 구조를 참고할 수 있어요.",
      relationNote: "검증 단계 설계에 참고할 만합니다.",
      source: {
        platform: "github",
        label: "GitHub Star",
        originalUrl: "https://github.com/example/evaluation-harness-manifest-patterns",
        author: "example",
        actionType: "star",
        firstSeenAt: "2026-08-08T06:29:00Z",
      },
      readiness: null,
      href: "/items/evaluation-harness-manifest-patterns",
      media: null,
      // Low confidence, so it sits in a related slot rather than the lead
      // (PAGE_SPECIFICATIONS §5.2 Ranking).
      confidence: 0.42,
    },
  ],
  savedSummary: {
    newItemCount: 17,
    // The reference's own figures (`17 new items · AI 11 · Style 6`), kept literally so the
    // fixture still says what the approved design says. Music and Places are zero here
    // rather than absent — the multi-board case is exercised by its own test instead of by
    // bending these numbers away from the reference.
    aiCount: 11,
    styleCount: 6,
    musicCount: 0,
    placesCount: 0,
    // The same seventeen by what they are — the split the card draws (2026-09-28).
    kindCounts: { post: 7, outfit: 6, repo: 4 },
    sources: ["github", "instagram", "threads", "linkedin"],
    preview: {
      id: "grey-pleated-skirt-1",
      type: "image",
      src: "/mock-media/grey-pleated-skirt.svg",
      width: 1080,
      height: 1350,
      alt: "사이드 버클 디테일이 있는 그레이 울 블렌드 미니 스커트",
      blurDataUrl: null,
    },
    previews: [
      {
        id: "grey-pleated-skirt-1",
        type: "image",
        src: "/mock-media/grey-pleated-skirt.svg",
        width: 1080,
        height: 1350,
        alt: "사이드 버클 디테일이 있는 그레이 울 블렌드 미니 스커트",
        blurDataUrl: null,
      },
      {
        id: "cropped-shell-jacket-1",
        type: "image",
        src: "/mock-media/cropped-shell-jacket.svg",
        width: 1080,
        height: 1080,
        alt: "워시드 세이지 컬러의 크롭 셸 재킷",
        blurDataUrl: null,
      },
      {
        id: "music-reel-onscreen-1",
        type: "video_frame",
        src: "/mock-media/music-reel-onscreen.svg",
        width: 1080,
        height: 1920,
        alt: "저장한 음악 릴스의 표지 이미지",
        blurDataUrl: null,
      },
    ],
    href: "/library",
  },
  workingQueue: [
    {
      id: "queue-garden-lens",
      kind: "environment_ready",
      target: "Garden Lens",
      nextStep: "환경 열기",
      href: "/items/garden-lens",
      progress: null,
    },
    {
      id: "queue-shell-jacket",
      kind: "price_checking",
      target: "Cropped shell jacket",
      nextStep: "가격 확인 중",
      href: "/items/cropped-shell-jacket",
      progress: 0.6,
    },
    {
      id: "queue-linkedin",
      kind: "collector_auth",
      target: "LinkedIn Reactions",
      nextStep: "다시 로그인이 필요해요",
      href: "/settings",
      progress: null,
    },
  ],
  previousDays: [
    {
      date: "2026-08-07",
      label: "어제",
      itemCount: 9,
      highlights: [
        {
          id: "cuda-only-trainer",
          domain: "trends",
          // A starred repository: no cached media anywhere in the product, so the card
          // falls back to a tinted cover. This is the common case, not the edge one.
          platform: "github",
          title: "Large-batch trainer",
          meta: "GitHub Star · 이 Mac에서는 읽기 전용",
          href: "/items/cuda-only-trainer",
          preview: null,
        },
        {
          id: "grey-pleated-skirt",
          domain: "style",
          platform: "instagram",
          title: "Grey pleated skirt",
          meta: "Instagram Like · 정확히 확인됨",
          href: "/items/grey-pleated-skirt",
          // Instagram media is the only kind this product caches, so it is the only kind a
          // highlight can show. The fixture carries both cases on purpose.
          preview: "/mock-media/grey-pleated-skirt.svg",
        },
      ],
    },
  ],
  suggestedQueries: [
    {
      id: "q-ready-now",
      text: "지금 바로 실행할 수 있는 것만 보여줘",
      reason: "준비된 환경이 2개 있어요.",
    },
    {
      id: "q-this-week-style",
      text: "이번 주에 저장한 옷 중 공식 스토어가 있는 것",
      reason: "이번 주 Style 항목이 6개 들어왔어요.",
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
        label: "GitHub Star",
        state: "collected",
        collectedCount: 6,
        lastRunAt: "2026-08-08T06:31:00Z",
      },
      {
        platform: "instagram",
        label: "Instagram Saved",
        state: "collected",
        collectedCount: 6,
        lastRunAt: "2026-08-08T06:36:00Z",
      },
      {
        platform: "threads",
        label: "Threads Repost",
        state: "collected",
        collectedCount: 5,
        lastRunAt: "2026-08-08T06:33:00Z",
      },
      {
        platform: "linkedin",
        label: "LinkedIn Reactions",
        state: "auth_required",
        collectedCount: 0,
        lastRunAt: "2026-08-08T06:42:00Z",
      },
    ],
  },
};
