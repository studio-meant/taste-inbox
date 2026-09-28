import { AppShell } from "@/components/shell";

/**
 * First-run setup. The shell without its navigation: until a workspace has an owner and an
 * account there is nothing to navigate to, and a Today tab that bounced straight back here
 * would be a control that does nothing.
 */
export const dynamic = "force-dynamic";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell ambient="scenic" fill>
      {children}
    </AppShell>
  );
}
