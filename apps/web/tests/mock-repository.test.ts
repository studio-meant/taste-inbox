import {
  AIItemCardModelSchema,
  EffectiveResourcePolicySchema,
  HostProfileSchema,
  JobModelSchema,
  StyleItemCardModelSchema,
} from "@taste-inbox/shared";
import { afterEach, describe, expect, it } from "vitest";
import { MockRepository } from "@/lib/mock/repository";
import {
  HttpRepository,
  getRepository,
  resetRepository,
  resolveDataSource,
} from "@/lib/repository";

const repository = new MockRepository();

afterEach(() => {
  resetRepository();
  delete process.env.NEXT_PUBLIC_DATA_SOURCE;
});

describe("data source selection", () => {
  it("defaults to mock", () => {
    expect(resolveDataSource(undefined)).toBe("mock");
    expect(resolveDataSource("")).toBe("mock");
    expect(resolveDataSource("anything-else")).toBe("mock");
  });

  it("returns a repository with no environment set", () => {
    // Phase 0 exit criterion: mock mode requires no secrets at all.
    expect(getRepository()).toBeInstanceOf(MockRepository);
  });

  it("hands live mode to the local service", () => {
    // The swap is one file by design: components go through `getRepository()` and never
    // touch an implementation, which `repository-boundary.test.ts` enforces.
    process.env.NEXT_PUBLIC_DATA_SOURCE = "live";
    expect(getRepository()).toBeInstanceOf(HttpRepository);
  });
});

describe("host profile and resource policy", () => {
  it("returns a validated profile", async () => {
    const profile = await repository.getHostProfile();
    expect(() => HostProfileSchema.parse(profile)).not.toThrow();
    expect(profile.architecture).toBe("arm64");
  });

  it("never exposes the backend-internal available-memory signal", async () => {
    const profile = await repository.getHostProfile();
    expect(profile).not.toHaveProperty("availableMemoryGb");
  });

  it("returns a policy consistent with the profile", async () => {
    const [profile, policy] = await Promise.all([
      repository.getHostProfile(),
      repository.getResourcePolicy(),
    ]);

    expect(() => EffectiveResourcePolicySchema.parse(policy)).not.toThrow();
    expect(policy.hostProfileId).toBe(profile.id);
    expect(policy.memory.unifiedMemoryGb).toBe(profile.unifiedMemoryGb);
    expect(policy.memory.autoPrepareLimitGb).toBeLessThanOrEqual(policy.memory.usableMemoryGb);
  });
});

describe("AI items", () => {
  it("returns validated cards", async () => {
    const page = await repository.listAIItems();
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(() => AIItemCardModelSchema.parse(item)).not.toThrow();
    }
  });

  it("covers the documented fixture cases", async () => {
    const { items } = await repository.listAIItems();
    // Architecture §29 "Data fixtures".
    expect(items.some((item) => item.title.length > 60)).toBe(true);
    expect(items.some((item) => item.checkedAt === null)).toBe(true);
    expect(items.every((item) => item.preview === null || item.preview.alt.length > 0)).toBe(true);
  });

  it("paginates with a cursor", async () => {
    const first = await repository.listAIItems({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe("2");

    const second = await repository.listAIItems({ limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it("filters on the local calendar day, not on the UTC date", async () => {
    /*
     * The seed runs 2026-08-07T21:05Z → 2026-08-08T06:40Z, which is one Seoul day and two
     * UTC dates. A mock that split on the UTC prefix would answer `?day=2026-08-08` with
     * part of the board and hand `2026-08-07` the rest — while the rail's calendar, which
     * converts, offered only the 8th. The two have to be the same rule.
     */
    const whole = await repository.listAIItems({ limit: 200 });
    const seoulDay = await repository.listAIItems({ limit: 200, day: "2026-08-08" });
    const utcDay = await repository.listAIItems({ limit: 200, day: "2026-08-07" });

    expect(seoulDay.items).toHaveLength(whole.items.length);
    expect(utcDay.items).toEqual([]);
  });

  it("composes the day with the filters already on the board", async () => {
    const both = await repository.listAIItems({ limit: 200, kind: ["repo"], day: "2026-08-08" });
    const kindOnly = await repository.listAIItems({ limit: 200, kind: ["repo"] });
    expect(both.items).toEqual(kindOnly.items);
    expect(both.items.every((item) => item.kind === "repo")).toBe(true);

    // And a day nothing landed on narrows to nothing rather than being ignored.
    const none = await repository.listAIItems({ limit: 200, kind: ["repo"], day: "2026-08-09" });
    expect(none.items).toEqual([]);
  });

  it("returns null for an unknown id", async () => {
    expect(await repository.getAIItem("does-not-exist")).toBeNull();
  });

  it("finds an item by id", async () => {
    const item = await repository.getAIItem("garden-lens");
    expect(item?.title).toBe("Garden Lens");
  });
});

describe("style items", () => {
  it("returns validated cards", async () => {
    const page = await repository.listStyleItems();
    for (const item of page.items) {
      expect(() => StyleItemCardModelSchema.parse(item)).not.toThrow();
    }
  });

  it("covers one photo, a carousel, and none at all", async () => {
    // The three shapes the card has to render. A carousel is the case the collector only
    // started keeping on 2026-08-09; before that every post stored its cover and nothing
    // else, so a fixture without one would not exercise the gallery.
    const { items } = await repository.listStyleItems();
    const counts = items.map((item) => item.media.length);
    expect(counts).toContain(0);
    expect(counts).toContain(1);
    expect(counts.some((count) => count > 1)).toBe(true);
  });

  it("carries the caption, hashtags and all", async () => {
    // Not a slice. The card clamps past 180 characters behind a disclosure, which only
    // works if the whole thing arrives.
    const { items } = await repository.listStyleItems();
    expect(items.some((item) => item.caption.includes("#"))).toBe(true);
    expect(items.every((item) => typeof item.caption === "string")).toBe(true);
  });

  it("gives every image a descriptive alt", async () => {
    // Architecture §23 — Style images describe the product or outfit.
    const { items } = await repository.listStyleItems();
    for (const item of items) {
      for (const media of item.media) {
        expect(media.alt.length).toBeGreaterThan(5);
      }
    }
  });

  it("filters by where the item came from", async () => {
    // The board's only axis. `match` and `stock` filtered a resolved product and went
    // with the resolver (docs/DECISIONS.md, 2026-08-09).
    const page = await repository.listStyleItems({ source: ["instagram"] });
    expect(page.items.every((item) => item.source.platform === "instagram")).toBe(true);
  });
});

describe("jobs", () => {
  it("returns validated jobs including a blocked one", async () => {
    const jobs = await repository.listJobs();
    for (const job of jobs) {
      expect(() => JobModelSchema.parse(job)).not.toThrow();
    }

    const blocked = jobs.find((job) => job.state === "blocked");
    expect(blocked).toBeDefined();
    // A challenge stops the collector; it never retries automatically.
    expect(blocked?.steps.some((step) => step.message === "auth_required")).toBe(true);
    expect(blocked?.cancellable).toBe(false);
  });
});

describe("seed content safety", () => {
  it("uses only example hosts in source URLs", async () => {
    const [ai, style] = await Promise.all([repository.listAIItems(), repository.listStyleItems()]);

    for (const item of [...ai.items, ...style.items]) {
      const url = new URL(item.source.originalUrl);
      expect(url.protocol).toBe("https:");
      expect(url.pathname + url.hostname).toMatch(/example/);
    }
  });
});
