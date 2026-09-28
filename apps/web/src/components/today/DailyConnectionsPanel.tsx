import type { DailyConnection, SourcePlatform, SourceStatusSummary } from "@taste-inbox/shared";
import { ArrowRight, Link2, Sparkles } from "lucide-react";
import Link from "next/link";
import { kindLabel } from "@/components/collection/source-vocabulary";
import { CardSurface, EmptyState } from "@/components/primitives";
// The capsule's shape without the <button> element — see the action below.
import buttonStyles from "@/components/primitives/Button.module.css";
import { toUrlObject } from "@/lib/filters/board-filters";
import { SOURCE_LABEL, SourceDots } from "./SourceDots";
import styles from "./Today.module.css";
import { cx } from "@/lib/cx";

/**
 * Today's Connections — PAGE_SPECIFICATIONS §5.2, IA §7.2, laid out as the reference's
 * `ConnectionsCard` (ref.js:491):
 *
 *   [ 🔗 3 Connected bundles ]                                  ( source dots )
 *   [ PA ]  Sample Reasoning: Small Models That Check Their Own Work
 *           논문의 코드 저장소와 데모 Space가 함께 공개되어 있어요.
 *           [ Paper ] [ Hugging Face ]
 *   ────────────────────────────────────────────────────────────────────────
 *   [ ✦ ]  sample-org/tiny-distilled
 *          같은 작업 흐름에서 함께 쓰기 좋아요.
 *   [ Open in Lab → ]
 *   7 Updates                                          GitHub 3   Hugging Face 4
 *
 * Two departures from the reference, both because it was drawn for content this product
 * no longer has:
 *
 * - its feature copy is "What can this repo unlock?" with a `Local` tag — the
 *   "will this run here" affordance removed on 2026-08-09 (CLAUDE.md §8). The shape
 *   carries the lead's own title, its relation note and its real kind/source tags.
 * - it has no slot for the related items §5.2 requires ("related item 2–4개"). They take
 *   the `.insight-row` shape, repeated, each row linking to its item.
 *
 * The relation note is the answer to "why is this here", which is the premise of the
 * module, so it is the line under the title rather than the summary.
 */

/**
 * The two-letter mark inside `.feature-thumb` — the first letters of the lead's kind
 * (`PA` for a paper, `RE` for a repository), not a fabricated preview.
 */
function kindMark(kind: DailyConnection["kind"]): string {
  return kindLabel(kind).slice(0, 2).toUpperCase();
}

/** Distinct platforms, in first-seen order, across every connection on the card. */
function platformsOf(connections: readonly DailyConnection[]): readonly SourcePlatform[] {
  const seen: SourcePlatform[] = [];
  for (const connection of connections) {
    if (!seen.includes(connection.source.platform)) {
      seen.push(connection.source.platform);
    }
  }
  return seen;
}

/**
 * `.update-row` (ref.css:249) — a lead figure plus up to three breakdowns.
 *
 * The reference's "10 Updates · 7 articles · 2 videos · 1 repo" counted media types this
 * product does not classify. The collectors' own numbers say the same thing truthfully:
 * how many items came in, and from where. When the page has not passed the collector
 * summary (a card rendered on its own), the connections on the card are counted instead.
 *
 * **Every source, not the first three.** The reference's row is a lead figure plus up to
 * three breakdowns, and that cap was ported with the layout — but the reference was
 * breaking one number into parts of itself, while this row breaks a total into *sources*.
 * A breakdown printed next to a total is read as accounting for it, so none is dropped. `.updateRow` is already
 * `flex-wrap: wrap`, so the cap was buying nothing that the layout was not already handling.
 */
function UpdateRow({
  connections,
  sources,
}: {
  readonly connections: readonly DailyConnection[];
  readonly sources: SourceStatusSummary | undefined;
}) {
  const collected = (sources?.sources ?? []).filter((source) => source.state === "collected");

  const breakdown =
    collected.length > 0
      ? collected.map((source) => ({
          key: source.platform,
          label: SOURCE_LABEL[source.platform],
          count: source.collectedCount,
        }))
      : platformsOf(connections).map((platform) => ({
          key: platform,
          label: SOURCE_LABEL[platform],
          count: connections.filter((connection) => connection.source.platform === platform).length,
        }));

  const total =
    collected.length > 0
      ? collected.reduce((sum, source) => sum + source.collectedCount, 0)
      : connections.length;

  return (
    <p className={styles.updateRow}>
      <strong className={styles.updateLead} lang="en">
        {`${total.toLocaleString("ko-KR")} Updates`}
      </strong>
      {breakdown.map((entry) => (
        <span key={entry.key}>{`${entry.label} ${entry.count.toLocaleString("ko-KR")}`}</span>
      ))}
    </p>
  );
}

export function DailyConnectionsPanel({
  lead,
  related,
  sources,
}: {
  readonly lead: DailyConnection | null;
  readonly related: readonly DailyConnection[];
  /** Collector run summary, used for the footer meta row. */
  readonly sources?: SourceStatusSummary;
}) {
  const connections = lead === null ? related : [lead, ...related];

  return (
    <CardSurface
      as="section"
      tone="glass"
      radius="card"
      padding="none"
      className={cx(styles.overviewCard, styles.connections, styles.motionItem)}
      style={{ ["--i" as string]: "1" }}
      aria-labelledby="today-connections-heading"
    >
      <div className={styles.cardHeading}>
        <h2 id="today-connections-heading" className={styles.cardHeadingTitle} lang="en">
          <Link2
            className={styles.cardHeadingIcon}
            strokeWidth={1.75}
            aria-hidden="true"
            focusable="false"
          />
          {/*
            `Connected bundles` (2026-09-28). The product's own word for what this card
            shows: an item and the paper, repository, model or Space the collectors tied it
            to. `Connections` alone said nothing about what was connected.
          */}
          {`${connections.length.toLocaleString("ko-KR")} Connected bundles`}
        </h2>
        <SourceDots platforms={platformsOf(connections)} label="관련 출처" />
      </div>

      {lead === null ? (
        <div className={styles.emptyBody}>
          <EmptyState
            as="h3"
            title="오늘의 연결을 만들 만한 항목이 아직 없어요"
            description="수집이 끝나면 관련 있는 항목끼리 묶어서 보여드릴게요."
          />
        </div>
      ) : (
        <>
          <div className={styles.featureRow}>
            {/* `.feature-thumb` carries the kind's mark, not a fabricated preview. */}
            <span className={styles.featureThumb} aria-hidden="true">
              {kindMark(lead.kind)}
            </span>

            <div className={styles.featureCopy}>
              <h3 className={cx(styles.featureTitle, "clamp-2")}>{lead.title}</h3>
              <p className={cx(styles.featureMeta, "clamp-2")}>
                {lead.relationNote ?? lead.summary}
              </p>
              <div className={styles.tagRow}>
                <span className={cx(styles.tag, styles.tagGreen)} lang="en">
                  {kindLabel(lead.kind)}
                </span>
                <span className={styles.tag} lang="en">
                  {lead.source.label}
                </span>
              </div>
            </div>
          </div>

          {related.length === 0 ? null : (
            <>
              <div className={styles.cardDivider} />
              <ul className={styles.relatedList} aria-label="관련 항목">
                {related.map((connection) => (
                  <li key={connection.id}>
                    <Link href={toUrlObject(connection.href)} className={styles.insightRow}>
                      <span className={styles.insightIcon} aria-hidden="true">
                        <Sparkles strokeWidth={1.75} focusable="false" />
                      </span>
                      <span className={styles.insightCopy}>
                        <span className={styles.insightTitle}>{connection.title}</span>
                        <span className={cx(styles.insightBody, "clamp-2")}>
                          {connection.relationNote ?? connection.source.label}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/*
            One dark capsule per card (DESIGN.md §9) — and the capsule *is* the link. It
            used to be a <Button> inside the <Link>, which is invalid HTML (interactive
            content nested in an <a>), produced two tab stops for one destination, and made
            a screen reader announce it twice. The inner button never had an onClick, so its
            only contribution was the shape: borrow that and drop the node.
          */}
          {/* The Lab, like every other `Open in Lab` in the product — `/focus/[itemId]`. The
              lead's title above is the way to the item's own page. */}
          <Link
            href={toUrlObject(`/focus/${lead.id}`)}
            className={cx(buttonStyles.button, buttonStyles.primary, styles.leadAction)}
          >
            <span className={buttonStyles.label} lang="en">
              Open in Lab
              <ArrowRight
                className={buttonStyles.icon}
                strokeWidth={1.75}
                aria-hidden="true"
                focusable="false"
              />
            </span>
          </Link>
        </>
      )}

      <UpdateRow connections={connections} sources={sources} />
    </CardSurface>
  );
}
