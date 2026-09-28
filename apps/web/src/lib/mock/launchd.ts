/**
 * A transcript of `GET /api/collection/launchd`, not a second implementation of it.
 *
 * The lines below were copied from a live response on a checkout with no `config/app.yaml`,
 * so they carry the shipped `config/app.example.yaml` numbers: `interval_hours: 4`,
 * `stagger_minutes: 3`, the three collectors in `SOURCE_ORDER`. Nothing here derives them —
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

const ROOT = "/Users/you/taste-inbox-rnd";

const plist = (label: string): string => `${ROOT}/var/launchd/${label}.plist`;

export const MOCK_LAUNCHD_PLAN: LaunchdPlan = {
  jobs: [
    {
      label: "dev.tasteinbox.github-stars-api",
      collectorId: "github_stars_api",
      runsAt: "4시간마다",
      path: "var/launchd/dev.tasteinbox.github-stars-api.plist",
    },
    {
      label: "dev.tasteinbox.huggingface-activity",
      collectorId: "huggingface_activity",
      runsAt: "4시간마다 (+3분)",
      path: "var/launchd/dev.tasteinbox.huggingface-activity.plist",
    },
    {
      label: "dev.tasteinbox.huggingface-upvotes",
      collectorId: "huggingface_upvotes",
      runsAt: "4시간마다 (+6분)",
      path: "var/launchd/dev.tasteinbox.huggingface-upvotes.plist",
    },
  ],
  installed: false,
  commands: [
    "# 설치 — 각 줄을 확인한 뒤 실행하세요.",
    "# 소스 간격은 sleep으로 만듭니다. 전부 넣는 데 약 6분이 걸립니다.",
    "",
    "# 먼저 plist를 지금 저장된 설정으로 다시 씁니다. 화면을 여는 것만으로는",
    "# 파일이 바뀌지 않으니, 등록하는 이 순간에 한 번 씁니다.",
    `cd ${ROOT}/apps/api && uv run python -m taste_inbox.api.launchd`,
    "",
    `launchctl bootstrap gui/$(id -u) ${plist("dev.tasteinbox.github-stars-api")}`,
    "sleep 180  # huggingface_activity → +3분",
    `launchctl bootstrap gui/$(id -u) ${plist("dev.tasteinbox.huggingface-activity")}`,
    "sleep 180  # huggingface_upvotes → +6분",
    `launchctl bootstrap gui/$(id -u) ${plist("dev.tasteinbox.huggingface-upvotes")}`,
    // The blank separator the service really sends. Kept because dropping it is how a
    // consumer loses the boundary between the two blocks.
    "",
    "# 해제",
    "launchctl bootout gui/$(id -u)/dev.tasteinbox.github-stars-api",
    "launchctl bootout gui/$(id -u)/dev.tasteinbox.huggingface-activity",
    "launchctl bootout gui/$(id -u)/dev.tasteinbox.huggingface-upvotes",
  ],
};
