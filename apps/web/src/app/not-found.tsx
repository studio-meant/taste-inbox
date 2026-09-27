import { Compass } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/primitives";

export default function NotFound() {
  return (
    <main id="main" style={{ padding: "var(--space-16) var(--content-padding-mobile)" }}>
      <EmptyState
        as="h2"
        icon={Compass}
        title="찾을 수 없는 화면이에요"
        description="주소가 바뀌었거나 아직 준비되지 않은 화면입니다."
        action={
          <Link
            href="/today"
            className="type-body-small"
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: "var(--control-height-primary)",
              paddingInline: "var(--control-padding-primary)",
              borderRadius: "var(--radius-pill)",
              background: "var(--inverse)",
              color: "var(--surface)",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Today로 이동
          </Link>
        }
      />
    </main>
  );
}
