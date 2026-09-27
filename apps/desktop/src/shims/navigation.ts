import { useMemo, useSyncExternalStore } from "react";

export const NAVIGATION_EVENT = "taste-inbox:navigate";
export const REFRESH_EVENT = "taste-inbox:refresh";

export class DesktopNotFoundError extends Error {
  constructor() {
    super("desktop_not_found");
    this.name = "DesktopNotFoundError";
  }
}

export class DesktopRedirectError extends Error {
  constructor() {
    super("desktop_redirect");
    this.name = "DesktopRedirectError";
  }
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATION_EVENT, listener);
  window.addEventListener(REFRESH_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATION_EVENT, listener);
    window.removeEventListener(REFRESH_EVENT, listener);
  };
}

function routeSnapshot(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function navigate(href: string, options?: { readonly replace?: boolean }): void {
  if (options?.replace === true) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

export function refreshDesktopRoute(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function useDesktopLocation(): string {
  return useSyncExternalStore(subscribe, routeSnapshot, () => "/");
}

export function usePathname(): string {
  useDesktopLocation();
  return window.location.pathname;
}

export function useSearchParams(): URLSearchParams {
  const snapshot = useDesktopLocation();
  return useMemo(() => new URLSearchParams(snapshot.split("?", 2)[1] ?? ""), [snapshot]);
}

export function useRouter() {
  return useMemo(
    () => ({
      push: (href: string) => {
        navigate(href);
      },
      replace: (href: string) => {
        navigate(href, { replace: true });
      },
      refresh: refreshDesktopRoute,
      prefetch: async (_href: string) => Promise.resolve(),
      back: () => {
        window.history.back();
      },
      forward: () => {
        window.history.forward();
      },
    }),
    [],
  );
}

export function redirect(href: string): never {
  navigate(href, { replace: true });
  throw new DesktopRedirectError();
}

export function notFound(): never {
  throw new DesktopNotFoundError();
}
