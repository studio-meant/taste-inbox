/**
 * A transcript of `GET /api/collection/launchd`, not a second implementation of it.
 *
 * The lines below were copied from a live response on a checkout with no `config/app.yaml`,
 * so they carry the shipped `config/app.example.yaml` numbers: `interval_hours: 4`,
 * `stagger_minutes: 3`, six collectors in `SOURCE_ORDER`. Nothing here derives them —
 * `api/launchd.py:install_commands` is the only thing that composes a `launchctl` line, and
 * a TypeScript copy of it would be a second source of truth for the one string in this
 * product a person is expected to paste into a terminal.
 *
 * **The paths are deliberately not this Mac's.** A real response spells out the absolute
 * repository path, because `launchctl bootstrap` will not work otherwise. Mock mode cannot
 * know that path, and inventing a plausible-looking one would hand the user commands that
 * quietly reference nothing. `/Users/you` reads as the placeholder it is, and the panel says
 * so in words whenever it is rendering mock data.
 */

import type { LaunchdPlan } from "@taste-inbox/shared";

const ROOT = "/Users/you/taste-inbox";

const plist = (label: string): string => `${ROOT}/var/launchd/${label}.plist`;

export const MOCK_LAUNCHD_PLAN: LaunchdPlan = {
  jobs: [
    {
      label: "dev.tasteinbox.instagram-saved-ai",
      collectorId: "instagram_saved_ai",
      runsAt: "4시간마다",
      path: "var/launchd/dev.tasteinbox.instagram-saved-ai.plist",
    },
    {
      label: "dev.tasteinbox.instagram-saved-music",
      collectorId: "instagram_saved_music",
      runsAt: "4시간마다 (+3분)",
      path: "var/launchd/dev.tasteinbox.instagram-saved-music.plist",
    },
    {
      label: "dev.tasteinbox.instagram-saved-fashion",
      collectorId: "instagram_saved_fashion",
      runsAt: "4시간마다 (+6분)",
      path: "var/launchd/dev.tasteinbox.instagram-saved-fashion.plist",
    },
    {
      label: "dev.tasteinbox.github-stars",
      collectorId: "github_stars",
      runsAt: "4시간마다 (+9분)",
      path: "var/launchd/dev.tasteinbox.github-stars.plist",
    },
    {
      label: "dev.tasteinbox.threads-reposts",
      collectorId: "threads_reposts",
      runsAt: "4시간마다 (+12분)",
      path: "var/launchd/dev.tasteinbox.threads-reposts.plist",
    },
    {
      label: "dev.tasteinbox.linkedin-reactions",
      collectorId: "linkedin_reactions",
      runsAt: "4시간마다 (+15분)",
      path: "var/launchd/dev.tasteinbox.linkedin-reactions.plist",
    },
  ],
  installed: false,
  commands: [
    "# 설치 — 각 줄을 확인한 뒤 실행하세요.",
    "# 소스 간격은 sleep으로 만듭니다. 전부 넣는 데 약 15분이 걸립니다.",
    `launchctl bootstrap gui/$(id -u) ${plist("dev.tasteinbox.instagram-saved-ai")}`,
    "sleep 180  # instagram_saved_music → +3분",
    `launchctl bootstrap gui/$(id -u) ${plist("dev.tasteinbox.instagram-saved-music")}`,
    "sleep 180  # instagram_saved_fashion → +6분",
    `launchctl bootstrap gui/$(id -u) ${plist("dev.tasteinbox.instagram-saved-fashion")}`,
    "sleep 180  # github_stars → +9분",
    `launchctl bootstrap gui/$(id -u) ${plist("dev.tasteinbox.github-stars")}`,
    "sleep 180  # threads_reposts → +12분",
    `launchctl bootstrap gui/$(id -u) ${plist("dev.tasteinbox.threads-reposts")}`,
    "sleep 180  # linkedin_reactions → +15분",
    `launchctl bootstrap gui/$(id -u) ${plist("dev.tasteinbox.linkedin-reactions")}`,
    // The blank separator the service really sends. Kept because dropping it is how a
    // consumer loses the boundary between the two blocks.
    "",
    "# 해제",
    "launchctl bootout gui/$(id -u)/dev.tasteinbox.instagram-saved-ai",
    "launchctl bootout gui/$(id -u)/dev.tasteinbox.instagram-saved-music",
    "launchctl bootout gui/$(id -u)/dev.tasteinbox.instagram-saved-fashion",
    "launchctl bootout gui/$(id -u)/dev.tasteinbox.github-stars",
    "launchctl bootout gui/$(id -u)/dev.tasteinbox.threads-reposts",
    "launchctl bootout gui/$(id -u)/dev.tasteinbox.linkedin-reactions",
  ],
};
