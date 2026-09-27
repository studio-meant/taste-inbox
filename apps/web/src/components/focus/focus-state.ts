import type { FocusJob, FocusPayload, ItemKind, JobState } from "@taste-inbox/shared";
import type { StatusTone } from "@taste-inbox/ui/theme";

/**
 * What the canvas as a whole is saying, derived from the payload alone.
 *
 * The same precedence the Working Queue uses (`api/today.py::_working_queue`,
 * PAGE_SPECIFICATIONS §5.2): the newest state wins, so a running trial hides that research
 * finished, and a finished trial hides the approval that started it. Kept as one pure
 * function so the pill in the header and the queue row on Today cannot tell two stories.
 */

export interface CanvasState {
  readonly label: string;
  readonly tone: StatusTone;
  /** Something is running, so the canvas re-reads itself until it stops. */
  readonly moving: boolean;
}

const ACTIVE: ReadonlySet<JobState> = new Set(["queued", "running"]);

export function isActive(job: FocusJob | null): boolean {
  return job !== null && ACTIVE.has(job.state);
}

export function canvasState(payload: FocusPayload): CanvasState {
  const { research: researchJob, trial: trialJob } = payload.jobs;

  if (isActive(trialJob)) return { label: "샌드박스 실행 중", tone: "info", moving: true };
  if (isActive(researchJob)) return { label: "조사 중", tone: "info", moving: true };

  if (trialJob !== null && (researchJob === null || trialJob.createdAt >= researchJob.createdAt)) {
    return trialJob.state === "succeeded"
      ? { label: "실행 완료", tone: "ready", moving: false }
      : { label: "차단됨 · 확인 필요", tone: "danger", moving: false };
  }

  if (payload.research !== null) {
    return payload.suggestion?.actionable === true
      ? { label: "승인 대기", tone: "warning", moving: false }
      : { label: "제안 준비됨", tone: "ready", moving: false };
  }

  if (researchJob?.state === "failed") {
    return { label: "조사 실패", tone: "danger", moving: false };
  }
  return { label: "조사 전", tone: "neutral", moving: false };
}

/** The job states in Korean, for the step lists and the result panel. */
export const JOB_STATE_LABEL: Readonly<Record<JobState, string>> = {
  queued: "대기 중",
  running: "진행 중",
  succeeded: "완료",
  partially_succeeded: "일부만 완료",
  failed: "실패",
  cancelled: "취소됨",
  blocked: "차단됨",
};

export const JOB_STATE_TONE: Readonly<Record<JobState, StatusTone>> = {
  queued: "neutral",
  running: "info",
  succeeded: "ready",
  partially_succeeded: "warning",
  failed: "danger",
  cancelled: "neutral",
  blocked: "danger",
};

export const KIND_LABEL: Readonly<Record<ItemKind, string>> = {
  repo: "저장소",
  model: "모델",
  dataset: "데이터셋",
  space: "Space",
  paper: "논문",
  demo: "데모",
  tool: "도구",
  post: "게시물",
  product: "상품",
  outfit: "스타일",
};

/** A kind named in a payload map key, which the schema types only as a string. */
export function kindLabel(kind: string): string {
  return Object.hasOwn(KIND_LABEL, kind) ? KIND_LABEL[kind as ItemKind] : kind;
}

/**
 * Wall time a job took, as `3분 12초`. Null until it has both ends.
 *
 * Read off the job rows, not measured in the browser — the run happened on the service's
 * clock, and a screen that timed its own polling would report how long someone watched.
 */
export function jobDuration(job: FocusJob | null): string | null {
  if (job?.startedAt == null || job.finishedAt == null) return null;
  const seconds = Math.max(
    0,
    Math.round((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000),
  );
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? `${String(rest)}초` : `${String(minutes)}분 ${String(rest)}초`;
}
