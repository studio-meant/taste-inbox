import { Skeleton } from "@/components/primitives";

/**
 * Workspace loading boundary.
 *
 * Renders *inside* the shell's `main`, so the frame and the ambient canvas stay on
 * screen while the page resolves — DESIGN.md §25: "shell and scenic canvas first,
 * independent module skeleton".
 *
 * One polite announcement for the region; the individual skeletons stay silent
 * (architecture §23 live regions).
 */
export default function WorkspaceLoading() {
  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <span className="visually-hidden" role="status" aria-live="polite">
        화면을 준비하고 있어요.
      </span>
      <Skeleton shape="text" width="8ch" height="2.6rem" />
      <Skeleton shape="text" width="34ch" />
      <div
        style={{
          display: "grid",
          gap: "var(--grid-gap)",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        <Skeleton shape="card" aspectRatio="3 / 2" />
        <Skeleton shape="card" aspectRatio="3 / 2" />
        <Skeleton shape="card" aspectRatio="3 / 2" />
      </div>
    </div>
  );
}
