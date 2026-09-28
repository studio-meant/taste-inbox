import type { Metadata } from "next";
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import { getRepository } from "@/lib/repository";
import { completeOnboarding } from "./actions";

export const metadata: Metadata = { title: "시작하기 · Taste Inbox" };

/**
 * `/onboarding` — the first screen of a fresh install (2026-09-28).
 *
 * A name (required) and an account name, GitHub or Hugging Face, at least one.
 *
 * The collection interval is **not** asked here. The service applies its default when the
 * field is absent (`api/profile.py::DEFAULT_INTERVAL_HOURS`), and it is a control on the
 * Settings screen from the first minute — a first run should ask only what it cannot
 * proceed without. Revisiting after setup shows the saved answers.
 */
export default async function OnboardingPage() {
  const repository = getRepository();
  const [profile, accounts] = await Promise.all([
    repository.getProfile(),
    repository.getAccounts(),
  ]);
  const handle = (platform: "github" | "huggingface") =>
    accounts.accounts.find((row) => row.platform === platform)?.handle ?? "";

  return (
    <OnboardingForm
      initial={{
        name: profile.name ?? "",
        github: handle("github"),
        huggingface: handle("huggingface"),
      }}
      returning={profile.onboarded}
      onSubmit={completeOnboarding}
    />
  );
}
