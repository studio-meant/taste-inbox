import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemDetail } from "@/components/items/ItemDetail";
import { firstValue, safeBoardReturnHref, type RawSearchParams } from "@/lib/filters/board-filters";
import { BOARD_HREF } from "@/lib/navigation/boards";
import { getRepository } from "@/lib/repository";

/**
 * One collected item, whole.
 *
 * This route existed as a link before it existed as a page: `/api/today` and the Today
 * fixtures have always emitted `/items/<id>` hrefs, and `DailyConnectionsPanel` has always
 * rendered them — so every connection on Today was a 404. The `as Route` cast at the two
 * call sites is what let that ship, which is why those casts are gone with this.
 *
 * Board-agnostic on purpose. Today links to items from all three boards, and the API's
 * item endpoint used to answer with a Trends card, describing a saved Reel as though it
 * were a repository.
 */

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const item = await getRepository().getItem((await params).id);
  return { title: item === null ? "항목 · Taste Inbox" : `${item.title} · Taste Inbox` };
}

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<RawSearchParams>;
}) {
  const item = await getRepository().getItem((await params).id);
  // A bookmark, or a Today payload built before the item was removed, names something no
  // longer collected. That is the not-found case, not an error.
  if (item === null) notFound();
  const fallback = item.board === null ? "/library" : BOARD_HREF[item.board];
  const query = searchParams === undefined ? {} : await searchParams;
  const backHref = safeBoardReturnHref(firstValue(query.from), fallback);
  return <ItemDetail item={item} backHref={backHref} />;
}
