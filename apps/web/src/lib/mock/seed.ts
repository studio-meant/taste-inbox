import type { AIItemCardModel, JobModel, StyleItemCardModel } from "@taste-inbox/shared";

/**
 * Mock seed data.
 *
 * Content is adapted from `prototype/src/data.js`, reshaped into the documented view
 * models. Every value is invented — no real account, handle, post, or price appears
 * here (docs/SECURITY_BOUNDARIES.md, data/fixtures/README.md).
 *
 * The set deliberately covers the fixture cases the frontend architecture requires in
 * §29 "Data fixtures": a long title, an item with no image, and a blocked job. The Style
 * cases are now one photo, many photos and none — the price and match-grade cases went
 * with the product fields (docs/DECISIONS.md, 2026-08-09).
 *
 * Phase 2 moves this behind the FastAPI service; the shape does not change.
 */

export const MOCK_AI_ITEMS: readonly AIItemCardModel[] = [
  {
    id: "garden-lens",
    kind: "repo",
    title: "Garden Lens",
    source: {
      platform: "github",
      label: "GitHub Star",
      originalUrl: "https://github.com/example/garden-lens",
      author: "example",
      actionType: "star",
      firstSeenAt: "2026-08-08T06:31:00Z",
    },
    summary:
      "여러 버전의 학습 데이터를 시각적으로 비교하고, 행 단위 lineage를 추적하는 로컬 우선 탐색기예요.",
    checkedAt: "2026-08-08T06:34:00Z",
    preview: null,
    tags: [],
    links: [],
  },
  {
    id: "tiny-distilled-model",
    kind: "model",
    title: "Tiny distilled model for Apple Silicon",
    source: {
      platform: "huggingface",
      label: "Threads Repost",
      originalUrl: "https://huggingface.co/example/tiny-distilled",
      author: "example",
      actionType: "repost",
      firstSeenAt: "2026-08-08T06:33:00Z",
    },
    summary: "4-bit 기준 4.2GB. 간단한 tool-use 데모가 포함되어 있어요.",
    // Names only. A secret value must never reach the UI (architecture §27).
    checkedAt: "2026-08-08T06:35:00Z",
    preview: null,
    tags: [],
    links: [],
  },
  {
    id: "evaluation-harness-manifest-patterns",
    kind: "repo",
    title:
      "Evaluation harness manifest patterns for row artifact, dataset artifact and validator gate composition",
    source: {
      platform: "github",
      label: "GitHub Star",
      originalUrl: "https://github.com/example/evaluation-harness-manifest-patterns",
      author: "example",
      actionType: "star",
      firstSeenAt: "2026-08-08T06:29:00Z",
    },
    summary: "row artifact → dataset artifact → validator gate 구조를 참고할 수 있어요.",
    checkedAt: null,
    preview: null,
    tags: [],
    links: [],
  },
  {
    id: "cuda-only-trainer",
    kind: "tool",
    title: "Large-batch trainer",
    source: {
      platform: "github",
      label: "GitHub Star",
      originalUrl: "https://github.com/example/large-batch-trainer",
      author: "example",
      actionType: "star",
      firstSeenAt: "2026-08-07T22:10:00Z",
    },
    summary: "CUDA 커널에 의존해 이 Mac에서는 읽기 전용으로만 다룹니다.",
    checkedAt: "2026-08-08T06:36:00Z",
    preview: null,
    tags: [],
    links: [],
  },
];

export const MOCK_STYLE_ITEMS: readonly StyleItemCardModel[] = [
  {
    id: "grey-pleated-skirt",
    source: {
      platform: "instagram",
      label: "Instagram Like",
      originalUrl: "https://www.instagram.com/p/example-grey-skirt/",
      author: null,
      actionType: "like",
      firstSeenAt: "2026-08-08T06:37:00Z",
    },
    // Fixture case: one photo, the shape a Reel and a single-image post both have.
    media: [
      {
        id: "grey-pleated-skirt-1",
        type: "image",
        src: "/mock-media/grey-pleated-skirt.svg",
        width: 1080,
        height: 1350,
        alt: "사이드 버클 디테일이 있는 그레이 울 블렌드 미니 스커트",
        blurDataUrl: null,
      },
    ],
    descriptor: "사이드 버클 디테일의 그레이 울 블렌드 미니 스커트",
    caption: "사이드 버클 디테일의 그레이 울 블렌드 미니 스커트\n#데일리룩 #미니스커트",
    checkedAt: null,
    tags: ["#데일리룩", "#미니스커트"],
    links: [],
    author: null,
  },
  {
    id: "cropped-shell-jacket",
    source: {
      platform: "instagram",
      label: "Instagram Saved",
      originalUrl: "https://www.instagram.com/p/example-shell-jacket/",
      author: null,
      actionType: "save",
      firstSeenAt: "2026-08-08T06:36:00Z",
    },
    // Fixture case: a carousel. Every photo the post contained, in the order it was
    // posted — the state the board is built for and the one a single-image fixture
    // cannot exercise.
    media: [
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
        id: "cropped-shell-jacket-2",
        type: "image",
        src: "/mock-media/grey-pleated-skirt.svg",
        width: 1080,
        height: 1350,
        // A carousel mixes ratios; the second photo is portrait where the first is square.
        alt: "저장한 게시물의 2번째 사진",
        blurDataUrl: null,
      },
      {
        id: "cropped-shell-jacket-3",
        type: "image",
        src: "/mock-media/cropped-shell-jacket.svg",
        width: 1080,
        height: 1080,
        alt: "저장한 게시물의 3번째 사진",
        blurDataUrl: null,
      },
    ],
    descriptor: "워시드 세이지 컬러의 라이트 셸 재킷",
    caption:
      "워시드 세이지 컬러의 라이트 셸 재킷.\n" +
      "가을 초입에 걸치기 좋은 두께감이라 요즘 계속 손이 가요. " +
      "안감이 없어서 가볍고, 소매 단추로 기장 조절이 되는 점이 마음에 들었습니다. " +
      "같이 입은 팬츠는 지난 게시물에 있어요.\n#가을코디 #셸재킷 #데일리룩",
    checkedAt: null,
    tags: ["#가을코디", "#셸재킷", "#데일리룩"],
    links: [],
    // Layout regression: real cards may have several profile links below a long caption.
    // These are synthetic links; smoke tests never use personal captures or real shops.
    author: {
      handle: "example_style",
      displayName: "예시 스타일",
      checkedAt: null,
      mentions: [],
      links: [
        {
          id: "example-shop-1",
          url: "https://example.com/shop",
          label: "라이트 셸 재킷과 함께 입는 옷 모음",
          kind: "shop",
          origin: "profile",
          via: null,
        },
        {
          id: "example-shop-2",
          url: "https://example.com/new",
          label: "새로 올라온 옷 구경하기",
          kind: "shop",
          origin: "profile",
          via: null,
        },
        {
          id: "example-shop-3",
          url: "https://example.com/news",
          label: "소식과 업데이트 받아보기",
          kind: "shop",
          origin: "profile",
          via: null,
        },
      ],
    },
  },
  {
    id: "unidentified-knit",
    source: {
      platform: "threads",
      label: "Threads Repost",
      originalUrl: "https://www.threads.com/@example/post/unidentified-knit",
      author: null,
      actionType: "repost",
      firstSeenAt: "2026-08-07T21:05:00Z",
    },
    // Fixture case: no photo at all. The card must not collapse.
    media: [],
    descriptor: "오트밀 컬러의 루즈한 케이블 니트",
    caption: "오트밀 컬러의 루즈한 케이블 니트",
    checkedAt: null,
    tags: [],
    links: [],
    author: null,
  },
];

export const MOCK_JOBS: readonly JobModel[] = [
  {
    id: "job-collection-github",
    type: "collection",
    state: "succeeded",
    targetId: "github_stars",
    title: "GitHub Star 수집",
    currentStep: null,
    steps: [
      {
        id: "fetch",
        label: "새 항목 확인",
        state: "done",
        startedAt: "2026-08-08T06:30:00Z",
        finishedAt: "2026-08-08T06:31:00Z",
        message: null,
      },
      {
        id: "normalize",
        label: "정규화 및 중복 제거",
        state: "done",
        startedAt: "2026-08-08T06:31:00Z",
        finishedAt: "2026-08-08T06:31:20Z",
        message: null,
      },
    ],
    startedAt: "2026-08-08T06:30:00Z",
    finishedAt: "2026-08-08T06:31:20Z",
    cancellable: false,
  },
  {
    id: "job-collection-linkedin",
    type: "collection",
    state: "blocked",
    targetId: "linkedin_reactions",
    title: "LinkedIn Reaction 수집",
    currentStep: "authenticate",
    steps: [
      {
        id: "authenticate",
        label: "세션 확인",
        state: "failed",
        startedAt: "2026-08-08T06:42:00Z",
        finishedAt: "2026-08-08T06:42:04Z",
        // The collector stops and reports; it never attempts to re-authenticate
        // automatically (CLAUDE.md §7, DECISIONS.md → Safety).
        message: "auth_required",
      },
    ],
    startedAt: "2026-08-08T06:42:00Z",
    finishedAt: "2026-08-08T06:42:04Z",
    cancellable: false,
  },
];
