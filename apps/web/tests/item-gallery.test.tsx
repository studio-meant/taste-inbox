import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ItemGallery } from "@/components/items/ItemGallery";
import { instagramEmbedUrl } from "@/lib/instagram/embed";

const PHOTOS = [
  {
    id: "first",
    type: "image" as const,
    src: "/first.jpg",
    alt: "첫 번째 사진",
  },
  {
    id: "second",
    type: "image" as const,
    src: "/second.jpg",
    alt: "두 번째 사진",
  },
  {
    id: "third",
    type: "video_frame" as const,
    src: "/third.jpg",
    alt: "세 번째 사진",
  },
] as const;

describe("ItemGallery", () => {
  it("only builds official embeds from an exact Instagram post permalink", () => {
    expect(instagramEmbedUrl("https://www.instagram.com/reel/Abc_123/?utm_source=share")).toBe(
      "https://www.instagram.com/reel/Abc_123/embed/",
    );
    expect(instagramEmbedUrl("https://instagram.com/p/Post_456/")).toBe(
      "https://www.instagram.com/p/Post_456/embed/",
    );
    expect(instagramEmbedUrl("https://www.instagram.com/example/")).toBeNull();
    expect(instagramEmbedUrl("https://www.instagram.com.evil.test/reel/Abc_123/")).toBeNull();
    expect(instagramEmbedUrl("javascript:alert(1)")).toBeNull();
  });

  it("moves through every collected photo without leaving the detail page", () => {
    render(
      <ItemGallery
        photos={PHOTOS}
        title="저장한 옷"
        originalUrl="https://www.instagram.com/reel/example/"
      />,
    );

    expect(screen.getByRole("img", { name: "첫 번째 사진" })).toHaveAttribute("src", "/first.jpg");
    expect(screen.getByText("1 / 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다음 사진" }));
    expect(screen.getByRole("img", { name: "두 번째 사진" })).toHaveAttribute("src", "/second.jpg");
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "1번째 사진 보기" }));
    expect(screen.getByRole("img", { name: "첫 번째 사진" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1번째 사진 보기" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("link", { name: /원본에서 영상 재생/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "3번째 사진 보기" }));
    expect(screen.getByRole("button", { name: "앱에서 영상 재생" })).toBeInTheDocument();
    expect(screen.getByText(/미디어는 따로 저장하지 않아요/)).toBeInTheDocument();
    expect(screen.queryByTitle("저장한 옷 Instagram 게시물")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "앱에서 영상 재생" }));
    expect(screen.getByTitle("저장한 옷 Instagram 게시물")).toHaveAttribute(
      "src",
      "https://www.instagram.com/reel/example/embed/",
    );
    expect(screen.getByRole("link", { name: /Instagram에서 열기/ })).toHaveAttribute(
      "href",
      "https://www.instagram.com/reel/example/",
    );

    fireEvent.click(screen.getByRole("button", { name: "Instagram 게시물 닫기" }));
    expect(screen.queryByTitle("저장한 옷 Instagram 게시물")).not.toBeInTheDocument();
  });

  it("offers the official post view for a manually added Instagram link with no media", () => {
    render(
      <ItemGallery
        photos={[]}
        title="직접 추가한 게시물"
        originalUrl="https://www.instagram.com/p/Manual_123/"
      />,
    );

    expect(screen.getByRole("button", { name: "Instagram 게시물 보기" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByTitle("직접 추가한 게시물 Instagram 게시물")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Instagram 게시물 보기" }));
    expect(screen.getByTitle("직접 추가한 게시물 Instagram 게시물")).toHaveAttribute(
      "src",
      "https://www.instagram.com/p/Manual_123/embed/",
    );
  });

  it("keeps a single photograph free of unnecessary carousel controls", () => {
    render(
      <ItemGallery
        photos={PHOTOS.slice(0, 1)}
        title="저장한 옷"
        originalUrl="https://www.instagram.com/p/example/"
      />,
    );

    expect(screen.getByRole("img", { name: "첫 번째 사진" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다음 사진" })).not.toBeInTheDocument();
    expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
  });

  it("keeps an unsupported video source as an external link instead of embedding it", () => {
    render(
      <ItemGallery
        photos={PHOTOS.slice(2)}
        title="외부 영상"
        originalUrl="https://example.com/video/example"
      />,
    );

    expect(screen.queryByRole("button", { name: "앱에서 영상 재생" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /원본에서 영상 재생/ })).toHaveAttribute(
      "href",
      "https://example.com/video/example",
    );
  });
});
