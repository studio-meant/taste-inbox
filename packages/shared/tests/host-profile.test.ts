import { describe, expect, it } from "vitest";
import {
  DetectedHostProfileSchema,
  HostProfileSchema,
  toHostProfileDto,
} from "../src/host/host-profile";
import { readJsonFixtures } from "./fixture-paths";

const fixtures = readJsonFixtures("host-profiles");

describe("host profile fixtures", () => {
  it("finds every host-profile fixture", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures.map((f) => f.name)).toEqual([
      "capacity-16gb-512gb.json",
      "capacity-48gb-1tb.json",
      "capacity-8gb-256gb.json",
      "low-free-storage.json",
      "memory-pressure-critical.json",
      "memory-pressure-warning.json",
      "unknown-pressure.json",
    ]);
  });

  it.each(fixtures)("$name validates as a detected host profile", ({ value }) => {
    expect(() => DetectedHostProfileSchema.parse(value)).not.toThrow();
  });

  it.each(fixtures)("$name narrows to the documented public DTO", ({ value }) => {
    const detected = DetectedHostProfileSchema.parse(value);
    const dto = toHostProfileDto(detected);

    // The frontend contract in docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11 has
    // exactly these fields. availableMemoryGb must not leak out of the backend.
    expect(Object.keys(dto).sort()).toEqual([
      "architecture",
      "chip",
      "detectedAt",
      "deviceModel",
      "freeStorageGb",
      "id",
      "memoryPressure",
      "totalStorageGb",
      "unifiedMemoryGb",
    ]);
    expect(dto).not.toHaveProperty("availableMemoryGb");
  });

  it("covers the scenarios required by CLAUDE.md §9", () => {
    const parsed = fixtures.map((f) => DetectedHostProfileSchema.parse(f.value));

    expect(parsed.some((p) => p.unifiedMemoryGb === 16 && p.totalStorageGb === 512)).toBe(true);
    expect(parsed.some((p) => p.unifiedMemoryGb === 48 && p.totalStorageGb === 1000)).toBe(true);
    // Low-disk state: free storage below the 40GB floor + 10% proportional reserve.
    expect(parsed.some((p) => p.freeStorageGb < Math.max(40, p.totalStorageGb * 0.1))).toBe(true);
    expect(parsed.some((p) => p.memoryPressure === "warning")).toBe(true);
    expect(parsed.some((p) => p.memoryPressure === "critical")).toBe(true);
  });

  it("keeps fixtures free of concrete device identity", () => {
    const raw = JSON.stringify(fixtures);
    // Fixtures describe a capacity class. A real model name here would let a fixed
    // hardware assumption re-enter the codebase through test data.
    expect(raw).not.toMatch(/Mac ?(mini|Studio|Book|Pro)/i);
    expect(raw).not.toMatch(/\bM[1-9]\b/);
    expect(raw).not.toMatch(/serial/i);
  });
});

describe("host profile schema", () => {
  it("rejects a non-arm64 architecture", () => {
    const base = DetectedHostProfileSchema.parse(fixtures[0]?.value);
    expect(() => HostProfileSchema.parse({ ...base, architecture: "x86_64" })).toThrow();
  });

  it("rejects a negative memory value", () => {
    const base = DetectedHostProfileSchema.parse(fixtures[0]?.value);
    expect(() => HostProfileSchema.parse({ ...base, unifiedMemoryGb: -1 })).toThrow();
  });

  it("rejects an unparsable detectedAt", () => {
    const base = DetectedHostProfileSchema.parse(fixtures[0]?.value);
    expect(() => HostProfileSchema.parse({ ...base, detectedAt: "not-a-date" })).toThrow();
  });
});
