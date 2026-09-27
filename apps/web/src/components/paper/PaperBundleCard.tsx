import type { PaperBundle } from "@taste-inbox/shared";
import { BadgeCheck, Link2 } from "lucide-react";
import { cx } from "@/lib/cx";
import styles from "./PaperBundleCard.module.css";

/**
 * A paper and what the Hub says grew out of it: Paper · Code · Model · Dataset · Demo.
 *
 * The counts are the Hub's totals (`numTotal*`), not the length of the preview lists — a
 * paper can be cited by thousands of Spaces and only a handful are stored. A branch with
 * nothing in it is not drawn, the rule `SavedSummary` already follows for its chips.
 *
 * **Who linked the code is the point of the card.** `author-linked` means a person put the
 * repository on the paper page; `auto-linked` means the Hub matched it. They are drawn in
 * different shapes and different words, never one badge in two colours — a guess shown as
 * the official implementation is the failure `DESIGN.md` §3.5 forbids.
 */
export function PaperBundleCard({ bundle }: { readonly bundle: PaperBundle }) {
  const count = (kind: "models" | "datasets" | "spaces", listed: number) =>
    bundle.totals[kind] ?? listed;
  const branches = [
    {
      key: "models",
      label: "Model",
      items: bundle.models,
      total: count("models", bundle.models.length),
    },
    {
      key: "datasets",
      label: "Dataset",
      items: bundle.datasets,
      total: count("datasets", bundle.datasets.length),
    },
    {
      key: "spaces",
      label: "Demo",
      items: bundle.spaces,
      total: count("spaces", bundle.spaces.length),
    },
  ].filter((branch) => branch.total > 0);

  return (
    <section className={styles.card} aria-labelledby="paper-bundle-title">
      <h2 id="paper-bundle-title" className={styles.title}>
        논문에서 이어지는 것
      </h2>
      <p className={styles.summary} lang="en">
        <span>Paper</span>
        {bundle.repo === null ? null : <span>· Code ✓</span>}
        {branches.map((branch) => (
          <span key={branch.key}>
            · {branch.label} {branch.total.toLocaleString("ko-KR")}
          </span>
        ))}
      </p>

      {bundle.repo === null ? (
        <p className={styles.missing}>
          Hub가 이 논문에 구현 저장소를 적어 두지 않았어요. AI-Q 조사가 후보를 찾을 수 있지만,
          확정된 저장소로 보여주지는 않아요.
        </p>
      ) : (
        <div className={styles.repo}>
          <a href={bundle.repo.sourceUrl ?? undefined} target="_blank" rel="noreferrer noopener">
            {bundle.repo.value}
            <span className="visually-hidden">(새 탭에서 열림)</span>
          </a>
          <RepoProvenanceBadge provenance={bundle.repoProvenance} />
        </div>
      )}

      {branches.length === 0 ? null : (
        <ul className={styles.branches}>
          {branches.map((branch) => (
            <li key={branch.key}>
              <span className={styles.branchLabel} lang="en">
                {branch.label}
              </span>
              <ul className={styles.branchItems}>
                {branch.items.slice(0, 3).map((item) => (
                  <li key={item.value}>
                    {item.sourceUrl === null ? (
                      item.value
                    ) : (
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer noopener">
                        {item.value}
                        <span className="visually-hidden">(새 탭에서 열림)</span>
                      </a>
                    )}
                  </li>
                ))}
                {branch.total > Math.min(3, branch.items.length) ? (
                  <li className={styles.more}>
                    외 {(branch.total - Math.min(3, branch.items.length)).toLocaleString("ko-KR")}개
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {bundle.projectPage === null ? null : (
        <a
          className={styles.project}
          href={bundle.projectPage.sourceUrl ?? bundle.projectPage.value}
          target="_blank"
          rel="noreferrer noopener"
        >
          프로젝트 페이지
          <span className="visually-hidden">(새 탭에서 열림)</span>
        </a>
      )}
    </section>
  );
}

/**
 * Official versus matched, in two shapes: a filled check with "저자가 연결", an outlined
 * link with "Hub 자동 연결". Words first — the icon is the second channel.
 */
export function RepoProvenanceBadge({
  provenance,
}: {
  readonly provenance: PaperBundle["repoProvenance"];
}) {
  if (provenance === null) return null;
  const official = provenance === "author-linked";
  const Icon = official ? BadgeCheck : Link2;
  return (
    <span className={cx(styles.badge, official ? styles.official : styles.matched)}>
      <Icon size={14} strokeWidth={1.8} aria-hidden="true" focusable="false" />
      {official ? "공식 저장소 · 저자가 연결" : "Hub 자동 연결 · 확인 필요"}
    </span>
  );
}
