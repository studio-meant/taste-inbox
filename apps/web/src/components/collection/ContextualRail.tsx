import Link from "next/link";
import { Check } from "lucide-react";
import { cx } from "@/lib/cx";
import {
  firstValue,
  toUrlObject,
  toggleFilterHref,
  type RawSearchParams,
} from "@/lib/filters/board-filters";
import type { FilterGroup } from "./FilterChipRow";
import styles from "./CollectionRail.module.css";

/**
 * The facet block inside the rail — the part of `CollectionRail` that narrows the board.
 *
 * One component for every board, with the groups injected as data — `IA_WIREFRAMES.md`
 * §7.3: "Browse의 All Items, AI, Style mode가 공유하는 구조다. 카드 문법과 rail filter만
 * domain별로 달라진다."
 *
 * **It is not navigation.** IA §7.3 again: "rail은 destination nav가 아니라 현재
 * collection의 범위를 좁힌다." Nothing here changes route, and nothing repeats a
 * destination the nav pill or the mode tabs already offer. It is not a landmark either,
 * for the same reason: `CollectionRail` is the one `<nav>`, and this is a block inside it.
 *
 * It still renders nothing when no facet can separate the board — that is the honest
 * answer for a *filter*. What changed is that the rail no longer disappears with it:
 * `CollectionRail` owns the panel and always has board counts to show.
 *
 * Every entry is a link, like the chips, so the rail works before hydration and browser
 * back undoes a filter with no state to keep in sync.
 */
/*
 * **One at a time here, unlike the chips.** These rows sit directly under "Browse by type"
 * in the same panel, in the same shape, and that block means *show me this one* — so a row
 * that quietly added to a set was promising one thing and doing another. `"single"` makes
 * a click replace the group's selection; clicking the row that is already on clears it, so
 * the whole board is always one click away.
 *
 * That last property is what allowed the "필터 지우기" row to be removed from the bottom
 * of this block on 2026-08-10. It was a standing undo beside controls that already undo
 * themselves, and it was the only row here that was not a facet. Every filter this panel
 * can set, it can unset; when the result is an empty board there is nothing here left to
 * click off, and `NoMatches` carries the way out instead.
 *
 * No `aria-current` on an option even so. It names the one current item in a *set of
 * alternatives*, and `?source=` can still arrive from a shared link carrying several
 * values, which would leave two rows each claiming to be current. The state travels in the
 * accessible name instead ("…, 선택됨"), which is a real second channel rather than colour
 * (CLAUDE.md §6).
 */
export function ContextualRail({
  pathname,
  params,
  groups,
}: {
  readonly pathname: string;
  readonly params: RawSearchParams;
  readonly groups: readonly FilterGroup[];
}) {
  const usable = groups
    .map((group) => ({ ...group, options: group.options.filter((option) => option.count > 0) }))
    .filter((group) => group.options.length > 0);

  if (usable.length === 0) {
    return null;
  }

  return (
    <div className={styles.groups}>
      {usable.map((group) => {
        const selected = new Set((firstValue(params[group.key]) ?? "").split(","));

        return (
          <section key={group.key} className={styles.section}>
            <h2 className={styles.label}>{group.legend}</h2>
            <ul className={styles.list}>
              {group.options.map((option) => {
                const isOn = selected.has(option.value);
                /*
                 * Selection is said, not only shown. The tonal tile and the Check glyph are
                 * the visual channel, but the glyph is `aria-hidden`, so without this the
                 * name is byte-identical on and off — colour alone, which CLAUDE.md §6
                 * forbids. `aria-pressed` used to carry it and was silently discarded:
                 * these are links, and role=link does not support it.
                 */
                const label = `${option.label} ${String(option.count)}개`;
                const name = isOn ? `${label}, 선택됨` : label;

                return (
                  <li key={option.value}>
                    <Link
                      className={cx(styles.row, isOn && styles.rowOn)}
                      href={toUrlObject(
                        toggleFilterHref(pathname, params, group.key, option.value, "single"),
                      )}
                      scroll={false}
                      /* Collapsed, only the first glyph shows — so the accessible name and
                         the tooltip carry the label. DESIGN.md §11.2 makes both mandatory. */
                      aria-label={name}
                      title={name}
                    >
                      <span className={styles.glyph} aria-hidden="true">
                        {isOn ? <Check size={13} strokeWidth={2.5} /> : option.label.slice(0, 1)}
                      </span>
                      <span className={styles.text}>{option.label}</span>
                      <span className={styles.count} aria-hidden="true">
                        {option.count}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
