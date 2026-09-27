import type { Route } from "next";
import type { ItemBoard } from "@taste-inbox/shared";

/**
 * The five places an item can be, as a person reads them.
 *
 * **Plain data, in a plain module with no `"use client"`.** `BROWSE_MODES` learned this the
 * hard way: exported from a client component, a Server Component receives a client
 * *reference* rather than the array, and both boards rendered their skeleton forever while
 * every jsdom test passed. The board picker is a Client Component and the rail is a Server
 * Component, and they read the same list — so the list lives here.
 *
 * One vocabulary for the whole feature. The picker's fifth option, the rail's fifth row and
 * the route `/none` all say the same word, because a person who sets an item to `None` then
 * has to be able to find the place called `None`. Two words for one state is how a sweep
 * becomes unfindable.
 *
 * English, like every other board name and destination in this product (docs/DECISIONS.md,
 * 2026-08-08: destination and mode names stay English as the product's own nouns, and
 * anything read as a sentence is Korean). `lang="en"` travels with them wherever they are
 * rendered, so a Korean screen reader inside `<html lang="ko">` does not mispronounce them.
 */
export const BOARD_LABEL: Readonly<Record<ItemBoard, string>> = {
  trends: "Trends",
  style: "Style",
  music: "Music",
  places: "Places",
  none: "None",
};

/**
 * The route each one is browsed at. Typed as `Route`, so a board whose page does not exist
 * is a build error rather than a 404 somebody finds.
 */
export const BOARD_HREF: Readonly<Record<ItemBoard, Route>> = {
  trends: "/trends",
  style: "/style",
  music: "/music",
  places: "/places",
  none: "/none",
};

/**
 * What each choice means, for the control that offers them.
 *
 * Read out by the picker as the option's accessible description rather than printed beside
 * five options — a card has no room for five sentences, and the words `Trends` and `Style`
 * are not self-evident to someone meeting them for the first time. `None` gets the longest
 * one because it is the only choice whose meaning is a decision rather than a subject.
 */
export const BOARD_MEANING: Readonly<Record<ItemBoard, string>> = {
  trends: "AI · 개발 · 도구 · 디자인 레퍼런스",
  style: "옷 · 코디 · 패션 아이템 · 뷰티",
  music: "음악 · 노래 · 플레이리스트 · 공연",
  places: "맛집 · 카페 · 여행지",
  none: "어느 보드에도 두지 않음",
};

/**
 * The order the picker offers them in, and the order the rail lists them.
 *
 * `none` last, and not because it matters least — because it is the only one that is not a
 * board, and a list that ends with it reads as "…or none of these". It is offered as an
 * ordinary option all the same: an item the classifier put on the wrong board is very often
 * an item that belongs on no board, and burying that behind a second interaction would make
 * the common correction the expensive one.
 */
export const BOARD_CHOICES: readonly ItemBoard[] = ["trends", "style", "music", "places", "none"];

/**
 * How the back link on an item's page names where it came from.
 *
 * Spelled out per board rather than composed as `${label}로`, because Korean's particle
 * follows the sound of the word before it: `Music` ends in a consonant and takes `으로`,
 * which the composed version got wrong for as long as it existed. `None` is not a board at
 * all, so it says 목록 rather than pretending to be one.
 */
export const BOARD_BACK_LABEL: Readonly<Record<ItemBoard, string>> = {
  trends: "Trends로 돌아가기",
  style: "Style로 돌아가기",
  music: "Music으로 돌아가기",
  places: "Places로 돌아가기",
  none: "None 목록으로 돌아가기",
};
