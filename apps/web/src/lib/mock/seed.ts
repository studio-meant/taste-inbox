import type { AIItemCardModel, JobModel } from "@taste-inbox/shared";

/**
 * Mock seed data — what a clean checkout's Inbox shows before any account is connected.
 *
 * Every value is invented: `sample-org` is not an account, and no real repository, model
 * or paper appears here (docs/SECURITY_BOUNDARIES.md, data/fixtures/README.md).
 *
 * The set covers the cases the Inbox has to render: each kind the collectors produce
 * (repo, model, dataset, Space, paper), each signal (star, like, upvote), a long title, an
 * item with no text, and a paper that names its code and demo — the bundle the Lab is
 * built around.
 */

export const MOCK_AI_ITEMS: readonly AIItemCardModel[] = [
  {
    id: "garden-lens",
    kind: "repo",
    title: "sample-org/garden-lens",
    source: {
      platform: "github",
      label: "GitHub",
      originalUrl: "https://github.com/sample-org/garden-lens",
      author: "sample-org",
      actionType: "star",
      firstSeenAt: "2026-08-08T06:31:00Z",
    },
    summary:
      "여러 버전의 학습 데이터를 시각적으로 비교하고, 행 단위 lineage를 추적하는 로컬 우선 탐색기예요.",
    checkedAt: "2026-08-08T06:34:00Z",
    tags: ["data-lineage", "local-first"],
    links: [
      {
        id: "garden-lens-link-1",
        url: "https://garden-lens.example.dev/docs",
        label: "garden-lens.example.dev",
        kind: "outbound",
      },
    ],
  },
  {
    id: "sample-reasoning-paper",
    kind: "paper",
    title: "Sample Reasoning: Small Models That Check Their Own Work",
    source: {
      platform: "huggingface",
      label: "Hugging Face",
      originalUrl: "https://huggingface.co/papers/2599.00001",
      author: null,
      actionType: "upvote",
      firstSeenAt: "2026-08-08T06:30:00Z",
    },
    summary:
      "작은 모델이 스스로 답을 검산하도록 학습하는 방법을 제안하고, 코드와 데모를 함께 공개한 논문이에요.",
    checkedAt: null,
    tags: ["reasoning"],
    links: [
      {
        id: "sample-reasoning-paper-link-1",
        url: "https://github.com/sample-org/self-check",
        label: "github.com",
        kind: "artifact",
      },
      {
        id: "sample-reasoning-paper-link-2",
        url: "https://huggingface.co/spaces/sample-org/self-check-demo",
        label: "huggingface.co",
        kind: "artifact",
      },
      {
        id: "sample-reasoning-paper-link-3",
        url: "https://self-check.example.org/",
        label: "self-check.example.org",
        kind: "outbound",
      },
      {
        id: "sample-reasoning-paper-link-4",
        url: "https://arxiv.org/abs/2599.00001",
        label: "arxiv.org",
        kind: "artifact",
      },
    ],
  },
  {
    id: "tiny-distilled-model",
    kind: "model",
    title: "sample-org/tiny-distilled",
    source: {
      platform: "huggingface",
      label: "Hugging Face",
      originalUrl: "https://huggingface.co/sample-org/tiny-distilled",
      author: "sample-org",
      actionType: "like",
      firstSeenAt: "2026-08-08T06:33:00Z",
    },
    summary: "4-bit 기준 4.2GB. 간단한 tool-use 데모가 포함되어 있어요.",
    checkedAt: null,
    tags: ["text-generation"],
    links: [],
  },
  {
    id: "evaluation-harness-manifest-patterns",
    kind: "repo",
    title:
      "sample-org/evaluation-harness-manifest-patterns-for-row-artifact-dataset-artifact-and-validator-gate-composition",
    source: {
      platform: "github",
      label: "GitHub",
      originalUrl: "https://github.com/sample-org/evaluation-harness-manifest-patterns",
      author: "sample-org",
      actionType: "star",
      firstSeenAt: "2026-08-08T06:29:00Z",
    },
    summary: "row artifact → dataset artifact → validator gate 구조를 참고할 수 있어요.",
    checkedAt: null,
    tags: [],
    links: [],
  },
  {
    id: "tiny-eval-set",
    kind: "dataset",
    title: "sample-org/tiny-eval-set",
    source: {
      platform: "huggingface",
      label: "Hugging Face",
      originalUrl: "https://huggingface.co/datasets/sample-org/tiny-eval-set",
      author: "sample-org",
      actionType: "like",
      firstSeenAt: "2026-08-07T22:40:00Z",
    },
    summary: "",
    checkedAt: null,
    tags: [],
    links: [],
  },
  {
    id: "sketch-to-scene",
    kind: "space",
    title: "sample-org/sketch-to-scene",
    source: {
      platform: "huggingface",
      label: "Hugging Face",
      originalUrl: "https://huggingface.co/spaces/sample-org/sketch-to-scene",
      author: "sample-org",
      actionType: "like",
      firstSeenAt: "2026-08-07T22:20:00Z",
    },
    summary: "스케치를 올리면 장면으로 바꿔 주는 데모예요.",
    checkedAt: null,
    tags: ["image-to-image"],
    links: [],
  },
  {
    id: "cuda-only-trainer",
    kind: "repo",
    title: "sample-org/large-batch-trainer",
    source: {
      platform: "github",
      label: "GitHub",
      originalUrl: "https://github.com/sample-org/large-batch-trainer",
      author: "sample-org",
      actionType: "star",
      firstSeenAt: "2026-08-07T22:10:00Z",
    },
    summary: "CUDA 커널에 의존하는 대규모 배치 학습 도구예요.",
    checkedAt: "2026-08-08T06:36:00Z",
    tags: ["cuda"],
    links: [],
  },
];

export const MOCK_JOBS: readonly JobModel[] = [
  {
    id: "job-collection-github",
    type: "collection",
    state: "succeeded",
    targetId: null,
    title: "GitHub 수집",
    currentStep: null,
    steps: [
      {
        id: "github_stars_api",
        label: "스타 가져오기",
        state: "done",
        startedAt: "2026-08-08T06:30:00Z",
        finishedAt: "2026-08-08T06:31:00Z",
        message: "4개 확인",
      },
    ],
    startedAt: "2026-08-08T06:30:00Z",
    finishedAt: "2026-08-08T06:31:00Z",
    cancellable: false,
  },
  {
    id: "job-collection-huggingface",
    type: "collection",
    state: "partially_succeeded",
    targetId: null,
    title: "Hugging Face 수집",
    currentStep: null,
    steps: [
      {
        id: "huggingface_activity",
        label: "좋아요 · 모델 · 데이터셋 · Space 가져오기",
        state: "done",
        startedAt: "2026-08-08T06:32:00Z",
        finishedAt: "2026-08-08T06:33:00Z",
        message: "3개 확인",
      },
      {
        id: "huggingface_upvotes",
        label: "업보트한 논문 가져오기",
        state: "failed",
        startedAt: "2026-08-08T06:33:00Z",
        finishedAt: "2026-08-08T06:33:04Z",
        // The collector stops and reports; it never retries on its own (CLAUDE.md §7).
        message: "업보트 응답의 모양이 바뀌었어요",
      },
    ],
    startedAt: "2026-08-08T06:32:00Z",
    finishedAt: "2026-08-08T06:33:04Z",
    cancellable: false,
  },
];
