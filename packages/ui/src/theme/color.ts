/**
 * Minimal sRGB helpers used to resolve the theme ramps at build time.
 *
 * Deliberately not a colour library: the only operation the token system needs is an
 * opaque sRGB mix, and keeping it here means the ramp derivation is inspectable and
 * unit-testable rather than hidden behind a dependency.
 */

const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function parseHex(hex: string): Rgb {
  const normalized = hex.trim();
  if (!HEX_PATTERN.test(normalized)) {
    throw new Error(`Expected a 6-digit hex colour, received "${hex}"`);
  }
  const value = Number.parseInt(normalized.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/**
 * Mix two opaque sRGB colours.
 *
 * @param weight share of `from`, in `[0, 1]`. `mix(a, b, 1)` returns `a`.
 */
export function mix(from: string, to: string, weight: number): string {
  if (!(weight >= 0 && weight <= 1)) {
    throw new Error(`Mix weight must be within [0, 1], received ${String(weight)}`);
  }
  const a = parseHex(from);
  const b = parseHex(to);
  const rest = 1 - weight;
  return toHex({
    r: a.r * weight + b.r * rest,
    g: a.g * weight + b.g * rest,
    b: a.b * weight + b.b * rest,
  });
}

/** Relative luminance (WCAG 2.x), used to assert that ramps stay monotonic. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two opaque colours. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Push a foreground colour toward `toward` until it clears a contrast target.
 *
 * Semantic status colours have to work across seven palettes of quite different
 * lightness. Hand-picking 70 hex values would guarantee that some pair silently fails
 * WCAG; walking the ramp until the ratio is met cannot. The hue is preserved as far as
 * the target allows, and the walk is deterministic, so two runs produce the same value.
 *
 * @param foreground starting colour, typically the theme's own accent for that meaning
 * @param background surface the text sits on
 * @param toward     colour to blend into, normally the theme's ink
 * @param target     minimum contrast ratio; 4.5 is WCAG AA for body text
 */
export function ensureContrast(
  foreground: string,
  background: string,
  toward: string,
  target = 4.5,
): string {
  if (contrastRatio(foreground, background) >= target) {
    return foreground;
  }
  // 20 steps of 5% is enough to reach `toward` exactly, which is the theme's ink and
  // therefore already known to clear the target against every content surface.
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(toward, foreground, step * 0.05);
    if (contrastRatio(candidate, background) >= target) {
      return candidate;
    }
  }
  return toward;
}
