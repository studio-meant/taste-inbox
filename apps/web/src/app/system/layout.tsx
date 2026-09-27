import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { AppShell, ContextBar, MobileBottomNav } from "@/components/shell";

/**
 * System layout — frontend architecture §5 "System layout".
 *
 * "일상 workspace보다 더 높은 대비와 낮은 scenic intensity를 사용한다."
 *
 * Three differences from the workspace layout, all of them deliberate:
 * - `ambient="quiet"` so operational content wins against the backdrop
 * - a back-to-workspace control in place of the profile chip
 * - no Taste Query Dock; System is not a place to ask questions of the library
 */
export const dynamic = "force-dynamic";

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      ambient="quiet"
      contextBar={
        <ContextBar
          start={
            <Link
              href="/today"
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
              워크스페이스로
            </Link>
          }
          center={<span className="type-body-small">System</span>}
        />
      }
      bottomNav={<MobileBottomNav />}
    >
      {children}
    </AppShell>
  );
}
