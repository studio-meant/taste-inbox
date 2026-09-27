import { Skeleton } from "@/components/primitives";

/** System loading boundary. Renders inside the shell's `main`; no landmark of its own. */
export default function SystemLoading() {
  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <span className="visually-hidden" role="status" aria-live="polite">
        시스템 상태를 확인하고 있어요.
      </span>
      <Skeleton shape="text" width="10ch" height="2.6rem" />
      <div
        style={{
          display: "grid",
          gap: "var(--grid-gap)",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} shape="card" height="118px" />
        ))}
      </div>
    </div>
  );
}
