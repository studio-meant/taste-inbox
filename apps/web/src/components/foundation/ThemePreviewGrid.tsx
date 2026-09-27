import type { Theme } from "@taste-inbox/ui/theme";
import { themeCssVariables } from "@taste-inbox/ui/theme";

interface Props {
  readonly themes: readonly Theme[];
}

const RAMP_STEPS = [
  { token: "lightGreen", label: "연두" },
  { token: "sage", label: "세이지" },
  { token: "leaf", label: "리프" },
  { token: "forest", label: "포레스트" },
  { token: "cream", label: "크림" },
  { token: "oatmeal", label: "오트밀" },
  { token: "lightWood", label: "라이트 우드" },
] as const;

/**
 * Renders each theme inside its own token scope.
 *
 * Every card carries the full variable set inline, so a preview is genuinely the theme
 * rather than an approximation. Server Component; no client JavaScript.
 */
export function ThemePreviewGrid({ themes }: Props) {
  return (
    <ul className="theme-grid">
      {themes.map((theme) => (
        <li
          key={theme.id}
          className="theme-card"
          // Scoped token override — the same mechanism the root uses.
          style={themeCssVariables(theme) as React.CSSProperties}
        >
          <article aria-labelledby={`theme-${theme.id}`}>
            <div className="theme-card-head">
              <h3 id={`theme-${theme.id}`} className="type-card-title">
                {theme.name}
              </h3>
              {theme.recommended === true ? (
                <span className="theme-default-badge type-label">기본값</span>
              ) : (
                <span className="theme-group type-label">{theme.group}</span>
              )}
            </div>

            <p className="type-body-small clamp-3">{theme.description}</p>

            <ul className="theme-ramp" aria-label={`${theme.name} 색상 램프`}>
              {RAMP_STEPS.map((step) => (
                <li key={step.token} className="theme-ramp-step">
                  <span
                    className="theme-ramp-chip"
                    style={{ background: theme.tokens[step.token] }}
                  />
                  {/* Not colour-only: every swatch is named and its value readable. */}
                  <span className="visually-hidden">
                    {step.label} {theme.tokens[step.token]}
                  </span>
                  <span aria-hidden="true" className="theme-ramp-label type-mono">
                    {theme.tokens[step.token]}
                  </span>
                </li>
              ))}
            </ul>

            <p className="type-body-small theme-note">{theme.note}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}
