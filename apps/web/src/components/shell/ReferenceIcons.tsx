/**
 * The chrome's own glyphs, traced from the approved reference (`reference/ref.js`
 * `Icon()`): `viewBox 0 0 24 24`, `fill: none`, `stroke: currentColor`,
 * `stroke-width: 1.8`, round caps and joins.
 *
 * These five are not lucide shapes. The reference's `home` is a bare roof-and-box, its
 * `grid` is four rounded squares, and its `arrow` has a longer shaft than any lucide
 * arrow — swapping in look-alikes is most of the gap between "similar" and "the same
 * drawing". Everywhere outside the shell chrome the product keeps using lucide.
 *
 * Sizing is CSS-owned: the glyphs carry no width/height, so `width`/`height` in the
 * consuming module rule decides, and `cqw` sizing works without a prop threaded through.
 */

export interface ReferenceIconProps {
  readonly className?: string;
}

function frame(className: string | undefined, children: React.ReactNode) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function HomeGlyph({ className }: ReferenceIconProps) {
  return frame(
    className,
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10.5V20h13v-9.5" />
    </>,
  );
}

export function GridGlyph({ className }: ReferenceIconProps) {
  return frame(
    className,
    <>
      <rect x={4} y={4} width={6} height={6} rx={1.4} />
      <rect x={14} y={4} width={6} height={6} rx={1.4} />
      <rect x={4} y={14} width={6} height={6} rx={1.4} />
      <rect x={14} y={14} width={6} height={6} rx={1.4} />
    </>,
  );
}

export function MicGlyph({ className }: ReferenceIconProps) {
  return frame(
    className,
    <>
      <rect x={9} y={3} width={6} height={12} rx={3} />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>,
  );
}

export function ArrowGlyph({ className }: ReferenceIconProps) {
  return frame(
    className,
    <>
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </>,
  );
}

export function SparkGlyph({ className }: ReferenceIconProps) {
  return frame(
    className,
    <>
      <path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4Z" />
      <path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" />
    </>,
  );
}
