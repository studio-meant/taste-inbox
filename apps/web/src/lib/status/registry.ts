import type { StyleMatchGrade } from "@taste-inbox/shared";
import type { StatusTone } from "@taste-inbox/ui/theme";
import { Check, CircleHelp, ScanSearch, Sparkles, type LucideIcon } from "lucide-react";

/**
 * The one place a domain status becomes something a person can read.
 *
 * `StatusPill` deliberately knows only the five semantic tones (frontend architecture
 * §6.1: a primitive must not hard-code domain status text). This registry is the domain
 * layer that maps between them, and it is the *only* such mapping — the filter chips are
 * derived from it rather than maintained as a second list, which is how the status
 * vocabulary and the filter bar are kept from drifting apart.
 *
 * Every field traces to a document:
 * - `pillText` and `tone` ← DESIGN.md §5.3 "Environment status" / §5.4 "Match status"
 * - `label` (Korean) ← the same tables' Korean column
 * - `primaryAction` ← PAGE_SPECIFICATIONS.md "Primary actions by status"
 * - `inFilterBar` ← PAGE_SPECIFICATIONS.md "Filter groups → Status"
 */

export interface StatusPresentation {
  /** Short English text shown inside the pill. */
  readonly pillText: string;
  /** Korean name. Accessible name for the pill, and the filter-chip label. */
  readonly label: string;
  readonly tone: StatusTone;
  readonly icon: LucideIcon;
  /** Korean label for the card's single primary action. */
  readonly primaryAction: string;
  /** Whether this status appears as a filter chip on the collection board. */
  readonly inFilterBar: boolean;
}

export const STYLE_MATCH: Readonly<Record<StyleMatchGrade, StatusPresentation>> = {
  exact: {
    pillText: "Exact match",
    label: "정확히 확인됨",
    tone: "ready",
    icon: Check,
    primaryAction: "공식 스토어 열기",
    inFilterBar: true,
  },
  likely: {
    pillText: "Likely match",
    label: "유력한 후보",
    tone: "info",
    icon: Sparkles,
    primaryAction: "근거 보기",
    inFilterBar: true,
  },
  similar: {
    pillText: "Similar",
    label: "유사 상품",
    tone: "neutral",
    icon: ScanSearch,
    primaryAction: "비슷한 상품 보기",
    inFilterBar: true,
  },
  unknown: {
    pillText: "Not identified",
    label: "확인 필요",
    tone: "neutral",
    icon: CircleHelp,
    primaryAction: "직접 찾아보기",
    inFilterBar: true,
  },
};

export const STYLE_MATCH_FILTERS: readonly {
  readonly value: StyleMatchGrade;
  readonly label: string;
}[] = (Object.keys(STYLE_MATCH) as StyleMatchGrade[])
  .filter((grade) => STYLE_MATCH[grade].inFilterBar)
  .map((grade) => ({ value: grade, label: STYLE_MATCH[grade].label }));
