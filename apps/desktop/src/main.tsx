import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_THEME_ID, THEME_IDS, THEME_STORAGE_KEY } from "@taste-inbox/ui/theme";
import { ThemeStyles } from "@/components/theme/ThemeStyles";
import {
  DEFAULT_MOTION_MODE,
  MOTION_STORAGE_KEY,
  type MotionMode,
} from "@/components/theme/theme-bootstrap";
import "@/app/globals.css";
import { installExternalLinkHandler } from "./external-links";
import { DesktopRouter } from "./router";

const MOTION_MODES: readonly MotionMode[] = ["cinematic", "ambient", "reduced"];
const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
const savedMotion = window.localStorage.getItem(MOTION_STORAGE_KEY);

document.documentElement.dataset.theme =
  savedTheme !== null && THEME_IDS.includes(savedTheme) ? savedTheme : DEFAULT_THEME_ID;
document.documentElement.dataset.motion =
  savedMotion !== null && MOTION_MODES.includes(savedMotion as MotionMode)
    ? savedMotion
    : DEFAULT_MOTION_MODE;

const root = document.getElementById("root");
if (root === null) throw new Error("Desktop root is missing");

installExternalLinkHandler();

createRoot(root).render(
  <StrictMode>
    <ThemeStyles />
    <a className="skip-link" href="#main">
      본문으로 건너뛰기
    </a>
    <DesktopRouter />
  </StrictMode>,
);
