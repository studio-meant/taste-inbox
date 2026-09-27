import { Skeleton } from "@/components/primitives";

/** Settings loading boundary. Renders inside the shell's `main`; no landmark of its own. */
export default function SettingsLoading() {
  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <span className="visually-hidden" role="status" aria-live="polite">
        설정을 불러오고 있어요.
      </span>
      <Skeleton shape="text" width="12ch" height="2.6rem" />
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} shape="card" height="180px" />
      ))}
    </div>
  );
}
