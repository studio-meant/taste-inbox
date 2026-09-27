/**
 * Layer 1 — primitives (frontend architecture §6.1).
 *
 * Rules these components all obey:
 * - no raw hex; every colour comes from a theme token
 * - no domain status text hard-coded inside
 * - semantic HTML first
 * - keyboard interaction included
 * - no motion-library dependency (§21 permits it in four components, none of them here)
 */

export { Button, type ButtonProps, type ButtonVariant } from "./Button";
export {
  CardSurface,
  type CardElevation,
  type CardPadding,
  type CardRadius,
  type CardSurfaceProps,
  type CardTone,
} from "./CardSurface";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { ErrorState, type ErrorStateProps } from "./ErrorState";
export { IconButton, type IconButtonProps } from "./IconButton";
export { Meter, type MeterProps, type MeterTone } from "./Meter";
export { SignalChip, type SignalChipProps } from "./SignalChip";
export { Skeleton, type SkeletonProps } from "./Skeleton";
export { StatusPill, type StatusPillProps } from "./StatusPill";
export { VisuallyHidden, type VisuallyHiddenProps } from "./VisuallyHidden";
