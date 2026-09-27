import { buildMusicSearchUrl, type MusicItemCardModel } from "@taste-inbox/shared";

/**
 * Mock music items.
 *
 * Every value is invented. The set deliberately covers the three shapes that decide
 * whether the board works:
 *
 * 1. A caption with a numbered list — the easy case, several candidates resolved.
 * 2. A Reel whose list is only on screen — **zero candidates**, and the card still has to
 *    be useful. This is the case that fails silently if the design assumes extraction
 *    always succeeds.
 * 3. A partly-resolved list, including a sped-up edit, so `different_version` is exercised.
 */

const search = (query: string): string => buildMusicSearchUrl(query, "youtube_music");

export const MOCK_MUSIC_ITEMS: readonly MusicItemCardModel[] = [
  {
    id: "reel-rainy-day-list",
    source: {
      platform: "instagram",
      label: "Instagram Saved",
      originalUrl: "https://www.instagram.com/reel/example-rainy-day/",
      author: null,
      actionType: "save",
      firstSeenAt: "2026-08-08T06:38:00Z",
    },
    collectionName: "플레이리스트",
    caption:
      "비 오는 날 듣기 좋은 노래 4곡\n1. Example Artist - Petrichor\n2. Second Example - Slow Window\n3. Third Example - 우산 없이\n4. Fourth Example - Quiet Hours",
    media: {
      id: "reel-rainy-day-cover",
      type: "video_frame",
      src: "/mock-media/music-reel-rainy.svg",
      width: 1080,
      height: 1920,
      alt: "비 오는 창가를 배경으로 곡 목록이 적힌 릴스 표지",
      blurDataUrl: null,
    },
    candidates: [
      {
        id: "rainy-1",
        rawText: "Example Artist - Petrichor",
        origin: "caption",
        ordinal: 1,
        artist: "Example Artist",
        title: "Petrichor",
        album: "Example Album",
        matchGrade: "exact",
        confidence: 0.97,
        evidence: [
          {
            id: "rainy-1-e1",
            type: "catalog_lookup",
            label: "카탈로그 조회",
            value: "아티스트와 제목이 모두 일치",
            provenance: "fact",
            sourceUrl: null,
            observedAt: "2026-08-08T06:45:00Z",
            confidence: 0.97,
          },
        ],
        searchUrl: search("Example Artist Petrichor"),
        service: "youtube_music",
        handledAt: null,
        checkedAt: "2026-08-08T06:45:00Z",
      },
      {
        id: "rainy-2",
        rawText: "Second Example - Slow Window",
        origin: "caption",
        ordinal: 2,
        artist: "Second Example",
        title: "Slow Window",
        album: null,
        matchGrade: "likely",
        confidence: 0.74,
        evidence: [
          {
            id: "rainy-2-e1",
            type: "catalog_lookup",
            label: "카탈로그 조회",
            value: "제목은 일치하나 아티스트 표기가 다름",
            provenance: "inference",
            sourceUrl: null,
            observedAt: "2026-08-08T06:45:00Z",
            confidence: 0.74,
          },
        ],
        searchUrl: search("Second Example Slow Window"),
        service: "youtube_music",
        handledAt: null,
        checkedAt: "2026-08-08T06:45:00Z",
      },
      {
        id: "rainy-3",
        rawText: "Third Example - 우산 없이",
        origin: "caption",
        ordinal: 3,
        // Korean title unresolved: catalogs carry Hangul, romanised and English forms.
        artist: null,
        title: null,
        album: null,
        matchGrade: "unknown",
        confidence: null,
        evidence: [],
        searchUrl: search("Third Example 우산 없이"),
        service: "youtube_music",
        handledAt: null,
        checkedAt: "2026-08-08T06:45:00Z",
      },
      {
        id: "rainy-4",
        rawText: "Fourth Example - Quiet Hours (sped up)",
        origin: "caption",
        ordinal: 4,
        artist: "Fourth Example",
        title: "Quiet Hours",
        album: null,
        // A sped-up edit is a separate recording with its own ISRC, so this is neither
        // an exact match nor a wrong one.
        matchGrade: "different_version",
        confidence: 0.81,
        evidence: [
          {
            id: "rainy-4-e1",
            type: "catalog_lookup",
            label: "버전 차이",
            value: "원곡은 찾았지만 sped up 버전은 별도 음원",
            provenance: "inference",
            sourceUrl: null,
            observedAt: "2026-08-08T06:45:00Z",
            confidence: 0.81,
          },
        ],
        searchUrl: search("Fourth Example Quiet Hours sped up"),
        service: "youtube_music",
        handledAt: null,
        checkedAt: "2026-08-08T06:45:00Z",
      },
    ],
    coverText: null,
    coverCheckedAt: null,
    links: [],
    handledAt: null,
  },
  {
    id: "reel-on-screen-only",
    source: {
      platform: "instagram",
      label: "Instagram Saved",
      originalUrl: "https://www.instagram.com/reel/example-on-screen/",
      author: null,
      actionType: "save",
      firstSeenAt: "2026-08-08T06:40:00Z",
    },
    collectionName: "플레이리스트",
    // The list is only in the video. Extraction finds nothing, and the card must still
    // be worth having — this is the case the whole design has to survive.
    caption: "오늘의 추천 🎧",
    media: {
      id: "reel-on-screen-cover",
      type: "video_frame",
      src: "/mock-media/music-reel-onscreen.svg",
      width: 1080,
      height: 1920,
      alt: "곡 제목이 화면에 표시된 릴스 표지",
      blurDataUrl: null,
    },
    candidates: [],
    coverText: null,
    coverCheckedAt: null,
    links: [],
    handledAt: null,
  },
  {
    id: "reel-single-recommendation",
    source: {
      platform: "instagram",
      label: "Instagram Saved",
      originalUrl: "https://www.instagram.com/reel/example-single/",
      author: null,
      actionType: "save",
      firstSeenAt: "2026-08-07T21:12:00Z",
    },
    collectionName: "플레이리스트",
    caption: "이 곡 요즘 계속 듣는 중\nFifth Example — Long Way Home",
    media: null,
    candidates: [
      {
        id: "single-1",
        rawText: "Fifth Example — Long Way Home",
        origin: "caption",
        ordinal: null,
        artist: "Fifth Example",
        title: "Long Way Home",
        album: "Long Way Home",
        matchGrade: "exact",
        confidence: 0.95,
        evidence: [
          {
            id: "single-1-e1",
            type: "catalog_lookup",
            label: "카탈로그 조회",
            value: "아티스트와 제목이 모두 일치",
            provenance: "fact",
            sourceUrl: null,
            observedAt: "2026-08-07T21:20:00Z",
            confidence: 0.95,
          },
        ],
        searchUrl: search("Fifth Example Long Way Home"),
        service: "youtube_music",
        // Already dealt with, so the card is out of the inbox.
        handledAt: "2026-08-07T22:02:00Z",
        checkedAt: "2026-08-07T21:20:00Z",
      },
    ],
    coverText: null,
    coverCheckedAt: null,
    links: [],
    handledAt: "2026-08-07T22:02:00Z",
  },
];
