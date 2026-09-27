import { CeremonialEntrySchema } from "@taste-inbox/shared";
import { redirect } from "next/navigation";
import { EntrySequence } from "@/components/entry";
import { getRepository } from "@/lib/repository";

/**
 * Startup orchestrator — frontend architecture §4, IA §7.0 and §7.1.
 *
 * Its documented job is to decide the entry sequence, and the value it decides from now
 * exists: `general.ceremonialEntry` is a real settings leaf with a real control on the
 * Settings screen. This route is its only reader, which is what makes that key
 * `editable: true` honest rather than a switch that changes nothing.
 *
 *   full   Splash → Greeting → Today   (the journey the approved reference walks)
 *   brief  Greeting → Today
 *   skip   Today, by the same redirect this file used to do unconditionally
 *
 * `catch("full")` rather than a bare parse: a payload that grew a fourth mode should walk
 * the approved journey, not throw on the app's front door.
 *
 * Read through the repository like every other screen, so mock and live differ in one
 * place and not here. `force-dynamic` because both the setting and the counts are
 * per-request state on an always-on local service; a prerendered front door would greet
 * the user with yesterday's numbers.
 */
export const dynamic = "force-dynamic";

export default async function StartupOrchestrator() {
  const repository = getRepository();
  const [settings, profile] = await Promise.all([
    repository.getSettings(),
    repository.getProfile(),
  ]);
  // First run: nothing to greet yet — set up the workspace first.
  if (!profile.onboarded) redirect("/onboarding");
  const mode = CeremonialEntrySchema.catch("full").parse(settings.general.ceremonialEntry.value);

  if (mode === "skip") {
    redirect("/today");
  }

  // Only fetched for a sequence that will actually show it — `skip` pays for nothing.
  const today = await repository.getToday();

  return <EntrySequence mode={mode} today={today} name={profile.name} />;
}
