import type { SourceRef } from "@taste-inbox/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowseCard, collectionStatus } from "@/components/collection/BrowseCard";
import { SourceBadge } from "@/components/collection/SourceBadge";

const SOURCES: readonly (Pick<SourceRef, "platform" | "actionType" | "originalUrl"> & {
  text: string;
})[] = [
  {
    platform: "instagram",
    actionType: "like",
    originalUrl: "https://www.instagram.com/p/example-like/",
    text: "Instagram 좋아요",
  },
  {
    platform: "instagram",
    actionType: "save",
    originalUrl: "https://www.instagram.com/p/example-save/",
    text: "Instagram 저장",
  },
  {
    platform: "threads",
    actionType: "repost",
    originalUrl: "https://www.threads.com/@example/post/example",
    text: "Threads 리포스트",
  },
  {
    platform: "github",
    actionType: "star",
    originalUrl: "https://github.com/example/repository",
    text: "GitHub 스타",
  },
];

describe("source links", () => {
  for (const { text, ...source } of SOURCES) {
    it(`${text} uses the shared pill and the original post, not the item detail`, () => {
      render(
        <SourceBadge
          source={{ ...source, label: text, author: null, firstSeenAt: "2026-08-08T00:00:00Z" }}
        />,
      );
      const link = screen.getByRole("link", { name: new RegExp(text) });
      expect(link).toHaveAttribute("href", source.originalUrl);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer noopener");
      expect(link.className).toContain("badge");
    });
  }

  it.each(["small", "tall"] as const)("removes the separate detail hint on a %s card", (size) => {
    const source = SOURCES[0]!;
    render(
      <BrowseCard
        id="example"
        size={size}
        index={0}
        eyebrow="게시물"
        title="항목 제목"
        source={{
          ...source,
          label: source.text,
          author: null,
          firstSeenAt: "2026-08-08T00:00:00Z",
        }}
        openLabel="원본 보기"
        status={collectionStatus(null)}
        media={<div>사진</div>}
      />,
    );
    expect(screen.queryByText("자세히 보기")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "항목 제목" })).toHaveAttribute(
      "href",
      "/items/example",
    );
    const link = screen.getByRole("link", { name: /Instagram 좋아요/ });
    expect(link).toHaveAttribute("href", source.originalUrl);
    expect(link.className).toContain(size === "small" ? "badgeInline" : "badgeFloating");
  });
});
