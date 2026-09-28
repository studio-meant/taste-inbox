import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installExternalLinkHandler } from "../../desktop/src/external-links";
import { SourceBadge } from "@/components/collection/SourceBadge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktop source links", () => {
  it.each([
    ["github", "star", "https://github.com/sample-org/project"],
    ["huggingface", "like", "https://huggingface.co/sample-org/model"],
    ["huggingface", "upvote", "https://huggingface.co/papers/2599.00001"],
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
