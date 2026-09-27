interface DesktopTauriCore {
  readonly invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

type TauriWindow = Window & {
  readonly __TAURI__?: { readonly core: DesktopTauriCore };
};

const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Return a safe OS-openable destination, or null for an in-app/unsupported href. */
export function externalDestination(href: string, baseHref: string): string | null {
  try {
    const destination = new URL(href, baseHref);
    if (!EXTERNAL_SCHEMES.has(destination.protocol)) return null;
    if (destination.protocol === "mailto:") return destination.href;

    const base = new URL(baseHref);
    return destination.origin === base.origin ? null : destination.href;
  } catch {
    return null;
  }
}

async function openExternal(url: string): Promise<void> {
  const core = (window as TauriWindow).__TAURI__?.core;
  if (core === undefined) throw new Error("Desktop bridge is unavailable");
  await core.invoke("open_external", { url });
}

/** Route every shared component's ordinary external anchor through macOS. */
export function installExternalLinkHandler(): () => void {
  const handleClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target;
    const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
    if (anchor === null) return;

    const destination = externalDestination(anchor.href, window.location.href);
    if (destination === null) return;

    event.preventDefault();
    void openExternal(destination).catch((error: unknown) => {
      console.error("외부 링크를 열지 못했습니다.", error);
    });
  };

  document.addEventListener("click", handleClick, true);
  return () => {
    document.removeEventListener("click", handleClick, true);
  };
}
