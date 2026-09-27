/**
 * Content available to assistive technology but not painted.
 *
 * Used wherever meaning would otherwise be carried by shape or colour alone
 * (DESIGN.md §18, frontend architecture §23).
 */
export interface VisuallyHiddenProps {
  readonly children: React.ReactNode;
  readonly as?: "span" | "div";
}

export function VisuallyHidden({ children, as: Component = "span" }: VisuallyHiddenProps) {
  return <Component className="visually-hidden">{children}</Component>;
}
