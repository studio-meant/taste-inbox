import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FocusPayloadSchema } from "../src/domain/taste";
import { QueueItemSchema, TodayPayloadSchema } from "../src/domain/today";
import { readJsonFixtures } from "./fixture-paths";

/**
 * The other half of the Focus / Working Queue contract.
 *
 * `apps/api/tests/test_focus_contract.py` writes these files from the real endpoints and
 * asserts it still produces them. Here the same files must satisfy the schemas the web app
 * validates every response against — so a renamed field fails one side or the other, never
 * neither.
 */
const goldens = readJsonFixtures("focus");
const focusGoldens = goldens.filter(({ name }) => !name.startsWith("today-"));
const todayGoldens = goldens.filter(({ name }) => name.startsWith("today-"));

const TodayQueuePartSchema = z.object({
  counts: TodayPayloadSchema.shape.counts,
  workingQueue: z.array(QueueItemSchema),
});

describe("focus payload goldens", () => {
  it("exist for every state the canvas draws", () => {
    expect(focusGoldens.map(({ name }) => name)).toEqual([
      "paper-bundle.json",
      "repo-awaiting-approval.json",
      "repo-sandbox-down.json",
      "repo-trial-timed-out.json",
      "repo-unresearched.json",
    ]);
  });

  it.each(focusGoldens)("$name satisfies FocusPayloadSchema", ({ value }) => {
    expect(() => FocusPayloadSchema.parse(value)).not.toThrow();
  });

  it("keeps an unresearched item empty rather than filled", () => {
    const payload = FocusPayloadSchema.parse(
      focusGoldens.find(({ name }) => name === "repo-unresearched.json")?.value,
    );
    expect(payload.research).toBeNull();
    expect(payload.suggestion).toBeNull();
    expect(payload.trial).toBeNull();
    expect(payload.jobs).toEqual({ research: null, trial: null });
  });

  it("states why the boundary is down", () => {
    const payload = FocusPayloadSchema.parse(
      focusGoldens.find(({ name }) => name === "repo-sandbox-down.json")?.value,
    );
    expect(payload.boundary.ready).toBe(false);
    expect(payload.boundary.reason).toMatch(/^docker_unreachable/);
  });

  it("does not call a timed-out trial a success", () => {
    const payload = FocusPayloadSchema.parse(
      focusGoldens.find(({ name }) => name === "repo-trial-timed-out.json")?.value,
    );
    expect(payload.jobs.trial?.state).toBe("partially_succeeded");
    // Two refusals read from OpenShell's log, one from the agent's own stream.
    expect(payload.trial?.blocked).toEqual(["releases.astral.sh", "github.com", "voicestudio.sh"]);
    expect(payload.trial?.denials.find((row) => row.host === "github.com")).toEqual({
      host: "github.com",
      binary: "/sandbox/.local/bin/uv",
      count: 4,
      reason: "binary '/sandbox/.local/bin/uv' not allowed in policy 'brew'",
    });
  });
});

describe("working queue goldens", () => {
  it.each(todayGoldens)("$name satisfies the Today queue schema", ({ value }) => {
    expect(() => TodayQueuePartSchema.parse(value)).not.toThrow();
  });
});
