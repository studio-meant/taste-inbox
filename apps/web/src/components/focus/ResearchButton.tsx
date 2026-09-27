"use client";

import { Search } from "lucide-react";
import { useState, useTransition } from "react";
import { requestResearch } from "@/app/(workspace)/focus/actions";
import { Button } from "@/components/primitives";
import styles from "./FocusCanvas.module.css";

/**
 * Ask AI-Q about this item. Starting it is the whole job of this component — following the
 * run is the canvas's, which re-reads the route while the job is moving.
 *
 * `disabledReason` is the service's own refusal read in advance (no `AIQ_SERVER_URL`, a
 * backend that is not local and not https). The button is then disabled with that sentence
 * beside it, rather than enabled and failing on the first press.
 *
 * Never retried on its own (`aiq-research/SKILL.md`). A second press is a person asking
 * again.
 */
export function ResearchButton({
  itemId,
  label,
  disabledReason,
}: {
  readonly itemId: string;
  readonly label: string;
  readonly disabledReason: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className={styles.actionRow}>
      <Button
        variant="primary"
        icon={Search}
        loading={pending}
        loadingLabel="조사 요청 중"
        disabled={disabledReason !== null}
        onClick={() => {
          startTransition(async () => {
            setResult(await requestResearch(itemId));
          });
        }}
      >
        {label}
      </Button>
      {disabledReason !== null ? (
        <p className={styles.note}>{disabledReason}</p>
      ) : result === null ? null : (
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
