import type { Metadata } from "next";
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import { getRepository } from "@/lib/repository";
import { completeOnboarding } from "./actions";

export const metadata: Metadata = { title: "시작하기 · Taste Inbox R&D" };

/**
 * `/onboarding` — the first screen of a fresh install (2026-09-28).
 *
 * Four answers: a name (required), a GitHub name and a Hugging Face name (at least one),
 * and how often to collect (4 hours, filled in and changeable). Revisiting it after setup
 * shows the saved answers, so it doubles as the one place all four sit together.
 */
export default async function OnboardingPage() {
  const repository = getRepository();
  const [profile, accounts, settings] = await Promise.all([
    repository.getProfile(),
    repository.getAccounts(),
    repository.getSettings(),
  ]);
  const handle = (platform: "github" | "huggingface") =>
    accounts.accounts.find((row) => row.platform === platform)?.handle ?? "";
  const interval = settings.collection.intervalHours;

  return (
    <OnboardingForm
      initial={{
        name: profile.name ?? "",
        github: handle("github"),
        huggingface: handle("huggingface"),
        // Four hours for a first run, as asked; a returning visit shows what is saved.
        intervalHours: profile.onboarded ? interval.value : 4,
      }}
      intervalBounds={{ min: interval.min, max: interval.max }}
      returning={profile.onboarded}
      onSubmit={completeOnboarding}
    />
  );
}
