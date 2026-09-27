import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { AppShell, ContextBar, MobileBottomNav } from "@/components/shell";

/**
 * Settings layout — the same shell as System, because Settings is inside it.
 *
 * `routes.ts` already counts `/settings` as part of the System destination (IA §3), so the
 * navigation was expecting this route before it existed. `ambient="quiet"` for the same
 * reason System uses it: operational content should win against the backdrop.
 */
export const dynamic = "force-dynamic";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      ambient="quiet"
      contextBar={
        <ContextBar
          start={
            <Link
              href="/system"
              className="type-body-small"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                color: "var(--muted)",
                textDecoration: "none",
              }}
            >
              <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
              System으로
            </Link>
          }
          center={<span className="type-body-small">Settings</span>}
        />
      }
      bottomNav={<MobileBottomNav />}
    >
      {children}
    </AppShell>
  );
}
