import type { StyleMatchGrade } from "@taste-inbox/shared";
import { StatusPill } from "@/components/primitives";
import { STYLE_MATCH } from "@/lib/status/registry";

/**
 * The bridge between a domain status and the domain-unaware `StatusPill`.
 *
 * Only Style has an axis now. The Trends board's was an execution readiness — 실행 준비
 * 완료, 준비 중 — and went with the sandbox runner (docs/DECISIONS.md, 2026-08-09).
 *
 * The pill text is short English (`Ready · Local`) per DESIGN.md §11.15, while the
 * accessible name is the Korean status name — so the chip stays compact without becoming
 * unreadable to a Korean screen reader. That pairing is the recorded chrome-language
 * decision, and it only works because the registry carries both strings.
 */

export function StyleMatchPill({
  grade,
  wrap,
  onScenic,
}: {
  readonly grade: StyleMatchGrade;
  readonly wrap?: boolean;
  readonly onScenic?: boolean;
}) {
  const presentation = STYLE_MATCH[grade];
  return (
    <StatusPill
      tone={presentation.tone}
      icon={presentation.icon}
      ariaLabel={presentation.label}
      wrap={wrap}
      onScenic={onScenic}
    >
      <span lang="en">{presentation.pillText}</span>
    </StatusPill>
  );
}
