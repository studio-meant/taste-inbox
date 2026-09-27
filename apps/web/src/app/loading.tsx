/**
 * Root loading boundary.
 *
 * Sits *above* the shell, so it must not render a `main` landmark or claim `id="main"` —
 * the AppShell below it owns both, and two of either is an accessibility defect
 * (frontend architecture §23: one `main`, one `h1`).
 *
 * DESIGN.md §25: the entry has a maximum splash duration and shows real status after a
 * second. Until the entry sequence exists, this is a single polite announcement.
 */
export default function RootLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100dvh",
        color: "var(--muted)",
      }}
      className="type-body"
    >
      화면을 준비하고 있어요.
    </div>
  );
}
