/**
 * Nothing. Kept as the mount point, mounting nothing.
 *
 * The floating dock used to sit on Today and the Inbox saying `질문 입력은 아직 열리지
 * 않았어요` — an input that takes nothing, over the cards, on the two screens where the
 * user's next move is to pick an item. It was honest and it was in the way, and since
 * 2026-09-28 it is also confusing: the Lab has a composer that *does* take a question, so
 * a second one saying questions are closed contradicts it two clicks away.
 *
 * There is still no query path over the library. When there is, this is where it mounts —
 * `TasteQueryDock` is intact and `LabQueryDock` is built on its stylesheet, so turning it
 * back on is a return statement rather than a rebuild.
 */
export function WorkspaceQueryDock() {
  return null;
}
