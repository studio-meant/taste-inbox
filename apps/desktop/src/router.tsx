import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import RootError from "@/app/error";
import RootLoading from "@/app/loading";
import NotFound from "@/app/not-found";
import SettingsLayout from "@/app/settings/layout";
import OnboardingLayout from "@/app/onboarding/layout";
import WorkspaceLayout from "@/app/(workspace)/layout";
import type { RawSearchParams } from "@/lib/filters/board-filters";
import { DesktopNotFoundError, DesktopRedirectError, useDesktopLocation } from "./shims/navigation";

type RouteState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly node: ReactNode }
  | { readonly kind: "error"; readonly error: Error };

function searchParams(): RawSearchParams {
  const grouped: RawSearchParams = {};
  for (const [key, value] of new URLSearchParams(window.location.search)) {
    const current = grouped[key];
    if (current === undefined) grouped[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else grouped[key] = [current, value];
  }
  return grouped;
}

async function pageFor(pathname: string): Promise<ReactNode> {
  const params = Promise.resolve(searchParams());
  if (pathname === "/") {
    const Page = (await import("@/app/page")).default;
    return Page();
  }
  if (pathname === "/today") {
    const Page = (await import("@/app/(workspace)/today/page")).default;
    return WorkspaceLayout({ children: await Page() });
  }
  if (pathname === "/library") {
    const Page = (await import("@/app/(workspace)/library/page")).default;
    return WorkspaceLayout({ children: await Page({ searchParams: params }) });
  }
  if (pathname.startsWith("/items/")) {
    const id = decodeURIComponent(pathname.slice("/items/".length));
    if (id === "" || id.includes("/")) return <NotFound />;
    const Page = (await import("@/app/(workspace)/items/[id]/page")).default;
    return WorkspaceLayout({
      children: await Page({ params: Promise.resolve({ id }), searchParams: params }),
    });
  }
  // `/system` is part of Settings since 2026-09-28; the web route redirects, this one renders.
  if (pathname === "/settings" || pathname === "/system") {
    const Page = (await import("@/app/settings/page")).default;
    return <SettingsLayout>{await Page()}</SettingsLayout>;
  }
  if (pathname === "/onboarding") {
    const Page = (await import("@/app/onboarding/page")).default;
    return <OnboardingLayout>{await Page()}</OnboardingLayout>;
  }
  return <NotFound />;
}

const TITLES: Readonly<Record<string, string>> = {
  "/": "Taste Inbox",
  "/today": "Today · Taste Inbox",
  "/library": "Inbox · Taste Inbox",
  "/system": "Settings · Taste Inbox",
  "/settings": "Settings · Taste Inbox",
  "/onboarding": "시작하기 · Taste Inbox",
};

export function DesktopRouter() {
  const location = useDesktopLocation();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<RouteState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    const pathname = window.location.pathname;
    document.title =
      TITLES[pathname] ?? (pathname.startsWith("/items/") ? "항목 · Taste Inbox" : "Taste Inbox");

    void pageFor(pathname)
      .then((node) => {
        if (active) setState({ kind: "ready", node });
      })
      .catch((caught: unknown) => {
        if (!active || caught instanceof DesktopRedirectError) return;
        if (caught instanceof DesktopNotFoundError) {
          setState({ kind: "ready", node: <NotFound /> });
          return;
        }
        setState({
          kind: "error",
          error: caught instanceof Error ? caught : new Error("화면을 불러오지 못했어요."),
        });
      });

    return () => {
      active = false;
    };
  }, [location, retry]);

  if (state.kind === "loading") return <RootLoading />;
  if (state.kind === "error") {
    return (
      <RootError
        error={state.error}
        reset={() => {
          setRetry((value) => value + 1);
        }}
      />
    );
  }
  return state.node;
}
