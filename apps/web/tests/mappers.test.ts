import {
  AIItemCardModelSchema,
  MusicItemCardModelSchema,
  StyleItemCardModelSchema,
  captionBodyOf,
  hashtagsOf,
  permalinkOf,
  type CollectedItem,
} from "@taste-inbox/shared";
import { describe, expect, it } from "vitest";
import { tagsOf, toAICard, toMusicCard, toStyleCard } from "@/lib/mock/mappers";

/**
 * The mappers turn observations into view models. The property that matters most is what
 * they *refuse* to invent: none of this data has been enriched, so nothing may render as
 * though it had been checked (DESIGN.md §3.5).
 */

function item(overrides: Partial<CollectedItem> = {}): CollectedItem {
  return {
    code: "DAaaaaaaaaa",
    media_type: "video",
    product_type: "clips",
    taken_at: 1757736341,
    owner: "someone",
    caption: "여름에 이렇게 입고 나갔다가\n\n두 번째 줄\n#여름코디 #데일리룩 #내돈내산 #ootd",
    accessibility_caption: null,
    audio_title: null,
    audio_artist: null,
    is_original_audio: true,
    product_tag_count: 0,
    user_tag_count: 0,
    source_endpoint: "/api/v1/feed/",
    thumbnail_url: "https://scontent.cdninstagram.com/v/t51/thumb.jpg",
    thumbnail_width: 640,
    thumbnail_height: 800,
    ...overrides,
  };
}

describe("collected item helpers", () => {
  it("builds a reel permalink for a clip and a post permalink otherwise", () => {
    expect(permalinkOf(item())).toBe("https://www.instagram.com/reel/DAaaaaaaaaa/");
    expect(permalinkOf(item({ product_type: "feed" }))).toBe(
      "https://www.instagram.com/p/DAaaaaaaaaa/",
    );
  });

  it("extracts hashtags without duplicates", () => {
    expect(hashtagsOf(item())).toEqual(["#여름코디", "#데일리룩", "#내돈내산", "#ootd"]);
  });

  it("strips the trailing hashtag block from the caption body", () => {
    // A Korean caption routinely ends in a wall of tags; showing them as body copy
    // buries the sentence that says what the post is.
    const body = captionBodyOf(item());
    expect(body).toContain("여름에 이렇게 입고 나갔다가");
    expect(body).not.toContain("#여름코디");
  });

  it("keeps inline hashtags that are part of a sentence", () => {
    const inline = item({ caption: "요즘 눈에 자꾸 들어오는 #미디스커트 🫧" });
    expect(captionBodyOf(inline)).toContain("#미디스커트");
  });
});

describe("toStyleCard", () => {
  it("produces a valid card", () => {
    expect(() => StyleItemCardModelSchema.parse(toStyleCard(item()))).not.toThrow();
  });

  it("carries no product field at all, not even a null one", () => {
    // The board does not resolve products. A null `brand` would still reserve a row on the
    // card and a filter axis in the URL, which is what the removal was for
    // (docs/DECISIONS.md, 2026-08-09).
    const card = toStyleCard(item()) as Record<string, unknown>;
    for (const field of [
      "brand",
      "productName",
      "matchGrade",
      "currentPrice",
      "observedPrice",
      "retailerCount",
      "stockState",
    ]) {
      expect(card).not.toHaveProperty(field);
    }
  });

  it("reports unchecked rather than claiming it looked", () => {
    // `checkedAt: null` is what stops the UI showing a "checked N ago" line.
    expect(toStyleCard(item()).checkedAt).toBeNull();
  });

  it("carries the caption whole, hashtags included", () => {
    // The caption is the card now. Trimming it here would be a cut nothing could undo —
    // the trailing tag block is also what the hashtag chips are read from.
    const card = toStyleCard(item());
    expect(card.caption).toBe(item().caption);
    expect(card.caption).toContain("#여름코디");
  });

  it("uses the caption's first line as the descriptor", () => {
    expect(toStyleCard(item()).descriptor).toBe("여름에 이렇게 입고 나갔다가");
  });

  it("falls back to a plain descriptor when the caption is only hashtags", () => {
    const card = toStyleCard(item({ caption: "#여름코디 #데일리룩 #ootd #내돈내산" }));
    expect(card.descriptor).toBe("저장한 패션 게시물");
  });

  it("carries the photo it has, with a real alt", () => {
    // One entry: the fixture format predates the collector reading past `carousel_media`,
    // so a re-collection is what fills this array — not a guess made here.
    const card = toStyleCard(item());
    expect(card.media).toHaveLength(1);
    expect(card.media[0]?.alt.length).toBeGreaterThan(5);
  });

  it("prefers Instagram's own alt text when present", () => {
    const card = toStyleCard(item({ accessibility_caption: "사진 설명: 흰 원피스" }));
    expect(card.media[0]?.alt).toBe("사진 설명: 흰 원피스");
  });

  it("renders no media rather than a broken one when the thumbnail is missing", () => {
    expect(toStyleCard(item({ thumbnail_url: null })).media).toEqual([]);
  });
});

describe("toAICard", () => {
  it("produces a valid card", () => {
    expect(() => AIItemCardModelSchema.parse(toAICard(item()))).not.toThrow();
  });

  it("reports unchecked rather than claiming it looked", () => {
    const card = toAICard(item());
    expect(card.checkedAt).toBeNull();
  });

  it("carries the caption whole", () => {
    // It used to be sliced at 400 characters here and again in the API. Shortening is the
    // card's job, because the card can undo it.
    const long = "가".repeat(900);
    const card = toAICard({ ...item(), caption: long });
    expect(card.summary.length).toBeGreaterThan(400);
  });

  it("calls an Instagram save a post, not a runnable artifact", () => {
    // `demo` would assert something runnable exists, which is what every compatibility
    // and resource affordance on the card is about.
    expect(toAICard(item()).kind).toBe("post");
  });

  it("labels the outbound link by where it goes, not by the status action", () => {
    // AI_STATUS.unknown.primaryAction is 확인하기 — a check this product cannot perform
    // on an Instagram post. The anchor must say what it does.
    const card = toAICard(item());
    expect(card.source.platform).toBe("instagram");
    expect(card.source.originalUrl).toContain("instagram.com");
  });
});

describe("toMusicCard", () => {
  it("produces a valid card", () => {
    expect(() => MusicItemCardModelSchema.parse(toMusicCard(item()))).not.toThrow();
  });

  it("attempts no song extraction from the caption", () => {
    // Measured at 12% parseable across the real collection; guessing the rest would put
    // wrong tracks in front of the user.
    const card = toMusicCard(item({ caption: "1. Artist - Song\n2. Other - Track" }));
    expect(card.candidates).toEqual([]);
    expect(card.caption).toContain("1. Artist - Song");
  });

  it("turns Instagram's audio attribution into one candidate", () => {
    const card = toMusicCard(item({ audio_artist: "Example Artist", audio_title: "Petrichor" }));
    expect(card.candidates).toHaveLength(1);

    const candidate = card.candidates[0]!;
    expect(candidate.rawText).toBe("Example Artist - Petrichor");
    expect(candidate.origin).toBe("platform_audio");
    expect(candidate.evidence[0]?.provenance).toBe("fact");
    expect(candidate.searchUrl).toContain("music.youtube.com/search");
  });

  it("grades the track exact when the caption names it too", () => {
    // Two independent statements of the same track. Across the real collection this is
    // every one of the 21 attributed Reels.
    const card = toMusicCard(
      item({
        audio_artist: "Ella Mai",
        audio_title: "Trying",
        caption: "Ella Mai - Trying\n\n#rnb #알앤비",
      }),
    );
    expect(card.candidates[0]?.matchGrade).toBe("exact");
    expect(card.candidates[0]?.evidence.map((e) => e.type)).toContain("caption_mention");
  });

  it("counts the account's own handle as corroboration", () => {
    // An artist posting their own release: @whereisyourhomezone posting homezone.
    const card = toMusicCard(
      item({
        owner: "whereisyourhomezone",
        audio_artist: "homezone",
        audio_title: "비대칭 컴플렉스",
        caption: "가사 맞춰 한쪽 볼 만지는 제스쳐",
      }),
    );
    expect(card.candidates[0]?.matchGrade).toBe("exact");
  });

  it("looks past credit formatting", () => {
    // "수민, Slom" against a caption that writes the names separately and in Latin.
    const card = toMusicCard(
      item({
        owner: "the_bside_mag",
        audio_artist: "수민, Slom",
        audio_title: "곤란한 노래",
        caption: "SUMIN의 자유로운 멜로디와 slom의 절제된 프로덕션은 서로를 비워주며",
      }),
    );
    expect(card.candidates[0]?.matchGrade).toBe("exact");
  });

  it("stays at likely when nothing corroborates the attached audio", () => {
    // Background music on a Reel that never mentions it is not a recommendation.
    const card = toMusicCard(
      item({
        owner: "someone",
        audio_artist: "Unrelated Band",
        audio_title: "Some Track",
        caption: "친구들 앞에서 꼭 틀어보세요",
      }),
    );
    expect(card.candidates[0]?.matchGrade).toBe("likely");
    expect(card.candidates[0]?.evidence.map((e) => e.type)).not.toContain("caption_mention");
  });

  it("does not let a two-character fragment corroborate by accident", () => {
    const card = toMusicCard(
      item({ owner: "x", audio_artist: "AB", audio_title: "CD", caption: "ab cd 아무 말" }),
    );
    expect(card.candidates[0]?.matchGrade).toBe("likely");
  });

  it("keeps the caption verbatim, hashtags included", () => {
    expect(toMusicCard(item()).caption).toContain("#여름코디");
  });
});

describe("tagsOf", () => {
  it("caps the chips so a twenty-tag caption cannot flood a card", () => {
    const many = item({
      caption: `본문\n${Array.from({ length: 20 }, (_, i) => `#t${String(i)}`).join(" ")}`,
    });
    expect(tagsOf(many).length).toBeLessThanOrEqual(6);
  });
});
