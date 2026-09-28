import { THEMES } from "@taste-inbox/ui/theme";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FoundationStatus } from "@/components/foundation/FoundationStatus";
import { ThemePreviewGrid } from "@/components/foundation/ThemePreviewGrid";
import { MockRepository } from "@/lib/mock/repository";

const repository = new MockRepository();

async function renderStatus(overrides: { dataSource?: "mock" | "live"; blocked?: boolean } = {}) {
  const [hostProfile, resourcePolicy, itemCount, jobs] = await Promise.all([
    repository.getHostProfile(),
    repository.getResourcePolicy(),
    repository.getItemCount(),
    repository.listJobs(),
  ]);

  return render(
    <FoundationStatus
      dataSource={overrides.dataSource ?? "mock"}
      hostProfile={hostProfile}
      resourcePolicy={resourcePolicy}
      itemCount={itemCount}
      jobs={
        overrides.blocked === true
          ? [...jobs, { ...jobs[0]!, id: "blocked", state: "blocked" as const }]
          : jobs
      }
    />,
  );
}

describe("FoundationStatus", () => {
  it("renders the derived limits, not raw hardware numbers alone", async () => {
    await renderStatus();

    expect(screen.getByRole("heading", { name: "연결 상태" })).toBeInTheDocument();
    // Derived from a 16GB / 512GB profile: usable 12GB → auto-prepare 7.68GB.
    expect(screen.getByText("7.68GB")).toBeInTheDocument();
    expect(screen.getByText(/가용 메모리 12GB에서 계산/)).toBeInTheDocument();
  });

  it("labels memory pressure with text, never colour alone", async () => {
    await renderStatus();
    // DESIGN.md §18 — no colour-only status.
    expect(screen.getByText(/메모리 압력 정상/)).toBeInTheDocument();
  });

  it("shows blocked jobs as needing attention", async () => {
    await renderStatus({ blocked: true });
    expect(screen.getByText(/확인 필요 1건/)).toBeInTheDocument();
  });

  it("reports mock mode, and how many items the Inbox holds", async () => {
    await renderStatus();
    expect(screen.getByText("Mock")).toBeInTheDocument();
    expect(screen.getByText("Inbox 항목")).toBeInTheDocument();
    expect(screen.getByText(String(await repository.getItemCount()))).toBeInTheDocument();
  });

  it("shows no operator-tightening note when none applies", async () => {
    await renderStatus();
    expect(screen.queryByText(/운영자 제한 적용됨/)).not.toBeInTheDocument();
  });
});

describe("ThemePreviewGrid", () => {
  it("renders every theme", () => {
    render(<ThemePreviewGrid themes={THEMES} />);
    expect(screen.getAllByRole("listitem", { name: undefined }).length).toBeGreaterThan(0);
    for (const theme of THEMES) {
      expect(screen.getByRole("heading", { name: theme.name })).toBeInTheDocument();
    }
  });

  it("marks exactly one theme as the default", () => {
    render(<ThemePreviewGrid themes={THEMES} />);
    expect(screen.getAllByText("기본값")).toHaveLength(1);
  });

  it("names every swatch for screen readers", () => {
    // Architecture §23 — status and colour are never conveyed by colour alone.
    render(<ThemePreviewGrid themes={THEMES} />);
    const defaultTheme = screen.getByRole("heading", { name: "Meadow Cream" });
    const card = defaultTheme.closest("article");
    expect(card).not.toBeNull();

    const ramp = within(card!).getByRole("list", {
      name: "Meadow Cream 색상 램프",
    });
    // #DFE7CC, not the derived #DCE8C6 it used to be: the ramp now takes the value the
    // approved reference actually renders (reference/taste-inbox-ui-ux-final.html).
    expect(within(ramp).getByText(/연두 #DFE7CC/)).toBeInTheDocument();
    expect(within(ramp).getByText(/포레스트 #50654E/)).toBeInTheDocument();
    expect(within(ramp).getByText(/라이트 우드 #B89F83/)).toBeInTheDocument();
  });

  it("scopes tokens per card so each preview is the real theme", () => {
    const { container } = render(<ThemePreviewGrid themes={THEMES} />);
    const cards = container.querySelectorAll<HTMLElement>(".theme-card");
    expect(cards).toHaveLength(THEMES.length);

    const first = cards[0];
    expect(first?.style.getPropertyValue("--outer")).toBe(THEMES[0]?.tokens.outer);
    expect(first?.style.getPropertyValue("--forest")).toBe(THEMES[0]?.tokens.forest);
  });
});
