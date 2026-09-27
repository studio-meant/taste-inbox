"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import styles from "./AccountsSection.module.css";

/** The display name from onboarding, changeable here. Local only; it greets, nothing more. */
export function ProfileSection({
  name,
  onSave,
}: {
  readonly name: string;
  readonly onSave: (name: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [value, setValue] = useState(name);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const dirty = value.trim() !== name;

  return (
    <section className={styles.section} aria-labelledby="settings-profile">
      <h2 id="settings-profile" className="type-section-title">
        이름
      </h2>
      <form
        className={styles.profileRow}
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            setResult(await onSave(value));
          });
        }}
      >
        <label htmlFor="settings-profile-name" className="visually-hidden">
          화면에 표시할 이름
        </label>
        <input
          id="settings-profile-name"
          className={styles.input}
          value={value}
          maxLength={32}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        <Button
          type="submit"
          variant="primary"
          compact
          loading={pending}
          loadingLabel="저장 중"
          disabled={!dirty || value.trim() === ""}
        >
          저장
        </Button>
      </form>
      <p className={styles.help}>화면 왼쪽 위와 인사말에 쓰여요. 이 Mac 밖으로 나가지 않아요.</p>
      {result === null ? null : (
        <p className={result.ok ? styles.ok : styles.error} role={result.ok ? "status" : "alert"}>
          {result.message}
        </p>
      )}
    </section>
  );
}
