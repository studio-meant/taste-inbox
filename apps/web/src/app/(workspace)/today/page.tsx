import type { Metadata } from "next";
import { DailyConnectionsPanel } from "@/components/today/DailyConnectionsPanel";
import { PartialFailureNotice } from "@/components/today/PartialFailureNotice";
import { PreviousDaySection } from "@/components/today/PreviousDaySection";
import { SavedItemsSummaryCard } from "@/components/today/SavedItemsSummaryCard";
import { TodayHeader } from "@/components/today/TodayHeader";
import { WorkingQueuePanel } from "@/components/today/WorkingQueuePanel";
import { getRepository } from "@/lib/repository";
import styles from "@/components/today/Today.module.css";

export const metadata: Metadata = { title: "Today · Taste Inbox" };

/**
 * Today — PAGE_SPECIFICATIONS §5.2, IA §7.2, and the approved reference's `Today`
 * screen (`reference/taste-inbox-ui-ux-final.html`, ref.js:504).
 *
 * "퇴근 후 사용자가 30초 안에 오늘의 새 항목, 관련성, 준비 상태를 이해하게 한다."
 *
 * The page is four rows: header, partial-failure notice, the three-card grid, and
 * Yesterday. The reference's header carries exactly one piece of chrome — the "Updated"
 * pill — so the three headline counts moved into the cards that own them: 신규 into the
 * Saved card's figure and the Connections footer, 준비됨 and 확인 필요 into the queue
 * card's footer. Nothing was dropped; it is just no longer repeated three times.
 *
 * `greeting` keeps a place under the title. The reference gives it a whole screen of its
 * own, which this product has not built, so dropping it here would drop it entirely.
 *
 * Server Component: only the navigation pill inside the shell ships client JavaScript.
 *
 * Still to come: the Taste Query Dock (§5.2 required section 7), which is what the
 * reference reserves its 100px bottom padding for.
 */
export default async function TodayPage() {
  const today = await getRepository().getToday();

  return (
    <div className={styles.page}>
      <TodayHeader sources={today.sourceStatusSummary} greeting={today.greeting} />

      <PartialFailureNotice summary={today.sourceStatusSummary} />

      <div className={styles.grid}>
        <DailyConnectionsPanel
          lead={today.leadConnection}
          related={today.relatedConnections}
          sources={today.sourceStatusSummary}
        />
        <SavedItemsSummaryCard summary={today.savedSummary} />
        <WorkingQueuePanel items={today.workingQueue} counts={today.counts} />
      </div>

      <PreviousDaySection days={today.previousDays} />
    </div>
  );
}
