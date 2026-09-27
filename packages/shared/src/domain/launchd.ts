import { z } from "zod";

/**
 * `GET /api/collection/launchd` — the schedule jobs this product writes and never installs.
 *
 * The endpoint generates one plist per collector and hands back the `launchctl` lines a
 * person runs to load them. Nothing in this repository executes `launchctl`
 * (`docs/DECISIONS.md` 2026-08-08 "launchd jobs are generated, never installed", CLAUDE.md
 * §10): loading a job that opens four logged-in accounts on a timer is account access, and
 * account access stays behind a person typing the command having read it.
 *
 * Two shapes here are easy to get wrong, so they are written down rather than inferred:
 *
 * 1. **`commands` is a flat list of mixed lines**, and one of them is the empty string.
 *    `api/launchd.py:197` appends `""` as the blank line between the install block and the
 *    `# 해제` block. The prevailing `z.string().min(1)` in this package would therefore
 *    reject the real payload — and a consumer that filters falsy values loses the only
 *    separator the two blocks have. The lines are comments, `sleep`, `launchctl bootstrap`
 *    and `launchctl bootout`, distinguished by nothing but their leading characters.
 * 2. **`jobs[].path` is repo-relative while the path inside `commands` is absolute.**
 *    `api/app.py:314` sends `relative_to(REPO_ROOT)`; `install_commands` embeds `job.path`
 *    whole. Only the absolute one works when pasted, so a screen that renders both shows
 *    two different strings for one file.
 */

export const LaunchdJobSchema = z.object({
  /** The launchd label, e.g. `dev.tasteinbox.github-stars`. What `bootout` names. */
  label: z.string().min(1),
  collectorId: z.string().min(1),
  /**
   * The cadence in words — `"4시간마다"`, `"4시간마다 (+3분)"` — not a timestamp.
   *
   * `StartInterval` counts from when a job is *loaded*, so these jobs have no clock time to
   * name; `api/launchd.py:_cadence` says so in Korean instead. Never pass this to a date
   * formatter.
   */
  runsAt: z.string().min(1),
  /** Repo-relative. See the note above before rendering it beside a command. */
  path: z.string().min(1),
});

export const LaunchdPlanSchema = z.object({
  jobs: z.array(LaunchdJobSchema),
  /**
   * Whether *this request* installed anything. Always `false`, and validated rather than
   * displayed.
   *
   * It is a truthful statement about the endpoint and an unverified one about the machine:
   * nothing here asks launchd what is loaded, so the moment a person runs the printed
   * commands the field is stale and nothing notices. A screen that printed "설치 안 됨"
   * from it would be stating a fact it has not checked, which is worse than saying nothing.
   * `z.boolean()` rather than `z.literal(false)` so the day it becomes an answer about the
   * machine, the contract bends instead of breaking.
   */
  installed: z.boolean(),
  /** Verbatim shell lines. Includes one empty string; see the note above. */
  commands: z.array(z.string()),
});

export type LaunchdJob = z.infer<typeof LaunchdJobSchema>;
export type LaunchdPlan = z.infer<typeof LaunchdPlanSchema>;
