"use client";

import type { ManualItemCreateRequest } from "@taste-inbox/shared";
import { Link2, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { addManualItem } from "@/app/(workspace)/actions";
import { Button } from "@/components/primitives";
import styles from "./AddLinkButton.module.css";

/**
 * `링크 추가` — a repository, model, paper or page the person wants in the Inbox without
 * having starred or liked it. The URL decides what it is; nothing is fetched from it.
 */
export function AddLinkButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState(false);

  async function submit(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    const text = (name: string): string => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    const input: ManualItemCreateRequest = {
      url: text("url"),
      title: text("title"),
      note: text("note"),
    };
    setBusy(true);
    setFailure(false);
    setMessage("");
    const result = await addManualItem(input);
    setBusy(false);
    setFailure(!result.ok);
    setMessage(result.message);
    if (result.ok) {
      form.reset();
      dialog.current?.close();
    }
  }

  return (
    <div className={styles.root}>
      <Button
        compact
        variant="secondary"
        icon={Plus}
        onClick={() => {
          setMessage("");
          dialog.current?.showModal();
        }}
      >
        링크 추가
      </Button>
      <span className={styles.announcement} role={failure ? "alert" : "status"}>
        {message}
      </span>

      <dialog ref={dialog} className={styles.dialog} aria-labelledby="add-link-title">
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget);
          }}
        >
          <header className={styles.dialogHead}>
            <span className={styles.dialogIcon}>
              <Link2 size={19} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div>
              <h2 id="add-link-title">링크 직접 추가</h2>
              <p>페이지를 긁지 않고 입력한 내용만 이 Mac에 저장합니다.</p>
            </div>
            <button
              className={styles.close}
              type="button"
              aria-label="닫기"
              onClick={() => dialog.current?.close()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <label className={styles.field}>
            <span>링크</span>
            <input
              name="url"
              type="url"
              inputMode="url"
              required
              maxLength={2048}
              autoFocus
              placeholder="https://github.com/…, https://huggingface.co/…, https://arxiv.org/…"
            />
          </label>

          <label className={styles.field}>
            <span>제목 · 선택</span>
            <input name="title" type="text" maxLength={200} />
          </label>

          <label className={styles.field}>
            <span>메모 · 선택</span>
            <textarea name="note" rows={4} maxLength={5000} />
          </label>

          {failure ? <p className={styles.error}>{message}</p> : null}
          <footer className={styles.actions}>
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              취소
            </Button>
            <Button type="submit" variant="primary" loading={busy} loadingLabel="추가하는 중">
              저장
            </Button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
