import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const DESKTOP_ROOT = import.meta.dirname;
const WEB_ROOT = resolve(DESKTOP_ROOT, "../web");
const DESKTOP_ACTIONS = resolve(DESKTOP_ROOT, "src/desktop-actions.ts");
const DESKTOP_REPOSITORY = resolve(DESKTOP_ROOT, "src/desktop-repository.ts");

/** Replace only Next's runtime edges; page and component implementations stay shared. */
function desktopEdges(): Plugin {
  return {
    name: "taste-inbox-desktop-edges",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "next/link") return resolve(DESKTOP_ROOT, "src/shims/link.tsx");
      if (source === "next/navigation") return resolve(DESKTOP_ROOT, "src/shims/navigation.ts");
      if (source === "@/app/(workspace)/actions") return DESKTOP_ACTIONS;
      if (source === "@/lib/repository") return DESKTOP_REPOSITORY;
      if (
        source === "./actions" &&
        importer?.includes("/apps/web/src/app/settings/page.tsx") === true
      ) {
        return DESKTOP_ACTIONS;
      }
      return null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: DESKTOP_ROOT,
  base: "./",
  publicDir: resolve(WEB_ROOT, "public"),
  plugins: [desktopEdges(), react()],
  resolve: {
    alias: [
      { find: "@/app/(workspace)/actions", replacement: DESKTOP_ACTIONS },
      { find: "@/lib/repository", replacement: DESKTOP_REPOSITORY },
      { find: "@", replacement: resolve(WEB_ROOT, "src") },
    ],
    dedupe: ["react", "react-dom"],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode),
    "process.env.NEXT_PUBLIC_DATA_SOURCE": JSON.stringify("live"),
    "process.env.NEXT_PUBLIC_REMOTE_READ_ONLY": JSON.stringify("0"),
    "process.env.TASTE_INBOX_API_URL": "undefined",
    "process.env.TASTE_INBOX_USE_CAPTURES": "undefined",
    "process.env.TASTE_INBOX_CAPTURE_DIR": "undefined",
    "process.env.APP_TIMEZONE": JSON.stringify("Asia/Seoul"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    strictPort: true,
  },
}));
