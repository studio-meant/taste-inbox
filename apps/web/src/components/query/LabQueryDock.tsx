"use client";

import type { AskedQuestion, SuggestedQuestion } from "@taste-inbox/shared";
import { useState, useTransition } from "react";
import { askLabQuestion } from "@/app/(workspace)/focus/actions";
import { ArrowGlyph, SparkGlyph } from "@/components/shell/ReferenceIcons";
import styles from "./TasteQueryDock.module.css";

/**
 * `What do you want to know?` — the Taste Query Dock, finally connected to something.
 *
 * **This is the same composer**, not a second one. Same module stylesheet, same orb, same
 * send button, same silhouette; `TasteQueryDock` keeps rendering the read-only version on
 * Today and Browse, where there is still no query path over the library. What is different
 * here is that there is now something on the other side of the field: a question about one
 * item, which `POST /api/lab/questions` turns into a verification goal, acceptance criteria
 * and a trial plan.
 *
 * It also fills the slot the reference draws above the dock and this product had to leave
 * empty — three suggestion chips. They are the item's own: each one is offered because
 * something in *this* row supports it, and the sentence saying which fact that is travels
 * with the chip as its accessible description (`action/questions.py`).
 *
 * ── The asymmetry this component exists to keep ─────────────────────────────────────
 *
 * 무엇을 확인할지는 사람, 어떻게 확인할지는 Agent. Nothing here picks a question. A chip is a
 * one-click way to *say* one, and the free-form field is the other way; both end in the
 * same POST, and the plan that comes back is the agent's answer to what the person chose.
 * There is no path from this screen to a trial that nobody asked for.
 */
export function LabQueryDock({
  itemId,
  suggestions,
  asked,
  planning,
  disabledReason,
}: {
  readonly itemId: string;
  readonly suggestions: readonly SuggestedQuestion[];
  /** The question already on this item, if there is one. */
  readonly asked: AskedQuestion | null;
  /** A planning pass is running — the field waits rather than queueing a second. */
  readonly planning: boolean;
  /** Why no question can be asked right now, in words. Null when one can. */
  readonly disabledReason: string | null;
}) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const busy = pending || planning;
  const locked = disabledReason !== null;

  const send = (question: string) => {
    const trimmed = question.trim();
    if (trimmed === "" || busy || locked) return;
    startTransition(async () => {
      const outcome = await askLabQuestion(itemId, trimmed);
      setResult(outcome);
      if (outcome.ok) setText("");
    });
  };

  return (
    <div className={`${styles.area ?? ""} ${styles.areaInline ?? ""}`}>
      {asked === null ? null : (
        <div className={styles.asked}>
          <p className={styles.askedLabel} lang="en">
            You asked
          </p>
          <p className={styles.askedText}>{asked.question}</p>
        </div>
      )}

      {suggestions.length === 0 ? null : (
        <ul className={styles.suggestions} aria-label="확인해볼 만한 질문">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <button
                type="button"
                className={styles.suggestion}
                disabled={busy || locked}
                /*
                 * The premise is the chip's *description*, never its name. As a `title` it
                 * became the accessible name in the tree, so a screen reader announced why
                 * the question was offered and never the question — and it is printed
                 * beside the chip anyway, because a suggestion has to be judgeable before
                 * it is picked.
                 */
                aria-describedby={`${suggestion.id}-why`}
                onClick={() => {
                  send(suggestion.text);
                }}
              >
                {suggestion.text}
                <span id={`${suggestion.id}-why`} className={styles.suggestionWhy}>
                  {suggestion.because}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className={styles.dock}
        onSubmit={(event) => {
          event.preventDefault();
          send(text);
        }}
      >
        <span className={styles.orb} aria-hidden="true">
          <i className={styles.petal} />
          <i className={styles.petal} />
          <i className={styles.petal} />
        </span>

        <label className="visually-hidden" htmlFor="lab-question-input">
          What do you want to know?
        </label>
        <input
          id="lab-question-input"
          className={styles.input}
          type="text"
          value={text}
          maxLength={500}
          disabled={locked}
          aria-describedby="lab-question-notice"
          placeholder={locked ? "지금은 질문할 수 없어요" : "무엇을 확인하고 싶으세요?"}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />

        {/*
          The slot the reference gives to `⌘ K`. There is no shortcut, and `질문` sitting
          beside a send button was the button's own job said twice. It carries the one
          state the button cannot show, and is empty otherwise.
        */}
        {busy ? <span className={styles.chip}>설계 중</span> : <span aria-hidden="true" />}

        <span aria-hidden="true" />
        <button
          type="submit"
          className={styles.send}
          disabled={busy || locked || text.trim() === ""}
          aria-label={busy ? "검증 설계 중" : "질문 보내기"}
        >
          <ArrowGlyph className={styles.buttonGlyph} />
        </button>
      </form>

      <p className={styles.notice} id="lab-question-notice">
        <SparkGlyph className={styles.noticeIcon} />
        {locked
          ? disabledReason
          : busy
            ? "AI-Q가 이 질문을 검증 가능한 기준과 Trial Plan으로 바꾸고 있어요."
            : "질문을 고르거나 직접 적으면, Agent가 어떻게 확인할지 설계해요."}
      </p>

      {result === null ? null : (
        <p
          className={`${styles.result ?? ""} ${result.ok ? "" : (styles.resultError ?? "")}`}
          role={result.ok ? "status" : "alert"}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
