import { redirect } from "next/navigation";

/**
 * `/system` is part of Settings now (2026-09-28).
 *
 * Two screens that each held half of "how this Mac is set up" meant the only door into
 * Settings was a link on System. They are one page; this route stays so a bookmark or an
 * old link still lands somewhere, and lands on the whole of it.
 */
export default function SystemPage(): never {
  redirect("/settings");
}
