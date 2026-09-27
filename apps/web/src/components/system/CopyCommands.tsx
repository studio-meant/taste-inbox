"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/primitives";

/**
 * The only interactive thing in the launchd panel, and it copies text.
 *
 * A Client Component because it needs `onClick` and one piece of transient state, which is
 * the whole of CLAUDE.md §6's bar for becoming one. Everything else in the panel — the job
 * list, the commands, the prose — stays on the server.
 *
 * **It does not, and must not, grow into an install button.** `docs/DECISIONS.md`
 * 2026-08-08 fixes this: launchd jobs are generated, never installed. Copying a command to
 * the clipboard leaves the decision with the person holding it; running one loads six jobs
 * that open four logged-in accounts on a timer, which CLAUDE.md §10 keeps behind explicit
 * human action.
 *
 * The result is said in words next to an icon, never by colour alone (DESIGN.md §18), and
 * there is no transition anywhere in this component — so there is no motion for a
 * reduced-motion preference to have an opinion about.
 */

export interface CopyCommandsProps {
  /** The block exactly as it should land on the clipboard. Never reformatted here. */
  readonly text: string;
  /** Which block this is, for the button's accessible name: "등록", "해제". */
  readonly blockName: string;
}

type CopyState = "idle" | "copied" | "failed";

export function CopyCommands({ text, blockName }: CopyCommandsProps) {
  const [state, setState] = useState<CopyState>("idle");

  async function copy(): Promise<void> {
    try {
      // Throws rather than resolving false when the clipboard is unavailable — an insecure
      // context, or a browser that refuses. Both land in the same honest fallback below,
      // which is a sentence telling the user to select the block themselves.
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <span className="launchd-copy">
      <Button
        compact
        icon={state === "copied" ? Check : Copy}
        onClick={() => {
          void copy();
        }}
      >
        {blockName} 명령 복사
      </Button>
      {/*
        `aria-live` on a container that is always present, so the message is announced when
        it arrives rather than being missed as a newly inserted region. Empty until the user
        has pressed something.
      */}
      <span className="launchd-copy-state type-body-small" aria-live="polite">
        {state === "copied" ? "복사됨" : null}
        {state === "failed" ? "복사하지 못했어요. 직접 선택해서 복사해 주세요." : null}
      </span>
    </span>
  );
}
