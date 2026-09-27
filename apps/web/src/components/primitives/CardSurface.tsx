import styles from "./CardSurface.module.css";
import { cx } from "@/lib/cx";

/**
 * The product's surface primitive.
 *
 * The prop shape is taken directly from frontend architecture §20:
 * `<CardSurface tone="warm" elevation="floating" radius="story">`. Every variant name
 * describes a **visual role**, never a domain meaning — a card does not know whether it
 * is showing an AI repository or a jacket.
 */

export type CardTone = "plain" | "warm" | "tinted" | "glass" | "inverse";
export type CardElevation = "flat" | "raised" | "floating";
export type CardRadius = "utility" | "card" | "story" | "media";
export type CardPadding = "none" | "compact" | "standard" | "large";

const PADDING_CLASS: Readonly<Record<CardPadding, string | null>> = {
  none: null,
  compact: styles.padCompact ?? null,
  standard: styles.padStandard ?? null,
  large: styles.padLarge ?? null,
};

export interface CardSurfaceProps extends React.HTMLAttributes<HTMLElement> {
  readonly tone?: CardTone;
  readonly elevation?: CardElevation;
  readonly radius?: CardRadius;
  readonly padding?: CardPadding;
  /**
   * Adds hover lift and focus ring. Use only when the whole surface activates
   * something; a card containing several independent actions must stay `false`.
   */
  readonly interactive?: boolean;
  /**
   * Semantic element. Item-like content should be `article`, a group of cards `li`,
   * and a page region `section` (frontend architecture §23).
   */
  readonly as?: "div" | "article" | "section" | "li" | "aside";
}

export function CardSurface({
  tone = "plain",
  elevation = "raised",
  radius = "card",
  padding = "standard",
  interactive = false,
  as: Component = "div",
  className,
  children,
  ...rest
}: CardSurfaceProps) {
  return (
    <Component
      {...rest}
      /*
       * The hook the smoke suite counts and measures.
       *
       * Not a test-only affectation: `CardSurface` is the one primitive every card on every
       * screen goes through, and the two bugs that put 76 cards in the DOM behind a 2px-wide
       * board were only findable by measuring a card's box. There is no element or role that
       * identifies one — this renders a `div` on Today, an `article` on the boards and a
       * `section` elsewhere — so the suite would otherwise be guessing a selector per screen
       * and quietly asserting nothing where it guessed wrong.
       */
      data-card=""
      className={cx(
        styles.surface,
        styles[tone],
        styles[elevation],
        styles[radius],
        PADDING_CLASS[padding],
        interactive ? styles.interactive : null,
        className,
      )}
    >
      {children}
    </Component>
  );
}
