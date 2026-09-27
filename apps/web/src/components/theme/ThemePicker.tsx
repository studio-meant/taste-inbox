"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Check, Palette, X } from "lucide-react";
import { THEMES, resolveTheme } from "@taste-inbox/ui/theme";
import { cx } from "@/lib/cx";
import { ThemeMiniPreview, ThemeSwatches } from "./ThemeCardPreview";
import styles from "./ThemePicker.module.css";
import { SERVER_THEME_ID, applyTheme, readAppliedThemeId, subscribeToTheme } from "./theme-store";

/**
 * The drawer's tab stops, in order.
 *
 * A radio group is **one** tab stop, not six: Tab enters it at the checked member and
 * leaves the group entirely. A trap that treated every radio as its own stop would wrap
 * at an element the browser never focuses, and Tab would escape the drawer at the real
 * last stop instead of returning to the top.
 */
function focusableWithin(dialog: HTMLElement): readonly HTMLElement[] {
  const all = [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ];
  const radios = all.filter(
    (element): element is HTMLInputElement =>
      element instanceof HTMLInputElement && element.type === "radio",
  );
  // One group in this drawer, so its single stop is the checked radio (or the first, which
  // is where an empty group would be entered).
  const stop = radios.find((radio) => radio.checked) ?? radios[0];
  return all.filter((element) => !radios.includes(element as HTMLInputElement) || element === stop);
}

/**
 * The theme picker — a port of the approved reference's `Drawer`
 * (`reference/taste-inbox-ui-ux-final.html`): scrim, right-hand aside, head with eyebrow /
 * title / close, a list of cards carrying a mini preview, the name, a Default badge or the
 * group, six swatches, the description and the note, a mark on the chosen one, and a foot.
 *
 * **Where this is mounted, and why.** The System screen's theme section, next to the
 * detected host and the derived resource policy. System is the screen that reports what
 * this machine is doing and how it is configured, and it already carried the theme section;
 * before this it carried a read-only showcase of the six themes, which is exactly the wrong
 * thing once they are switchable.
 *
 * The two alternatives were rejected for concrete reasons, not taste:
 *
 * - **Settings 화면's 화면과 모션 section** answers a different question. Every row there
 *   reports a value held in `config/app.yaml` and read by the service, with a badge saying
 *   where it came from. The applied theme is a browser-local value that no service reads —
 *   `appearance.defaultTheme` is a different setting that happens to share a vocabulary.
 *   Putting the live control in among rows about the config file would make the screen
 *   claim the file and the browser are one value. Instead Settings now points here.
 * - **A control in the context bar** is on every route. That is a client component, a
 *   drawer's markup and the whole registry's token set in the bundle of every screen, for a
 *   choice made a handful of times ever. The bar is also the product's fixed three-slot
 *   navigation (DESIGN.md §11.3); appearance is not navigation.
 *
 * **Copy is not ported.** The reference is a design lab, so its drawer says "Theme Library"
 * and "모든 색상 탐색안을 실제 컴포넌트 구조에 적용해 비교합니다" — the lab's purpose, not the
 * product's. What the product's own drawer has to say is what happens when you pick one and
 * where the choice is kept.
 */
export function ThemePicker() {
  /*
   * Read through `useSyncExternalStore` rather than `useState` + `useEffect`: the applied
   * theme lives on `document.documentElement`, which is external state that the inline
   * bootstrap — and possibly another tab — writes without React knowing. `getServerSnapshot`
   * keeps hydration matching the server's markup; the real value arrives immediately after.
   */
  const appliedId = useSyncExternalStore(
    subscribeToTheme,
    readAppliedThemeId,
    () => SERVER_THEME_ID,
  );
  const applied = resolveTheme(appliedId);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const groupName = useId();

  function closeDrawer(): void {
    setOpen(false);
    // Focus returns to what opened it — the same contract `FilterSheet` follows.
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const dialog = dialogRef.current;
    // Start on the current choice, so arrow keys move from where the user already is.
    const checked = dialog?.querySelector<HTMLElement>('input[type="radio"]:checked');
    (checked ?? dialog?.querySelector<HTMLElement>("button, input"))?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !dialog) {
        return;
      }
      // The drawer covers the page it is changing the colours of; Tab must not walk out
      // into content the scrim has made unreachable to the pointer.
      const focusable = focusableWithin(dialog);
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

  return (
    <div className={styles.wrap}>
      <div className={styles.current}>
        <ThemeMiniPreview theme={applied} />
        <div className={styles.currentCopy}>
          <span className={cx(styles.eyebrow, "type-label")}>지금 이 브라우저에 적용된 테마</span>
          <strong className="type-card-title">{applied.name}</strong>
          <ThemeSwatches colors={applied.swatches} />
        </div>
        <button
          ref={triggerRef}
          type="button"
          className={cx(styles.trigger, "hit-44")}
          onClick={() => {
            setOpen(true);
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Palette size={16} strokeWidth={1.75} aria-hidden="true" />
          테마 바꾸기
        </button>
      </div>

      {open ? (
        <div className={styles.layer}>
          <button
            type="button"
            className={styles.scrim}
            onClick={closeDrawer}
            /* A real button, so the dismiss surface is reachable and announced rather
               than being a div only a pointer can use. */
            aria-label="테마 목록 닫기"
          />
          <div
            ref={dialogRef}
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          >
            <header className={styles.head}>
              <div className={styles.headCopy}>
                <span className={cx(styles.eyebrow, "type-label")}>화면</span>
                <h2 id={titleId} className="type-section-title">
                  테마
                </h2>
                <p id={descriptionId} className="type-body-small">
                  고르면 바로 적용됩니다. 보고 있는 화면과 필터는 그대로예요.
                </p>
              </div>
              <button
                type="button"
                className={styles.close}
                onClick={closeDrawer}
                aria-label="닫기"
              >
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </header>

            {/* Radios, not buttons: one choice out of a fixed set is what a radio group
                means, and it brings arrow-key movement, the "선택됨" announcement and the
                checked state without re-implementing any of it. */}
            <fieldset className={styles.list}>
              <legend className="visually-hidden">테마 선택</legend>
              {THEMES.map((theme, index) => {
                const selected = theme.id === applied.id;
                const inputId = `${groupName}-${theme.id}`;
                return (
                  <div
                    key={theme.id}
                    className={styles.item}
                    style={{ "--i": index } as React.CSSProperties}
                  >
                    <input
                      className={cx(styles.radio, "visually-hidden")}
                      type="radio"
                      id={inputId}
                      name={groupName}
                      value={theme.id}
                      checked={selected}
                      onChange={() => {
                        applyTheme(theme.id);
                      }}
                    />
                    <label
                      className={cx(styles.card, selected && styles.cardSelected)}
                      htmlFor={inputId}
                    >
                      <ThemeMiniPreview theme={theme} />
                      <span className={styles.copy}>
                        <span className={styles.titleRow}>
                          <strong className="type-body">{theme.name}</strong>
                          {theme.recommended === true ? (
                            <span className={cx(styles.badge, "type-label")}>기본값</span>
                          ) : (
                            <span className={cx(styles.group, "type-label")}>{theme.group}</span>
                          )}
                        </span>
                        <ThemeSwatches colors={theme.swatches} />
                        <span className={cx(styles.description, "type-body-small")}>
                          {theme.description}
                        </span>
                        <small className={styles.note}>{theme.note}</small>
                      </span>
                      {/* The chosen card is marked by a word and a shape, never by its
                          tint alone (DESIGN.md §18). */}
                      <span className={styles.state}>
                        {selected ? (
                          <>
                            <span className={styles.check}>
                              <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                            </span>
                            <span className={cx(styles.inUse, "type-label")}>사용 중</span>
                          </>
                        ) : null}
                      </span>
                    </label>
                  </div>
                );
              })}
            </fieldset>

            <footer className={styles.foot}>
              <strong>이 브라우저에만 저장됩니다</strong>
              <span>설정 파일의 기본 테마와는 별개의 값이에요.</span>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
