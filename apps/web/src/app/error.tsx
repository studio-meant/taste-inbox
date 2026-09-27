"use client";

import { RotateCcw } from "lucide-react";
import { Button, ErrorState } from "@/components/primitives";

/**
 * Root error boundary — frontend architecture §24 "Root".
 *
 * Covers the case where the whole shell failed to render, so it cannot rely on the
 * shell being present. Copy is written for the user; the technical detail is collapsed
 * and never contains a secret value (§18 "Rules", §27).
 */
export default function RootError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" style={{ padding: "var(--space-16) var(--content-padding-mobile)" }}>
      <ErrorState
        as="h1"
        title="화면을 열지 못했어요"
        description="잠시 후 다시 시도해 주세요. 문제가 이어지면 시스템 상태에서 원인을 확인할 수 있어요."
        detail={error.message}
        action={
          <Button variant="primary" icon={RotateCcw} onClick={reset}>
            다시 시도
          </Button>
        }
      />
    </main>
  );
}
