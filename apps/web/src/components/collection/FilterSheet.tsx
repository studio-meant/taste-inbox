"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";
import { cx } from "@/lib/cx";
import {
  clearFiltersHref,
  firstValue,
  toUrlObject,
  toggleFilterHref,
  type RawSearchParams,
} from "@/lib/filters/board-filters";
import type { FilterGroup } from "./FilterChipRow";
import styles from "./FilterSheet.module.css";

/**
 * The mobile replacement for the rail — `PAGE_SPECIFICATIONS.md` §12.2.
 *
 * **It applies in a batch, and the rail does not.** `FRONTEND_COMPONENT_ARCHITECTURE.md`
 * §16: "mobile sheet applies in batch" / "desktop chip can apply immediately". That is why
 * this cannot share an implementation with the chips: on a phone the sheet covers the
 * board, so applying on every tap would navigate under a surface the user cannot see the
 * result through. Selections are held here and committed once.
 *
 * The dialog semantics below are **not specified anywhere**. A grep across all thirteen
 * documents finds no `role="dialog"`, no `aria-modal`, and nothing about focus. The choices
 * made here — and why — are recorded in `docs/DECISIONS.md` so the next screen that needs a
 * sheet copies a decision rather than inventing a second one.
 */
export function FilterSheet({
  pathname,
  params,
  groups,
  activeCount,
}: {
  readonly pathname: string;
  readonly params: RawSearchParams;
  readonly groups: readonly FilterGroup[];
  readonly activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const usable = groups
    .map((group) => ({ ...group, options: group.options.filter((option) => option.count > 0) }))
    .filter((group) => group.options.length > 0);

  function currentSelection(): Record<string, Set<string>> {
    const selection: Record<string, Set<string>> = {};
    for (const group of usable) {
      const raw = firstValue(params[group.key]) ?? "";
      selection[group.key] = new Set(raw.split(",").filter((value) => value !== ""));
    }
    return selection;
  }

  function openSheet(): void {
    setDraft(currentSelection());
    setOpen(true);
  }

  function closeSheet(): void {
    setOpen(false);
    // Focus returns to what opened it — PAGE_SPECIFICATIONS §12.2 "sheet close 후 focus 복귀".
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button, [href]")?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== "Tab" || !dialog) {
        return;
      }
      // Focus stays inside while the sheet covers the board. Without this, tabbing walks
      // into the cards underneath, which are visually hidden but still reachable.
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(key: string, value: string): void {
    setDraft((previous) => {
      const next = { ...previous };
      const set = new Set(next[key] ?? []);
      if (set.has(value)) {
        set.delete(value);
      } else {
        set.add(value);
      }
      next[key] = set;
      return next;
    });
  }

  /**
   * Where Apply goes, built from the same pure helper the chips use.
   *
   * Computed rather than navigated imperatively, so the commit is a real link: it shows
   * its destination on hover, survives a middle-click, and needs no router. One grammar
   * produces every filter URL in the product.
   */
  function applyHref(): string {
    let href = clearFiltersHref(pathname, params);
    let carried: RawSearchParams = Object.fromEntries(
      new URLSearchParams(href.split("?")[1] ?? "").entries(),
    );
    for (const [key, values] of Object.entries(draft)) {
      for (const value of values) {
        href = toggleFilterHref(pathname, carried, key, value);
        carried = Object.fromEntries(new URLSearchParams(href.split("?")[1] ?? "").entries());
      }
    }
    return href;
  }

  function reset(): void {
    setDraft(Object.fromEntries(usable.map((group) => [group.key, new Set<string>()])));
  }

  if (usable.length === 0) {
    return null;
  }

  const draftCount = Object.values(draft).reduce((total, set) => total + set.size, 0);

  return (
    <div className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={openSheet}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <SlidersHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
        필터
        {activeCount > 0 ? <span className={styles.badge}>{activeCount}</span> : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            className={styles.scrim}
            onClick={closeSheet}
            /* A real button so it is reachable and announced, rather than a div that only
               a mouse can use. */
            aria-label="필터 닫기"
          />
          <div
            ref={dialogRef}
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <header className={styles.head}>
              <h2 id={titleId} className="type-card-title">
                필터
              </h2>
              <button type="button" className={styles.close} onClick={closeSheet} aria-label="닫기">
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </header>

            <div className={styles.body}>
              {usable.map((group) => {
                const selected = draft[group.key] ?? new Set<string>();
                return (
                  <fieldset key={group.key} className={styles.group}>
                    <legend className={cx(styles.legend, "type-body-small")}>
                      {group.legend}
                      {selected.size > 0 ? (
                        /* Per-group count, so a collapsed group still says it is active
                           (PAGE_SPECIFICATIONS §12.2). */
                        <span className={styles.groupCount}>{selected.size}</span>
                      ) : null}
                    </legend>
                    <div className={styles.options}>
                      {group.options.map((option) => {
                        const isOn = selected.has(option.value);
                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={cx(styles.option, isOn && styles.optionOn, "hit-44")}
                            onClick={() => {
                              toggle(group.key, option.value);
                            }}
                            aria-pressed={isOn}
                          >
                            {option.label}
                            <span className={styles.count}>{option.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>

            <footer className={styles.foot}>
              <button type="button" className={cx(styles.reset, "hit-44")} onClick={reset}>
                초기화
              </button>
              <Link
                className={cx(styles.apply, "hit-44")}
                href={toUrlObject(applyHref())}
                scroll={false}
                /* `closeSheet`, not `setOpen(false)`: the sheet unmounts under the pointer,
                   so without the focus restore the next Tab starts from document.body. */
                onClick={closeSheet}
              >
                {draftCount > 0 ? `${String(draftCount)}개 적용` : "전체 보기"}
              </Link>
            </footer>
          </div>
        </>
      ) : null}
    </div>
  );
}
