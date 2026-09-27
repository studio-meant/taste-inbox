import type { TasteInboxRepository } from "../../web/src/lib/repository/types";
import { TauriRepository } from "../../web/src/lib/repository/http";

export * from "../../web/src/lib/repository/types";
export { ApiDataError, HttpRepository, TauriRepository } from "../../web/src/lib/repository/http";

let cached: TasteInboxRepository | null = null;

/** The static desktop frontend has one data source: the registered Tauri IPC command. */
export function getRepository(): TasteInboxRepository {
  cached ??= new TauriRepository();
  return cached;
}

export function resolveDataSource(): "live" {
  return "live";
}

export function isTauriDesktop(): true {
  return true;
}

export function resetRepository(): void {
  cached = null;
}
