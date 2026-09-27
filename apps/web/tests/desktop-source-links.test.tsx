import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installExternalLinkHandler } from "../../desktop/src/external-links";
import { SourceBadge } from "@/components/collection/SourceBadge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktop source links", () => {
  it.each([
    ["instagram", "like", "https://www.instagram.com/p/example/"],
    ["instagram", "save", "https://www.instagram.com/p/example-saved/"],
    ["threads", "repost", "https://www.threads.com/@example/post/example"],
    ["github", "star", "https://github.com/example/project"],
  ] as const)(
    "hands %s %s to macOS exactly once, including clicks on the icon",
    (platform, actionType, originalUrl) => {
      const invoke = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("__TAURI__", { core: { invoke } });
      const removeHandler = installExternalLinkHandler();
      try {
        render(
          <SourceBadge
            source={{
              platform,
              actionType,
              originalUrl,
              label: "source",
              author: null,
              firstSeenAt: "2026-08-08T00:00:00Z",
            }}
          />,
        );
        const link = screen.getByRole("link");
        const icon = link.querySelector("svg");
        expect(icon).not.toBeNull();
        const accepted = fireEvent.click(icon ?? link);
        expect(accepted).toBe(false);
        expect(invoke).toHaveBeenCalledExactlyOnceWith("open_external", { url: originalUrl });
      } finally {
        removeHandler();
      }
    },
  );
});
