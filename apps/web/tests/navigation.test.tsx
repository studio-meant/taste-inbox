import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockRepository } from "@/lib/mock/repository";
import { GlobalNavPill } from "@/components/shell/GlobalNavPill";
import { MobileBottomNav } from "@/components/shell/MobileBottomNav";
import {
  BOTTOM_NAV_DESTINATIONS,
  DESTINATIONS,
  PILL_DESTINATIONS,
  findActiveDestination,
  isDestinationActive,
} from "@/lib/navigation/routes";

const pathname = vi.hoisted(() => ({ current: "/today" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  pathname.current = "/today";
});

describe("navigation model", () => {
  it("has exactly the three global destinations from IA §4", () => {
    expect(DESTINATIONS.map((d) => d.id)).toEqual(["today", "browse", "system"]);
  });

  it("keeps System out of the desktop pill", () => {
    // IA §4: "중앙 pill navigation은 Today / Browse 두 공간만 담는다."
    expect(PILL_DESTINATIONS.map((d) => d.id)).toEqual(["today", "browse"]);
    expect(BOTTOM_NAV_DESTINATIONS.map((d) => d.id)).toEqual(["today", "browse", "system"]);
  });

  it("routes the Inbox to its canonical library route", () => {
    expect(PILL_DESTINATIONS[1]?.href).toBe("/library");
  });

  it.each([
    ["/today", "today"],
    ["/focus/abc", "today"],
    ["/library", "browse"],
    ["/library/anything", "browse"],
    ["/trends", "browse"],
    ["/style", "browse"],
    ["/items/garden-lens", "browse"],
    ["/system", "system"],
    ["/settings", "system"],
  ])("resolves %s to the %s destination", (path, expected) => {
    expect(findActiveDestination(path)?.id).toBe(expected);
  });

  it("does not treat a prefix collision as a match", () => {
    // `/styleguide` must not activate `/style`.
    expect(findActiveDestination("/styleguide")).toBeUndefined();
    expect(findActiveDestination("/todayish")).toBeUndefined();
  });

  it("returns nothing for an unknown route", () => {
    expect(findActiveDestination("/nope")).toBeUndefined();
    for (const destination of DESTINATIONS) {
      expect(isDestinationActive(destination, "/nope")).toBe(false);
    }
  });
});

describe("GlobalNavPill", () => {
  it("renders Today and the Inbox as links", () => {
    render(<GlobalNavPill />);
    const nav = screen.getByRole("navigation", { name: "주요 화면" });
    const links = within(nav).getAllByRole("link");

    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent("Today");
    expect(links[1]).toHaveTextContent("Inbox");
  });

  it("marks the active destination with aria-current", () => {
    // Not colour alone: the state is exposed to assistive technology.
    render(<GlobalNavPill />);
    expect(screen.getByRole("link", { name: /Today/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Inbox/ })).not.toHaveAttribute("aria-current");
  });

  it.each(["/library", "/trends", "/style", "/items/garden-lens"])(
    "activates the Inbox on %s",
    (path) => {
      pathname.current = path;
      render(<GlobalNavPill />);
      expect(screen.getByRole("link", { name: /Inbox/ })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: /Today/ })).not.toHaveAttribute("aria-current");
    },
  );

  it("marks nothing active on a route outside the model", () => {
    pathname.current = "/nope";
    render(<GlobalNavPill />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });
});

describe("MobileBottomNav", () => {
  it("renders all three destinations including System", () => {
    render(<MobileBottomNav />);
    const nav = screen.getByRole("navigation", { name: "주요 화면" });
    const links = within(nav).getAllByRole("link");

    expect(links.map((link) => link.textContent)).toEqual(["Today", "Inbox", "System"]);
  });

  it("marks the active destination", () => {
    pathname.current = "/system";
    render(<MobileBottomNav />);
    expect(screen.getByRole("link", { name: "System" })).toHaveAttribute("aria-current", "page");
  });
});

describe("item detail links", () => {
  it("every Today connection points at a route that exists", async () => {
    // These hrefs shipped for weeks before the page did: `/items/<id>` was emitted by both
    // the fixtures and the live API, rendered as a Link, and 404ed. The `as Route` casts at
    // the call sites are what let it compile.
    const today = await new MockRepository().getToday();
    const hrefs = [
      ...(today.leadConnection === null ? [] : [today.leadConnection.href]),
      ...today.relatedConnections.map((connection) => connection.href),
    ];
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(findActiveDestination(href) !== undefined || href.startsWith("/items/")).toBe(true);
    }
  });

  it("resolves an item id to a real item", async () => {
    const repository = new MockRepository();
    const today = await repository.getToday();
    const lead = today.leadConnection;
    expect(lead).not.toBeNull();
    const id = lead!.href.replace("/items/", "");
    const item = await repository.getItem(id);
    expect(item).not.toBeNull();
    expect(item?.id).toBe(id);
  });

  it("answers null for an id nobody collected, rather than throwing", async () => {
    // A bookmark, or a Today payload built before the item was removed. The page turns
    // this into notFound(), which is a different thing from an error.
    expect(await new MockRepository().getItem("nope-not-a-real-id")).toBeNull();
  });
});
