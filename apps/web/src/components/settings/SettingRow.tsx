import type { SettingKey, SettingsDocument } from "@taste-inbox/shared";
import { SignalChip } from "@/components/primitives";
import { cx } from "@/lib/cx";
import {
  EFFECT_BADGE,
  FIXED_BADGE,
  ORIGIN_BADGE,
  UNSAVED_BADGE,
  type SettingField,
  type SettingValue,
} from "./fields";
import styles from "./Settings.module.css";

/**
 * One setting, said out loud.
 *
 * A row prints four things that the payload keeps separate on purpose:
 *
 * - the **value**, as a control when `editable` is true and as text when it is not. Not a
 *   disabled control: a greyed-out switch still reads as a switch that is merely busy, and
 *   nine of these fourteen values are fixed because nothing anywhere reads them. Text is the
 *   honest shape for an answer nobody can change from here.
 * - the **origin**, because "where did this number come from?" is the question this whole
 *   screen exists to answer.
 * - the **effect**, but only where a change is possible. Printing 즉시 적용 beside a value no
 *   code reads would be a literal falsehood, and the union has no member for "nothing reads
 *   this" — `editable: false` plus a reason carries that instead.
 * - the **reason** it is fixed, always, because `editable: false` alone is an arbitrary
 *   restriction and a padlock without a sentence is worse than no padlock.
 */

export interface SettingRowProps {
  readonly field: SettingField;
  readonly settings: SettingsDocument;
  /** The unsaved value, when the user has moved this row since the last save. */
  readonly draftValue: SettingValue | undefined;
  readonly onChange: (key: SettingKey, value: SettingValue) => void;
  /** A save is in flight; controls stop accepting input so the draft cannot outrun it. */
  readonly busy: boolean;
}

export function SettingRow({ field, settings, draftValue, onChange, busy }: SettingRowProps) {
  const setting = field.read(settings);
  // Dotted key rather than `useId`, so the label/control pairing is the same string in the
  // markup, in a test failure message and in a bug report.
  const controlId = `setting-${field.key}`;
  const hintId = `${controlId}-hint`;
  const changed = setting.origin === "user";
  const unsaved = draftValue !== undefined;
  const origin = ORIGIN_BADGE[setting.origin];
  const effect = EFFECT_BADGE[setting.effect];

  return (
    <li className={cx(styles.row, changed ? styles.rowChanged : null)}>
      <div className={styles.rowHead}>
        {setting.editable ? (
          <label className={cx(styles.label, "type-body")} htmlFor={controlId}>
            {field.label}
          </label>
        ) : (
          /* No `htmlFor`, because there is nothing to point at. The value sits directly
             after this text, which is how it reads in document order. */
          <span className={cx(styles.label, "type-body")}>{field.label}</span>
        )}
        <span className={styles.badges}>
          <SignalChip icon={origin.icon}>{origin.label}</SignalChip>
          {setting.editable ? (
            <SignalChip icon={effect.icon}>{effect.label}</SignalChip>
          ) : (
            <SignalChip icon={FIXED_BADGE.icon}>{FIXED_BADGE.label}</SignalChip>
          )}
          {unsaved ? (
            <SignalChip icon={UNSAVED_BADGE.icon}>{UNSAVED_BADGE.label}</SignalChip>
          ) : null}
        </span>
      </div>

      <p className={cx(styles.description, "type-body-small")}>{field.description}</p>

      <Control
        field={field}
        settings={settings}
        draftValue={draftValue}
        onChange={onChange}
        busy={busy}
        controlId={controlId}
        hintId={hintId}
      />

      {setting.editable ? (
        field.effectNote === undefined ? null : (
          <p className={cx(styles.effectNote, "type-body-small")}>{field.effectNote}</p>
        )
      ) : (
        <p className={cx(styles.reason, "type-body-small")}>{field.fixedReason}</p>
      )}
    </li>
  );
}

function Control({
  field,
  settings,
  draftValue,
  onChange,
  busy,
  controlId,
  hintId,
}: SettingRowProps & { readonly controlId: string; readonly hintId: string }) {
  switch (field.kind) {
    case "number": {
      const setting = field.read(settings);
      const value = typeof draftValue === "number" ? draftValue : setting.value;
      const unit = field.unit ?? "";
      if (!setting.editable) {
        return (
          <p className={cx(styles.value, "type-body")}>
            {value.toLocaleString("ko-KR")}
            {unit}
          </p>
        );
      }
      return (
        <div className={styles.control}>
          <input
            id={controlId}
            className={cx(styles.number, "type-body")}
            type="number"
            inputMode="numeric"
            step={1}
            min={setting.min}
            max={setting.max}
            value={value}
            disabled={busy}
            aria-describedby={hintId}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              // An empty field is not a value. Ignoring it keeps the last valid number on
              // screen rather than sending `NaN` to the draft, which would fail validation
              // at save time for something the user never typed.
              if (Number.isNaN(parsed)) {
                return;
              }
              // Clamped to the bounds the payload declares rather than reported as an error
              // afterwards. `staggerMinutes.max` is *derived* from the interval currently in
              // effect (stagger × 5 must stay inside one interval), so a control that let the
              // user leave the range would be composing a pair the backend has already said
              // it will refuse.
              onChange(field.key, Math.min(setting.max, Math.max(setting.min, parsed)));
            }}
          />
          {field.unit === undefined ? null : (
            <span className={cx(styles.unit, "type-body-small")}>{field.unit}</span>
          )}
          <span id={hintId} className={cx(styles.hint, "type-body-small")}>
            {setting.min.toLocaleString("ko-KR")}–{setting.max.toLocaleString("ko-KR")}
            {unit} 사이
          </span>
        </div>
      );
    }
    case "boolean": {
      const setting = field.read(settings);
      const value = typeof draftValue === "boolean" ? draftValue : setting.value;
      if (!setting.editable) {
        return <p className={cx(styles.value, "type-body")}>{value ? "켜짐" : "꺼짐"}</p>;
      }
      return (
        <div className={styles.control}>
          <input
            id={controlId}
            className={styles.switch}
            type="checkbox"
            role="switch"
            checked={value}
            disabled={busy}
            onChange={(event) => {
              onChange(field.key, event.target.checked);
            }}
          />
          {/* The switch already announces its own checked state, so the word beside it is
              the *visual* second channel and nothing more — DESIGN.md §18 forbids a state
              carried by fill and position alone. Announcing it as well would read the state
              twice. */}
          <span className={cx(styles.switchState, "type-body-small")} aria-hidden="true">
            {value ? "켜짐" : "꺼짐"}
          </span>
        </div>
      );
    }
    case "choice": {
      const setting = field.read(settings);
      const value = typeof draftValue === "string" ? draftValue : setting.value;
      if (!setting.editable) {
        return <p className={cx(styles.value, "type-body")}>{value}</p>;
      }
      return (
        <div className={styles.control}>
          <select
            id={controlId}
            className={cx(styles.select, "type-body")}
            value={value}
            disabled={busy}
            onChange={(event) => {
              onChange(field.key, event.target.value);
            }}
          >
            {/* Ids, not display names. `packages/ui` already holds one Korean name per theme
                and a second copy inside an API response is the one nobody updates. */}
            {setting.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "text": {
      const setting = field.read(settings);
      const value = typeof draftValue === "string" ? draftValue : setting.value;
      if (!setting.editable) {
        return <p className={cx(styles.value, "type-mono")}>{value}</p>;
      }
      return (
        <div className={styles.control}>
          <input
            id={controlId}
            className={cx(styles.text, "type-mono")}
            type="text"
            value={value}
            disabled={busy}
            onChange={(event) => {
              onChange(field.key, event.target.value);
            }}
          />
        </div>
      );
    }
  }
}
