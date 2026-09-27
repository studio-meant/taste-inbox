import { ArrowGlyph, MicGlyph, SparkGlyph } from "@/components/shell/ReferenceIcons";
import styles from "./TasteQueryDock.module.css";

/**
 * Taste Query Dock — frontend architecture §12, DESIGN.md §11.4.
 *
 * The floating bar at the bottom of the frame: orb, question field, state chip, voice
 * and send. Geometry is the approved reference's `.query-area` / `.query-dock`, in `cqw`
 * against `.frame`.
 *
 * ── It does not pretend to work ──────────────────────────────────────────────────────
 *
 * Nothing in this product answers a query yet: there is no query planner, no ranking
 * pass, no retrieval over the library. A dock that accepted text and did nothing with it
 * would be the worst version of this — the user types a real question, presses Enter, and
 * the product silently discards it.
 *
 * So the field is a real, labelled `<input>` that is `readonly` and `aria-disabled`, the
 * two buttons are genuinely `disabled`, and the state is stated in three places rather
 * than implied:
 *
 *   - a visible Korean notice under the dock, which is also the field's `aria-describedby`
 *   - a `준비 중` chip in the slot the reference gives to `⌘ K`, because there is no
 *     shortcut to advertise either
 *   - `준비 중` inside each button's accessible name
 *
 * `readonly` rather than `disabled` on the field is deliberate: `disabled` drops it out
 * of the tab order and out of some screen readers' reach, which would hide the
 * explanation from exactly the users who cannot see the greyed-out styling. It stays
 * focusable and announced, and it still swallows nothing — typing into a readonly input
 * changes nothing.
 *
 * When a real query path exists, this component gains state and a submit handler; the
 * markup and the CSS below do not have to change.
 */

const INPUT_ID = "taste-query-input";
const NOTICE_ID = "taste-query-notice";

const NOTICE = "Taste Query는 아직 준비 중이에요. 지금은 Browse의 필터로 찾아주세요.";

export function TasteQueryDock() {
  return (
    <div className={styles.area}>
      <div className={styles.dock}>
        <span className={styles.orb} aria-hidden="true">
          <i className={styles.petal} />
          <i className={styles.petal} />
          <i className={styles.petal} />
        </span>

        <label className="visually-hidden" htmlFor={INPUT_ID}>
          Taste Query 질문 입력
        </label>
        <input
          id={INPUT_ID}
          className={styles.input}
          type="text"
          value=""
          readOnly
          aria-disabled="true"
          aria-describedby={NOTICE_ID}
          placeholder="질문 입력은 아직 열리지 않았어요"
        />

        {/* The slot the reference fills with `⌘ K`. There is no shortcut yet either. */}
        <span className={styles.chip}>준비 중</span>

        <button
          type="button"
          className={styles.iconButton}
          disabled
          aria-label="음성으로 질문하기 (준비 중)"
        >
          <MicGlyph className={styles.buttonGlyph} />
        </button>
        <button type="button" className={styles.send} disabled aria-label="질문 보내기 (준비 중)">
          <ArrowGlyph className={styles.buttonGlyph} />
        </button>
      </div>

      <p className={styles.notice} id={NOTICE_ID}>
        <SparkGlyph className={styles.noticeIcon} />
        {NOTICE}
      </p>
    </div>
  );
}
