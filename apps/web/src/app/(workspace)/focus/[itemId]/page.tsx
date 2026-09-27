import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FocusCanvas } from "@/components/focus/FocusCanvas";
import { getRepository } from "@/lib/repository";

/**
 * `/focus/[itemId]` — the **Lab**. PAGE_SPECIFICATIONS §6.1, the 2026-09-28 `itemId` build.
 *
 * Not a Browse mode and not in the navigation (CLAUDE.md §2: the core navigation is not
 * redesigned). It is entered by `Open in Lab` from an Inbox card, from an item's page, and
 * from a Working Queue row, and it is where research, the question, the plan and the
 * sandboxed trial for that one item happen.
 *
 * The route keeps its name and the components keep theirs; `Lab` is what a person reads
 * (docs/next_step, 2026-09-28). A stable route days before a submission is worth more than
 * a matching folder name.
 */

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ itemId: string }>;
}): Promise<Metadata> {
  const payload = await getRepository().getFocus((await params).itemId);
  return {
    title:
      payload === null ? "Lab · Taste Inbox R&D" : `${payload.item.title} · Lab · Taste Inbox R&D`,
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
