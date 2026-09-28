import { describe, expect, it } from "vitest";
import { externalDestination } from "../src/external-links";
import { toHref } from "../src/shims/href";

describe("desktop hrefs", () => {
  it("preserves Next's serialized source and day filters", () => {
    expect(toHref({ pathname: "/library", query: "source=github" })).toBe("/library?source=github");
    expect(toHref({ pathname: "/library", query: "day=2026-09-01" })).toBe(
      "/library?day=2026-09-01",
    );
  });

  it("still serializes query objects and repeated values", () => {
    expect(
      toHref({ pathname: "/library", query: { source: ["github", "huggingface"], page: 2 } }),
    ).toBe("/library?source=github&source=huggingface&page=2");
  });
});

describe("desktop external destinations", () => {
  const base = "http://127.0.0.1:1420/library";

  it("sends web and email destinations to macOS", () => {
    expect(externalDestination("https://music.youtube.com/search?q=test", base)).toBe(
      "https://music.youtube.com/search?q=test",
    );
    expect(externalDestination("mailto:hello@example.com", base)).toBe("mailto:hello@example.com");
  });

  it("keeps app routes in the app and rejects unsafe schemes", () => {
    expect(externalDestination("/library?day=2026-09-01", base)).toBeNull();
    expect(externalDestination("javascript:alert(1)", base)).toBeNull();
    expect(externalDestination("file:///tmp/private.txt", base)).toBeNull();
  });
});
