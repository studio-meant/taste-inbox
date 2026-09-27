import { MockRepository } from "../mock/repository";
import { HttpRepository, TauriRepository } from "./http";
import type { TasteInboxRepository } from "./types";

export * from "./types";
export { ApiDataError, HttpRepository, TauriRepository } from "./http";

export type DataSource = "mock" | "live";

/** Loopback only. The service is one process on this Mac and is not reachable from off it. */
const DEFAULT_API_URL = "http://127.0.0.1:8787";

export function resolveDataSource(value: string | undefined = process.env.NEXT_PUBLIC_DATA_SOURCE) {
  return value === "live" ? "live" : "mock";
}

let cached: TasteInboxRepository | null = null;

/** Tauri exposes this public global only inside the packaged desktop WebView. */
export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && window.__TAURI__?.core !== undefined;
}

/**
 * The single place that decides where data comes from.
 *
 * Components and pages must go through this, never through `MockRepository` directly —
 * that is what makes the Phase 2 switch to the FastAPI service a one-file change.
 */
export function getRepository(): TasteInboxRepository {
  if (cached !== null) {
    return cached;
  }
  if (isTauriDesktop()) {
    cached = new TauriRepository();
    return cached;
  }
  const source = resolveDataSource();
  cached =
    source === "live"
      ? new HttpRepository(process.env.TASTE_INBOX_API_URL ?? DEFAULT_API_URL)
      : new MockRepository();
  return cached;
}

/** Test seam. */
export function resetRepository(): void {
  cached = null;
}
