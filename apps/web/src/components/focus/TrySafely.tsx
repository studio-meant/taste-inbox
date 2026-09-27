"use client";

import { ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { approveTrial } from "@/app/(workspace)/focus/actions";
import { Button } from "@/components/primitives";
import styles from "./FocusCanvas.module.css";

/**
 * `안전하게 실행 (Try safely)` — the one place in this product where a person approves
 * running code they collected.
 *
 * Two steps, never one. The first press opens a statement of exactly what will happen —
 * which sandbox, which hosts open, what the sandbox cannot see — and only the second
 * sends `approved: true`. Running collected code was re-allowed on that condition alone
 * (docs/DECISIONS.md, 2026-09-28), so the approval has to be an act with its terms in
 * front of it rather than a click on a button that happened to be there.
 *
 * Inline rather than a modal: the terms stay beside the plan they approve, and there is no
 * focus trap to get wrong. Focus moves to the statement when it opens and back to the
 * button when it closes; Escape cancels.
 */
export function TrySafely({
  itemId,
  sandbox,
  opens,
  refused,
  disabledReason,
}: {
  readonly itemId: string;
  readonly sandbox: string;
  readonly opens: readonly string[];
  readonly refused: readonly string[];
  /** Why it cannot run right now, in words. The button is disabled beside it. */
  readonly disabledReason: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const headingId = useId();
  const statementRef = useRef<HTMLDivElement>(null);
  // The wrapper, not the button: `Button` does not forward a ref, and the primitive is not
  // this change's to widen. Focus returns to the first button inside it.
  const openerRef = useRef<HTMLDivElement>(null);
  const [returnFocus, setReturnFocus] = useState(false);

  useEffect(() => {
    if (confirming) statementRef.current?.focus();
    else if (returnFocus) {
      openerRef.current?.querySelector("button")?.focus();
      setReturnFocus(false);
    }
  }, [confirming, returnFocus]);

  const cancel = () => {
    setConfirming(false);
    setReturnFocus(true);
  };

  if (disabledReason !== null) {
    return (
      <div className={styles.actionRow}>
        <Button variant="primary" icon={ShieldCheck} disabled>
          안전하게 실행 (Try safely)
        </Button>
        <p className={styles.note}>{disabledReason}</p>
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className={styles.actionRow} ref={openerRef}>
        <Button
          variant="primary"
          icon={ShieldCheck}
          onClick={() => {
            setResult(null);
            setConfirming(true);
          }}
        >
          안전하게 실행 (Try safely)
        </Button>
        {result === null ? null : (
          <p
            className={result.ok ? styles.note : styles.refusal}
            role={result.ok ? "status" : "alert"}
          >
            {result.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      ref={statementRef}
      className={styles.approval}
      role="group"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) cancel();
      }}
    >
      <h3 id={headingId} className={styles.approvalTitle}>
        이렇게 실행합니다
      </h3>
      <ul className={styles.approvalTerms}>
        <li>
          OpenShell 샌드박스 <code>{sandbox}</code> 안에서 OpenClaw 에이전트가 위 계획을 실행해요.
        </li>
        <li>
          이 Mac의 파일은 샌드박스에 보이지 않아요. 쓸 수 있는 곳은 <code>/sandbox</code>와{" "}
          <code>/tmp</code>뿐이에요.
        </li>
        <li>
          열리는 곳: {opens.length === 0 ? "정책 프리셋이 허용한 곳뿐" : opens.join(", ")}. 그 밖의
          연결은 막히고, 막힌 시도는 이 화면에 기록돼요.
        </li>
        {refused.length === 0 ? null : (
          <li>리포트가 언급했지만 열지 않는 곳: {refused.join(", ")}.</li>
        )}
        <li>최대 15분. 끝나지 않으면 끝난 데까지를 결과로 남겨요.</li>
      </ul>
      <div className={styles.approvalActions}>
        <Button
          variant="primary"
          icon={ShieldCheck}
          loading={pending}
          loadingLabel="실행 요청 중"
          onClick={() => {
            startTransition(async () => {
              const outcome = await approveTrial(itemId);
              setResult(outcome);
              setConfirming(false);
              setReturnFocus(true);
            });
          }}
        >
          승인하고 실행
        </Button>
        <Button variant="ghost" onClick={cancel} disabled={pending}>
          취소
        </Button>
      </div>
    </div>
  );
}
