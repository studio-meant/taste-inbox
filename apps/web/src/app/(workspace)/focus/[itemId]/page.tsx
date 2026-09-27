import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FocusCanvas } from "@/components/focus/FocusCanvas";
import { getRepository } from "@/lib/repository";

/**
 * `/focus/[itemId]` — PAGE_SPECIFICATIONS §6.1, the 2026-09-28 `itemId` build.
 *
 * Not a Browse mode and not in the navigation (CLAUDE.md §2: the core navigation is not
 * redesigned). It is entered from an item's page and from a Working Queue row, and it is
 * where research and a sandboxed trial for that one item happen.
 */

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ itemId: string }>;
}): Promise<Metadata> {
  const payload = await getRepository().getFocus((await params).itemId);
  return {
    title: payload === null ? "Focus · Taste Inbox" : `${payload.item.title} · Focus · Taste Inbox`,
  };
}

export default async function FocusPage({
  params,
}: {
  readonly params: Promise<{ itemId: string }>;
}) {
  const payload = await getRepository().getFocus((await params).itemId);
  // A queue row or a bookmark can name an item that is no longer collected.
  if (payload === null) notFound();
  return <FocusCanvas payload={payload} />;
}
