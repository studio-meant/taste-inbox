import { themeStylesheet } from "@taste-inbox/ui/theme";

const css = themeStylesheet();

/**
 * Emits every theme as a `[data-theme]` block.
 *
 * A Server Component with no client JavaScript: changing theme is one attribute swap on
 * the root element, so the current screen, filter state and Query Dock state survive it
 * (docs/THEME_SYSTEM.md, CLAUDE.md §6). React hoists this into `<head>`.
 */
export function ThemeStyles() {
  return (
    <style
      precedence="high"
      href="taste-inbox-themes"
      // Generated from the registry, never from user input.
      dangerouslySetInnerHTML={{ __html: css }}
    />
  );
}
