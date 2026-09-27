"use client";

import { RotateCcw } from "lucide-react";
import { Button, ErrorState } from "@/components/primitives";

/**
 * Workspace error boundary — frontend architecture §24 "Page".
 *
 * The shell, the ambient canvas and the navigation survive: only the page content is
 * replaced, so the user can still move somewhere else instead of being stranded.
 */
export default function WorkspaceError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      as="h1"
      title="이 화면을 불러오지 못했어요"
      description="다시 시도하거나, 위 내비게이션으로 다른 화면으로 이동할 수 있어요."
      detail={error.message}
      action={
        <Button variant="primary" icon={RotateCcw} onClick={reset}>
          다시 시도
        </Button>
      }
    />
  );
}
