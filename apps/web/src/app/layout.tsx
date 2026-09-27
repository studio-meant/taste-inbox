import type { Metadata, Viewport } from "next";
import { DEFAULT_THEME_ID } from "@taste-inbox/ui/theme";
import { ThemeStyles } from "@/components/theme/ThemeStyles";
import { DEFAULT_MOTION_MODE, buildThemeBootstrapScript } from "@/components/theme/theme-bootstrap";
import "./globals.css";

/**
 * Root layout.
 *
 * Responsibilities per frontend architecture §5: html language, font variables, global
 * metadata, global providers, toast region, command palette mount, reduced-motion
 * bootstrap. Providers and overlay mounts arrive with the components that need them in
 * Phase 1; the shell they attach to is established here.
 */

export const metadata: Metadata = {
  title: "Taste Inbox",
  description: "남긴 관심 신호를 다음 행동으로 연결하는 개인용 로컬 워크스페이스",
  // Local-first, single-user: nothing about this app should be indexed or shared.
  robots: { index: false, follow: false },
  applicationName: "Taste Inbox",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 200% zoom must not lose content (architecture §23), so zoom stays unrestricted.
  maximumScale: 5,
};

const themeBootstrap = buildThemeBootstrapScript();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // UI language is Korean-first (CLAUDE.md §2). Server-rendered defaults match the
    // locked default theme, so only a non-default saved theme needs the bootstrap.
    <html lang="ko" data-theme={DEFAULT_THEME_ID} data-motion={DEFAULT_MOTION_MODE}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <ThemeStyles />
        <a className="skip-link" href="#main">
          본문으로 건너뛰기
        </a>
        {children}
      </body>
    </html>
  );
}
