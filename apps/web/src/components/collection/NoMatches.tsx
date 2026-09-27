import Link from "next/link";
import { SearchX } from "lucide-react";
import { cx } from "@/lib/cx";
import { clearFiltersHref, toUrlObject, type RawSearchParams } from "@/lib/filters/board-filters";
import styles from "./NoMatches.module.css";

/**
 * The board has items; this filter has none.
 *
 * Kept distinct from the empty board on purpose. "아직 항목이 없어요" and "이 조건에 맞는
 * 항목이 없어요" are different facts, and collapsing them would tell someone their
 * collection is empty when it is only filtered.
 *
 * `dropped` names filter values the URL carried that no longer exist — a link saved
 * before the vocabulary changed. Saying so beats rendering an unfiltered board, which
 * would look like the filter simply matched everything.
 */
export function NoMatches({
  pathname,
  params,
  dropped = [],
}: {
  readonly pathname: string;
  readonly params: RawSearchParams;
  readonly dropped?: readonly string[];
}) {
  return (
    <div className={styles.wrap} role="status">
      <SearchX className={styles.icon} strokeWidth={1.5} aria-hidden="true" focusable="false" />
      <h2 className={cx(styles.title, "type-card-title")}>이 조건에 맞는 항목이 없어요</h2>

      {dropped.length === 0 ? (
        <p className={cx(styles.body, "type-body-small")}>
          필터를 하나 풀어 보거나, 전체를 다시 보세요.
        </p>
      ) : (
        <p className={cx(styles.body, "type-body-small")}>
          링크에 지금은 없는 필터 값이 있어요 — <code>{dropped.join(", ")}</code>. 예전에 저장한
          주소일 수 있습니다.
        </p>
      )}

      <Link
        className={styles.action}
        href={toUrlObject(clearFiltersHref(pathname, params))}
        scroll={false}
      >
        필터 지우고 전체 보기
      </Link>
    </div>
  );
}
