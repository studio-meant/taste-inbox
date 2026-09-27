"use server";

import { refresh, revalidatePath } from "next/cache";
import { ApiDataError, getRepository } from "@/lib/repository";
import { isRemoteReadOnly, REMOTE_READ_ONLY_MESSAGE } from "@/lib/remote-mode";

/**
 * The Lab's three writes: research the item, ask a question about it, and run an approved
 * plan in the sandbox.
 *
 * Server Actions for the reason `app/(workspace)/actions.ts` gives — the browser never
 * learns where the API is — and a refusal is a **return value**, not a throw. The service
 * refuses with a Korean sentence that is the whole content of the failure (no
 * `AIQ_SERVER_URL`, the sandbox not ready, another run in progress), and the error boundary
 * would replace it with "something went wrong".
 *
 * Neither waits for the run. Both answer as soon as the job is queued, and the canvas
 * follows the job by re-reading the route (`RefreshWhileRunning`).
 */

export interface FocusActionResult {
  readonly ok: boolean;
  readonly message: string;
  readonly jobId?: string;
}

function revalidate(itemId: string): void {
  revalidatePath(`/focus/${itemId}`);
  revalidatePath("/today");
  // Re-render the canvas that asked, so the queued job is on screen without a reload.
  refresh();
}

function refused(error: unknown, fallback: string): FocusActionResult {
  return { ok: false, message: error instanceof ApiDataError ? error.message : fallback };
}

export async function requestResearch(itemId: string): Promise<FocusActionResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  try {
    const started = await getRepository().startResearch(itemId);
    revalidate(itemId);
    return { ok: true, message: started.target, jobId: started.jobId };
  } catch (error) {
    return refused(error, "조사를 시작하지 못했어요. 서비스가 실행 중인지 확인해 주세요.");
  }
}

/**
 * `What do you want to know?` — record the question and start the planning pass.
 *
 * Reached from a suggestion chip or from the free-form field, and from nowhere else. The
 * agent never picks the question: that is the asymmetry the Lab is built on, and it is
 * kept by there being no caller of this but a person.
 */
export async function askLabQuestion(itemId: string, question: string): Promise<FocusActionResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  try {
    const started = await getRepository().askQuestion(itemId, question);
    revalidate(itemId);
    return {
      ok: true,
      message: `${started.target}에 이 질문의 검증 설계를 맡겼어요.`,
      jobId: started.jobId,
    };
  } catch (error) {
    return refused(error, "질문을 보내지 못했어요. 서비스가 실행 중인지 확인해 주세요.");
  }
}

/**
 * Run the plan. Reached only from the confirmation step of `TrySafely` — the one place in
 * this product where a person approves running code they collected.
 */
export async function approveTrial(itemId: string): Promise<FocusActionResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  try {
    const started = await getRepository().startTrial(itemId, { approved: true });
    revalidate(itemId);
    return {
      ok: true,
      message: `샌드박스 '${started.policy.sandbox}'에서 실행을 시작했어요.`,
      jobId: started.jobId,
    };
  } catch (error) {
    return refused(error, "실행을 시작하지 못했어요. 서비스가 실행 중인지 확인해 주세요.");
  }
}
