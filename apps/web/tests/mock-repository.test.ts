import {
  AIItemCardModelSchema,
  EffectiveResourcePolicySchema,
  HostProfileSchema,
  ItemDetailModelSchema,
  JobModelSchema,
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

describe("Inbox items", () => {
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
    expect(items.some((item) => item.summary === "")).toBe(true);
    // Every kind and every signal the collectors produce.
    expect(new Set(items.map((item) => item.kind))).toEqual(
      new Set(["repo", "model", "dataset", "space", "paper"]),
    );
    expect(new Set(items.map((item) => item.source.actionType))).toEqual(
      new Set(["star", "like", "upvote"]),
    );
  });

  it("paginates with a cursor", async () => {
    const first = await repository.listAIItems({ limit: 4 });
    expect(first.items).toHaveLength(4);
    expect(first.nextCursor).toBe("4");

    const second = await repository.listAIItems({ limit: 4, cursor: first.nextCursor });
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it("filters on the local calendar day, not on the UTC date", async () => {
    /*
     * The seed runs 2026-08-07T22:10Z → 2026-08-08T06:33Z, which is one Seoul day and two
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
    expect(item?.title).toBe("sample-org/garden-lens");
  });

  it("counts what it lists", async () => {
    const { items } = await repository.listAIItems({ limit: 200 });
    expect(await repository.getItemCount()).toBe(items.length);
  });
});

describe("item detail", () => {
  it("answers for every card, and carries nothing from the Instagram era", async () => {
    const { items } = await repository.listAIItems({ limit: 200 });
    for (const card of items) {
      const detail = await repository.getItem(card.id);
      expect(() => ItemDetailModelSchema.parse(detail)).not.toThrow();
      expect(detail).not.toHaveProperty("board");
      expect(detail).not.toHaveProperty("photos");
    }
  });
});

describe("manual items", () => {
  it.each([
    ["https://github.com/someone/tool", "github", "repo"],
    ["https://huggingface.co/datasets/someone/set", "huggingface", "dataset"],
    ["https://huggingface.co/spaces/someone/demo", "huggingface", "space"],
    ["https://huggingface.co/someone/model", "huggingface", "model"],
    ["https://arxiv.org/abs/2599.00001", "arxiv", "paper"],
    ["https://example.com/post", "web", "post"],
  ])("reads %s as a %s %s, as the service does", async (url, platform, kind) => {
    const { item } = await new MockRepository().createManualItem({ url });
    expect([item.source.platform, item.kind]).toEqual([platform, kind]);
  });
});

describe("jobs", () => {
  it("returns validated jobs including one that stopped part-way", async () => {
    const jobs = await repository.listJobs();
    for (const job of jobs) {
      expect(() => JobModelSchema.parse(job)).not.toThrow();
    }

    const partial = jobs.find((job) => job.state === "partially_succeeded");
    expect(partial).toBeDefined();
    // A collector that stopped says why; it never retries automatically.
    expect(partial?.steps.some((step) => step.state === "failed")).toBe(true);
    expect(partial?.cancellable).toBe(false);
  });
});

describe("seed content safety", () => {
  it("names no real account, repository or paper", async () => {
    // `sample-org` is nobody's account, and `2599` is a month no arXiv id can have.
    const { items } = await repository.listAIItems({ limit: 200 });
    for (const item of items) {
      const url = new URL(item.source.originalUrl);
      expect(url.protocol).toBe("https:");
      expect(url.pathname).toMatch(/sample-org|2599\.00001/);
    }
  });
});
