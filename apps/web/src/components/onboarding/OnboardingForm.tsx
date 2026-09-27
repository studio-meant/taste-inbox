"use client";

import type { OnboardingField, OnboardingRequest } from "@taste-inbox/shared";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { SourceMark } from "@/components/today/SourceMark";
import styles from "./OnboardingForm.module.css";

/**
 * First-run setup: four answers, one submit.
 *
 * The rules are checked here so a person hears about a missing name before a round trip,
 * and checked again by the service, which is the one that decides (`api/profile.py`): a name
 * is required, a GitHub or a Hugging Face name — at least one — and an interval in hours.
 * Whatever the service refuses comes back with its field, and lands under that input.
 */

type Values = Omit<OnboardingRequest, "intervalHours"> & { readonly intervalHours: number };
type Errors = Partial<Record<OnboardingField, string>>;

function check(values: Values, bounds: { min: number; max: number }): Errors {
  const errors: Errors = {};
  if (values.name.trim() === "") errors.name = "이름을 입력해 주세요.";
  if (values.github.trim() === "" && values.huggingface.trim() === "") {
    errors.accounts = "GitHub와 Hugging Face 중 하나 이상의 계정명을 입력해 주세요.";
  }
  if (
    !Number.isInteger(values.intervalHours) ||
    values.intervalHours < bounds.min ||
    values.intervalHours > bounds.max
  ) {
    errors.intervalHours = `${String(bounds.min)}–${String(bounds.max)}시간 사이로 입력해 주세요.`;
  }
  return errors;
}

export function OnboardingForm({
  initial,
  intervalBounds,
  returning,
  onSubmit,
}: {
  readonly initial: Values;
  readonly intervalBounds: { readonly min: number; readonly max: number };
  /** Already set up: the same form, showing what is saved. */
  readonly returning: boolean;
  readonly onSubmit: (
    request: OnboardingRequest,
  ) => Promise<{ ok: boolean; message: string; field?: OnboardingField }>;
}) {
  const router = useRouter();
  const id = useId();
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof Values) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    setValues((previous) => ({
      ...previous,
      [key]: key === "intervalHours" ? Number(raw) : raw,
    }));
  };

  const submit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = check(values, intervalBounds);
    setErrors(found);
    setGeneral(null);
    if (Object.keys(found).length > 0) return;
    startTransition(async () => {
      const result = await onSubmit(values);
      if (result.ok) {
        router.replace("/today");
        return;
      }
      if (result.field === undefined) setGeneral(result.message);
      else setErrors({ [result.field]: result.message });
    });
  };

  const field = (name: OnboardingField) => `${id}-${name}`;

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
        <p className={styles.eyebrow} lang="en">
          Taste Inbox R&amp;D
        </p>
        <h1 id={`${id}-title`} className={styles.title}>
          {returning ? "시작 설정" : "시작하기"}
        </h1>
        <p className={styles.lead}>
          GitHub와 Hugging Face에 남긴 관심 신호를 모아 조사하고, 안전하게 시험해 봐요. 네 가지만
          알려주세요.
        </p>

        <div className={styles.row}>
          <label htmlFor={field("name")} className={styles.label}>
            이름 <span className={styles.required}>필수</span>
          </label>
          <input
            id={field("name")}
            className={styles.input}
            value={values.name}
            onChange={set("name")}
            maxLength={32}
            autoComplete="given-name"
            aria-invalid={errors.name === undefined ? undefined : true}
            aria-describedby={`${field("name")}-help`}
          />
          <p id={`${field("name")}-help`} className={errors.name ? styles.error : styles.help}>
            {errors.name ?? "화면 왼쪽 위와 인사말에 쓰여요. 이 Mac 밖으로 나가지 않아요."}
          </p>
        </div>

        <fieldset
          className={styles.accounts}
          aria-describedby={`${field("accounts")}-help`}
          aria-invalid={errors.accounts === undefined ? undefined : true}
        >
          <legend className={styles.label}>
            계정명 <span className={styles.optional}>둘 중 하나 이상</span>
          </legend>
          {(
            [
              ["github", "GitHub", "github.com/", "별(Star)을 누른 저장소를 모아요."],
              [
                "huggingface",
                "Hugging Face",
                "huggingface.co/",
                "좋아요한 모델·데이터셋·Space와 업보트한 논문을 모아요.",
              ],
            ] as const
          ).map(([platform, label, prefix, what]) => (
            <div key={platform} className={styles.account}>
              <label htmlFor={field(platform)} className={styles.accountLabel}>
                <SourceMark platform={platform} size={16} />
                {label}
              </label>
              <div className={styles.prefixed}>
                <span className={styles.prefix} aria-hidden="true">
                  {prefix}
                </span>
                <input
                  id={field(platform)}
                  className={styles.input}
                  value={values[platform]}
                  onChange={set(platform)}
                  placeholder="계정명"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={errors[platform] === undefined ? undefined : true}
                  aria-describedby={`${field(platform)}-help`}
                />
              </div>
              <p
                id={`${field(platform)}-help`}
                className={errors[platform] ? styles.error : styles.help}
              >
                {errors[platform] ?? what}
              </p>
            </div>
          ))}
          <p
            id={`${field("accounts")}-help`}
            className={errors.accounts ? styles.error : styles.help}
          >
            {errors.accounts ??
              "로그인은 필요 없어요. 모두 공개 정보라 계정명만으로 읽어요. 프로필 주소를 붙여 넣어도 돼요."}
          </p>
        </fieldset>

        <div className={styles.row}>
          <label htmlFor={field("intervalHours")} className={styles.label}>
            수집 주기
          </label>
          <div className={styles.interval}>
            <input
              id={field("intervalHours")}
              className={styles.number}
              type="number"
              inputMode="numeric"
              min={intervalBounds.min}
              max={intervalBounds.max}
              step={1}
              value={Number.isNaN(values.intervalHours) ? "" : values.intervalHours}
              onChange={set("intervalHours")}
              aria-invalid={errors.intervalHours === undefined ? undefined : true}
              aria-describedby={`${field("intervalHours")}-help`}
            />
            <span>시간마다</span>
          </div>
          <p
            id={`${field("intervalHours")}-help`}
            className={errors.intervalHours ? styles.error : styles.help}
          >
            {errors.intervalHours ??
              "마지막 수집 이후 새로 생긴 것만 가져와요. 설정에서 언제든 바꿀 수 있어요."}
          </p>
        </div>

        {general === null ? null : (
          <p className={styles.error} role="alert">
            {general}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          icon={ArrowRight}
          iconPosition="end"
          loading={pending}
          loadingLabel="저장하는 중"
          className={styles.submit}
        >
          {returning ? "저장하고 돌아가기" : "시작하기"}
        </Button>
      </form>
    </div>
  );
}
