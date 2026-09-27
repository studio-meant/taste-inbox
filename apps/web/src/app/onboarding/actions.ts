"use server";

import { revalidatePath } from "next/cache";
import type { OnboardingField, OnboardingRequest } from "@taste-inbox/shared";
import { ONBOARDING_FIELDS } from "@taste-inbox/shared";
import { ApiDataError, getRepository } from "@/lib/repository";

/**
 * Submit the four first-run answers. A refusal comes back with the field it belongs to,
 * read from the service's code (`onboarding_github` → `github`), so the form can say it
 * under the right input instead of at the top of the page.
 */
export interface OnboardingResult {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: OnboardingField;
}

export async function completeOnboarding(request: OnboardingRequest): Promise<OnboardingResult> {
  try {
    await getRepository().completeOnboarding(request);
  } catch (error) {
    if (error instanceof ApiDataError) {
      const field = error.code.replace(/^onboarding_/, "");
      return {
        ok: false,
        message: error.message,
        ...((ONBOARDING_FIELDS as readonly string[]).includes(field)
          ? { field: field as OnboardingField }
          : {}),
      };
    }
    return { ok: false, message: "저장하지 못했어요. 서비스가 실행 중인지 확인해 주세요." };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "" };
}
