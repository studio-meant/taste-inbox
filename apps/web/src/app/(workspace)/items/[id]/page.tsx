import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemDetail } from "@/components/items/ItemDetail";
import { firstValue, safeBoardReturnHref, type RawSearchParams } from "@/lib/filters/board-filters";
import { getRepository } from "@/lib/repository";

/**
 * One collected item, whole.
 *
 * This route existed as a link before it existed as a page: `/api/today` and the Today
 * fixtures have always emitted `/items/<id>` hrefs, and `DailyConnectionsPanel` has always
 * rendered them — so every connection on Today was a 404. The `as Route` cast at the two
 * call sites is what let that ship, which is why those casts are gone with this.
 *
 * The back link returns to the exact Inbox view the reader came from (`?from=`), and to
 * the Inbox itself when there is none.
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
  const query = searchParams === undefined ? {} : await searchParams;
  const backHref = safeBoardReturnHref(firstValue(query.from), "/library");
  return <ItemDetail item={item} backHref={backHref} />;
}
