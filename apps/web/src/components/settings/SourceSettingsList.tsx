import type { SourceSetting } from "@taste-inbox/shared";
import { PlugZap } from "lucide-react";
import { EmptyState, SignalChip, StatusPill } from "@/components/primitives";
import { cx } from "@/lib/cx";
import { formatDateTime } from "@/lib/format/datetime";
import { FIXED_BADGE, ORIGIN_BADGE, SOURCE_STATE, type SaveSourceSetting } from "./fields";
import styles from "./Settings.module.css";

/**
 * The connected accounts, as facts rather than as switches.
 *
 * `enabled` arrives as a full `SettingBoolean` rather than a bare boolean, and that wrapper
 * is the only reason this list can be honest: `source_accounts.enabled` is written once as
 * the literal `enabled=1` and read by nothing — collector selection walks a hardcoded
 * `SOURCE_ORDER`. A bare boolean would have rendered as a working switch that stops no
 * collection. The wrapper carries `editable: false`, so the row says 켜짐 and says why.
 *
 * The switch below is therefore code that the shipped backend never reaches. It is here
 * rather than deleted because `editable` is the backend's decision and not this component's:
 * the day the flag is read, the control appears without a frontend change. What it must
 * never do is appear on its own.
 */

export interface SourceSettingsListProps {
  readonly sources: readonly SourceSetting[];
  readonly onToggle: SaveSourceSetting;
  readonly busy: boolean;
}

export function SourceSettingsList({ sources, onToggle, busy }: SourceSettingsListProps) {
  if (sources.length === 0) {
    return (
      <EmptyState
        icon={PlugZap}
        title="연결된 계정이 아직 없어요"
        description="수집기가 한 번이라도 항목을 가져오면 그 계정이 여기에 생깁니다. 로그인은 브라우저 창에서 직접 해야 해서, 이 화면에서는 계정을 추가할 수 없어요."
      />
    );
  }

  return (
    <ul className={styles.sources}>
      {sources.map((source) => {
        const state = SOURCE_STATE[source.state];
        const origin = ORIGIN_BADGE[source.enabled.origin];
        const controlId = `source-${source.platform}`;
        return (
          <li key={source.platform} className={styles.source}>
            <div className={styles.sourceHead}>
              {source.enabled.editable ? (
                <label className={cx(styles.sourceName, "type-body")} htmlFor={controlId}>
                  {source.label}
                </label>
              ) : (
                <span className={cx(styles.sourceName, "type-body")}>{source.label}</span>
              )}
              <span className={styles.badges}>
                {/* Words plus an icon, never the tone alone — DESIGN.md §18. */}
                <StatusPill tone={state.tone} icon={state.icon}>
                  {state.label}
                </StatusPill>
                <SignalChip icon={origin.icon}>{origin.label}</SignalChip>
                {source.enabled.editable ? null : (
                  <SignalChip icon={FIXED_BADGE.icon}>{FIXED_BADGE.label}</SignalChip>
                )}
              </span>
            </div>

            <dl className={cx(styles.sourceMeta, "type-body-small")}>
              <div className={styles.sourcePair}>
                <dt>수집</dt>
                <dd>
                  {source.enabled.editable ? (
                    <input
                      id={controlId}
                      className={styles.switch}
                      type="checkbox"
                      role="switch"
                      checked={source.enabled.value}
                      disabled={busy}
                      onChange={(event) => {
                        void onToggle(source.platform, event.target.checked);
                      }}
                    />
                  ) : (
                    <span>{source.enabled.value ? "켜짐" : "꺼짐"}</span>
                  )}
                </dd>
              </div>
              <div className={styles.sourcePair}>
                <dt>가져온 항목</dt>
                <dd>{source.itemCount.toLocaleString("ko-KR")}개</dd>
              </div>
              <div className={styles.sourcePair}>
                <dt>처음 연결</dt>
                <dd>
                  {source.connectedAt === null ? "아직 없음" : formatDateTime(source.connectedAt)}
                </dd>
              </div>
            </dl>

            {source.state === "auth_required" ? (
              /* A button here could only print a command. The 2026-08-08 CDP decision puts
                 the login in a visible window the user drives themselves, so the screen says
                 what to run rather than pretending to run it. */
              <p className={cx(styles.reason, "type-body-small")}>
                다시 로그인은 브라우저 창에서 직접 해야 해요. 터미널에서{" "}
                <code className="type-mono">uv run probe login</code> 을 실행하면 창이 열립니다.
                로그인한 뒤 <code className="type-mono">uv run probe sources --surface</code> 로 한
                번 수집하면 다음 예정 시각부터 다시 자동으로 돌아옵니다.
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
