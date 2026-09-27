import { describe, expect, it } from "vitest";
import {
  EffectiveResourcePolicySchema,
  type EffectiveResourcePolicy,
} from "../src/host/resource-policy";
import { readJsonFixtures } from "./fixture-paths";

/**
 * The other half of the cross-language contract.
 *
 * `apps/api` asserts its resolver reproduces these files exactly. Here we assert the
 * same files satisfy the TypeScript contract the UI renders against. A resolver change
 * that forgets one side fails the other.
 */
const goldens = readJsonFixtures("resource-policy", "expected");

describe("resolved resource policy goldens", () => {
  it("covers every host-profile fixture", () => {
    const hostProfiles = readJsonFixtures("host-profiles").map((f) => f.name);
    expect(goldens.map((g) => g.name)).toEqual(hostProfiles);
  });

  it.each(goldens)("$name satisfies the frontend contract", ({ value }) => {
    expect(() => EffectiveResourcePolicySchema.parse(value)).not.toThrow();
  });

  it.each(goldens)("$name holds the safety invariants", ({ value }) => {
    const policy: EffectiveResourcePolicy = EffectiveResourcePolicySchema.parse(value);

    expect(policy.memory.autoPrepareLimitGb).toBeLessThanOrEqual(policy.memory.manualReviewLimitGb);
    expect(policy.memory.manualReviewLimitGb).toBeLessThanOrEqual(policy.memory.usableMemoryGb);
    expect(policy.memory.usableMemoryGb).toBeLessThanOrEqual(policy.memory.unifiedMemoryGb);

    const shares = policy.storage.cacheShares;
    expect(shares.modelGb + shares.containerGb + shares.mediaGb).toBeLessThanOrEqual(
      policy.storage.cacheBudgetGb,
    );

    // Sequential browser collection is an account-stability decision, not a
    // resource decision — a larger host must never widen it (CLAUDE.md §7).
    expect(policy.concurrency.browserCollectors).toBe(1);

    if (policy.gates.stopRunningHeavyJobs) {
      expect(policy.gates.acceptNewHeavyJobs).toBe(false);
    }
    if (!policy.gates.acceptNewHeavyJobs) {
      // Never block work without telling the user why (DESIGN.md §3.5).
      expect(policy.gates.reason).not.toBeNull();
    }
  });

  it("shows live pressure changing limits on identical hardware", () => {
    const byName = new Map(
      goldens.map((g) => [g.name, EffectiveResourcePolicySchema.parse(g.value)]),
    );
    const calm = byName.get("capacity-48gb-1tb.json");
    const strained = byName.get("memory-pressure-warning.json");

    expect(calm).toBeDefined();
    expect(strained).toBeDefined();
    expect(strained!.memory.usableMemoryGb).toBe(calm!.memory.usableMemoryGb);
    expect(strained!.memory.autoPrepareLimitGb).toBeLessThan(calm!.memory.autoPrepareLimitGb);
    expect(strained!.concurrency.environmentBuilds).toBeLessThan(
      calm!.concurrency.environmentBuilds,
    );
  });

  it("keeps goldens free of device identity", () => {
    const raw = JSON.stringify(goldens);
    expect(raw).not.toMatch(/Mac ?(mini|Studio|Book|Pro)/i);
    expect(raw).not.toMatch(/\bM[1-9]\b/);
  });
});
