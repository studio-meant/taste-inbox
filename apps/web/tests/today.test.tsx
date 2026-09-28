import { TodayPayloadSchema, type TodayPayload } from "@taste-inbox/shared";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyConnectionsPanel } from "@/components/today/DailyConnectionsPanel";
import { PartialFailureNotice } from "@/components/today/PartialFailureNotice";
import { PreviousDaySection } from "@/components/today/PreviousDaySection";
import { SavedItemsSummaryCard } from "@/components/today/SavedItemsSummaryCard";
import { TodayHeader, formatUpdatedTime, latestRunAt } from "@/components/today/TodayHeader";
import { WorkingQueuePanel } from "@/components/today/WorkingQueuePanel";
import { MockRepository } from "@/lib/mock/repository";
import { SOURCE_LABEL } from "@/components/today/SourceDots";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

// `RefreshWhileRunning` asks the app router to re-read the route while a row is moving.
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const repository = new MockRepository();

async function payload(): Promise<TodayPayload> {
  return repository.getToday();
}

describe("Today payload", () => {
  it("validates against the shared schema", async () => {
    const today = await payload();
    expect(() => TodayPayloadSchema.parse(today)).not.toThrow();
  });

  it("carries the sections PAGE_SPECIFICATIONS §5.2 requires", async () => {
    const today = await payload();
    expect(today.leadConnection).not.toBeNull();
    // "related item 2–4개"
    expect(today.relatedConnections.length).toBeGreaterThanOrEqual(2);
    expect(today.relatedConnections.length).toBeLessThanOrEqual(4);
    expect(today.workingQueue.length).toBeGreaterThan(0);
    // §11.6 SuggestionChip: at most three.
    expect(today.suggestedQueries.length).toBeLessThanOrEqual(3);
  });

  it("keeps the lead more confident than every related item", async () => {
    // §5.2 Ranking: "낮은 confidence item은 lead보다 related slot에 둔다."
    const today = await payload();
    const leadConfidence = today.leadConnection?.confidence ?? 0;
    for (const related of today.relatedConnections) {
      expect(related.confidence ?? 0).toBeLessThanOrEqual(leadConfidence);
    }
  });

  it("gives every suggested query a concrete sentence", async () => {
    // §11.6 forbids vague suggestions like "Surprise me".
    const today = await payload();
    for (const query of today.suggestedQueries) {
      expect(query.text.length).toBeGreaterThan(6);
    }
  });

  it("keeps the kind split consistent with the total", async () => {
    const { savedSummary } = await payload();
    expect(Object.values(savedSummary.kindCounts).reduce((sum, count) => sum + count, 0)).toBe(
      savedSummary.newItemCount,
    );
  });
});

describe("TodayHeader", () => {
  it("keeps the eyebrow out of the page heading's name", async () => {
    // The reference stacks an eyebrow above the title (ref.js:504). It is a real label,
    // so it stays readable text — but it is a sibling of the <h1>, never part of it, or
    // the page would announce itself as "DAILY TASTE BRIEF Today".
    const today = await payload();
    render(<TodayHeader sources={today.sourceStatusSummary} greeting={today.greeting} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveAccessibleName("Today");
    expect(heading).not.toHaveTextContent("DAILY TASTE BRIEF");

    const eyebrow = screen.getByText("DAILY TASTE BRIEF");
    expect(eyebrow).toBeInTheDocument();
    // Readable, not hidden decoration.
    expect(eyebrow).not.toHaveAttribute("aria-hidden");
    expect(eyebrow.getAttribute("lang")).toBe("en");
  });

  it("announces the update time as text, not as a tint", async () => {
    const today = await payload();
    render(<TodayHeader sources={today.sourceStatusSummary} />);

    // The reference's glass pill carries the only chrome on this row. Its meaning has to
    // survive greyscale, so the time is spelled out rather than implied by the fill.
    const latest = latestRunAt(today.sourceStatusSummary);
    expect(latest).not.toBeNull();

    const pill = screen.getByText(/Updated/);
    expect(pill).toHaveTextContent(
      new RegExp(`Updated\\s*${formatUpdatedTime(latest!)}`.replace(/\s/g, "\\s*")),
    );
    expect(pill).not.toHaveAttribute("aria-hidden");
    // Machine-readable alongside the human string.
    expect(within(pill).getByText(formatUpdatedTime(latest!)).tagName).toBe("TIME");
  });

  it("takes the update time from the last collector run, not the clock", () => {
    const summary = {
      sources: [
        {
          platform: "github" as const,
          label: "GitHub Star",
          state: "collected" as const,
          collectedCount: 1,
          lastRunAt: "2026-08-08T06:31:00Z",
        },
        {
          platform: "huggingface" as const,
          label: "Hugging Face",
          state: "collected" as const,
          collectedCount: 1,
          lastRunAt: "2026-08-08T09:05:00Z",
        },
      ],
    };
    expect(latestRunAt(summary)).toBe("2026-08-08T09:05:00Z");
  });

  it("renders no pill when nothing has run yet", () => {
    render(
      <TodayHeader
        sources={{
          sources: [
            {
              platform: "github",
              label: "GitHub Star",
              state: "skipped",
              collectedCount: 0,
              lastRunAt: null,
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

describe("DailyConnectionsPanel", () => {
  it("renders the lead, its relation note and one primary action", async () => {
    const today = await payload();
    render(
      <DailyConnectionsPanel lead={today.leadConnection} related={today.relatedConnections} />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Sample Reasoning: Small Models That Check Their Own Work",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/코드 저장소와 데모 Space/)).toBeInTheDocument();
    // What the lead is, in the product's own English noun.
    expect(screen.getByText("Paper")).toBeInTheDocument();

    // DESIGN.md §9: one dark capsule per card — and it is a link, not a <button> wrapped
    // in one, going where every other `Open in Lab` goes.
    expect(screen.getByRole("link", { name: "Open in Lab" })).toHaveAttribute(
      "href",
      "/focus/sample-reasoning-paper",
    );
    expect(screen.queryByRole("button", { name: /Open in Lab/ })).not.toBeInTheDocument();
  });

  it("counts the card's connections in its heading", async () => {
    // `.card-heading` — ref.js:491 "8 Connections". The count replaced the uppercase
    // eyebrow, so the number has to be real: lead + related.
    const today = await payload();
    render(
      <DailyConnectionsPanel lead={today.leadConnection} related={today.relatedConnections} />,
    );
    expect(
      screen.getByRole("heading", {
        name: `${String(1 + today.relatedConnections.length)} Connected bundles`,
      }),
    ).toBeInTheDocument();
  });

  it("reports the collectors' totals in the footer meta row", async () => {
    // `.update-row` — ref.css:249. The reference's "10 Updates · 7 articles" counted media
    // types this product does not classify; the collectors' own numbers do the same job.
    const today = await payload();
    render(
      <DailyConnectionsPanel
        lead={today.leadConnection}
        related={today.relatedConnections}
        sources={today.sourceStatusSummary}
      />,
    );

    const collected = today.sourceStatusSummary.sources.filter(
      (source) => source.state === "collected",
    );
    const total = collected.reduce((sum, source) => sum + source.collectedCount, 0);

    expect(screen.getByText(`${String(total)} Updates`)).toBeInTheDocument();
    expect(screen.getByText("GitHub 3")).toBeInTheDocument();
    // The stopped collector contributes no count to a total of what was collected.
    expect(screen.queryByText(/Hugging Face 4/)).not.toBeInTheDocument();
  });

  it("breaks the total down by every source, not the first three", async () => {
    /*
     * The row used to `slice(0, 3)`, inherited from the reference's "lead plus up to three
     * breakdowns" layout, which printed a total beside parts that did not add up to it. A
     * breakdown beside a total is read as accounting for it.
     *
     * Four sources on purpose — every platform the schema has — so a cap of three shows.
     */
    const today = await payload();
    const four = [
      { platform: "github", collectedCount: 120 },
      { platform: "huggingface", collectedCount: 15 },
      { platform: "arxiv", collectedCount: 2 },
      { platform: "web", collectedCount: 3 },
    ] as const;

    const shape = today.sourceStatusSummary.sources[0];
    expect(shape).toBeDefined();

    render(
      <DailyConnectionsPanel
        lead={today.leadConnection}
        related={today.relatedConnections}
        sources={{
          sources: four.map((entry) => ({
            ...shape!,
            platform: entry.platform,
            collectedCount: entry.collectedCount,
            state: "collected" as const,
          })),
        }}
      />,
    );

    const total = four.reduce((sum, entry) => sum + entry.collectedCount, 0);
    expect(screen.getByText(`${String(total)} Updates`)).toBeInTheDocument();

    const shown = four.map((entry) => {
      const label = screen.getByText(new RegExp(`^${SOURCE_LABEL[entry.platform]} \\d`));
      return Number(label.textContent.replace(/[^0-9]/g, ""));
    });
    expect(shown, "every collected source is named").toHaveLength(four.length);
    expect(
      shown.reduce((sum, count) => sum + count, 0),
      "the parts add up to the whole",
    ).toBe(total);
  });

  it("shows an empty state inside the card shape when there is no lead", () => {
    render(<DailyConnectionsPanel lead={null} related={[]} />);

    // The card keeps its heading and its footer; only the body becomes a sentence
    // (DESIGN.md §15). Replacing the whole card with the empty state would make the
    // column collapse and the grid re-flow around a missing day.
    expect(screen.getByRole("heading", { name: "0 Connected bundles" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /오늘의 연결/ })).toBeInTheDocument();
    expect(screen.getByText("0 Updates")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists related items as a list", async () => {
    const today = await payload();
    render(
      <DailyConnectionsPanel lead={today.leadConnection} related={today.relatedConnections} />,
    );
    const list = screen.getByRole("list", { name: "관련 항목" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(today.relatedConnections.length);
  });

  it("names every source dot rather than relying on its colour", async () => {
    // ref.css:234 paints each disc in a brand hex and prints an initial. The glyph is the
    // second channel; the platform name is the accessible one.
    const today = await payload();
    render(
      <DailyConnectionsPanel lead={today.leadConnection} related={today.relatedConnections} />,
    );
    const dots = screen.getByRole("list", { name: "관련 출처" });
    expect(within(dots).getByText("GitHub")).toBeInTheDocument();
    expect(within(dots).getByText("Hugging Face")).toBeInTheDocument();
  });
});

describe("SavedItemsSummaryCard", () => {
  it("shows the count, the split and the sources", async () => {
    const today = await payload();
    render(<SavedItemsSummaryCard summary={today.savedSummary} />);

    expect(screen.getByText("4")).toBeInTheDocument();
    // A meter plus the tags that name it — the same numbers, still as text, because a bar
    // alone would make the split colour-only (CLAUDE.md §6). By kind, largest first.
    const chips = ["Repo 2", "Model 1", "Paper 1"].map((label) => screen.getByText(label));
    expect(chips).toHaveLength(3);
    expect(screen.queryByText(/^AI /)).toBeNull();

    const sources = screen.getByRole("list", { name: "수집한 출처" });
    expect(within(sources).getAllByRole("listitem")).toHaveLength(2);
  });

  it("hides the meter from assistive technology because the tags already say it", async () => {
    const today = await payload();
    const { container } = render(<SavedItemsSummaryCard summary={today.savedSummary} />);
    const meter = container.querySelector("[aria-hidden='true'] > i");
    expect(meter).not.toBeNull();
  });

  it("draws no photographs — nothing collected has one", async () => {
    const today = await payload();
    render(<SavedItemsSummaryCard summary={today.savedSummary} />);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("makes the whole card one link to the collection", async () => {
    // ref.js:493 makes the surface itself the affordance. Ours is an <a>, not the
    // reference's <button>, because it navigates — and it is the only interactive element
    // in the card, so the stretched hit area nests nothing.
    const today = await payload();
    render(<SavedItemsSummaryCard summary={today.savedSummary} />);

    const link = screen.getByRole("link", { name: "오늘 들어온 4개 항목을 Inbox에서 보기" });
    expect(link).toHaveAttribute("href", today.savedSummary.href);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

describe("WorkingQueuePanel", () => {
  it("renders each row as 상태 → 대상 → 다음 단계", async () => {
    const today = await payload();
    render(<WorkingQueuePanel items={today.workingQueue} />);

    // The state moved from a full pill into the row's second line, next to the next step,
    // because the reference gives column one a 25px icon tile. It is still words.
    expect(screen.getByText("승인 대기")).toBeInTheDocument();
    expect(screen.getByText("sample-org/garden-lens")).toBeInTheDocument();
    expect(screen.getByText("안전하게 실행할지 결정하기")).toBeInTheDocument();
  });

  it("sends every row to its Lab", async () => {
    const today = await payload();
    render(<WorkingQueuePanel items={today.workingQueue} />);
    const row = screen.getByText("sample-org/garden-lens").closest("a");
    expect(row).toHaveAttribute("href", "/focus/garden-lens");
  });

  it("shows a meter only for rows that report progress", async () => {
    const today = await payload();
    render(<WorkingQueuePanel items={today.workingQueue} />);
    // Only the research run has progress in the fixture.
    const meters = screen.getAllByRole("meter");
    expect(meters).toHaveLength(1);
    // The bar is 4px tall and has no visible label, so its name and value have to be
    // carried by ARIA or the measurement is invisible to a screen reader.
    expect(meters[0]).toHaveAccessibleName("Sample Reasoning 진행률");
    expect(meters[0]).toHaveAttribute("aria-valuenow", "50");
  });

  it("carries today's ready and attention counts in the footer", async () => {
    // The reference's header holds one pill, so the counts live with the card that owns
    // them rather than being repeated above the fold.
    const today = await payload();
    render(<WorkingQueuePanel items={today.workingQueue} counts={today.counts} />);

    const counts = screen.getByRole("list", { name: "오늘 요약" });
    expect(
      within(counts).getByText(`준비됨 ${String(today.counts.readyActions)}`),
    ).toBeInTheDocument();
    expect(
      within(counts).getByText(`확인 필요 ${String(today.counts.attention)}`),
    ).toBeInTheDocument();
  });

  it("drops the attention count when there is nothing to attend to", async () => {
    const today = await payload();
    render(
      <WorkingQueuePanel items={today.workingQueue} counts={{ ...today.counts, attention: 0 }} />,
    );
    // Scoped to the counts: a blocked trial row still names its own state in words.
    const counts = screen.getByRole("list", { name: "오늘 요약" });
    expect(within(counts).queryByText(/확인 필요/)).not.toBeInTheDocument();
  });

  it("shows an empty state inside the card shape when nothing is queued", () => {
    render(<WorkingQueuePanel items={[]} />);

    expect(screen.getByRole("heading", { name: "Lab Queue" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "지금 기다리는 작업은 없어요" }),
    ).toBeInTheDocument();
    // The card still offers its way out, so an empty queue is not a dead end.
    expect(screen.getByRole("link", { name: /설정 열기/ })).toHaveAttribute("href", "/settings");
  });
});

describe("PartialFailureNotice", () => {
  it("names what succeeded before what failed", async () => {
    const today = await payload();
    render(<PartialFailureNotice summary={today.sourceStatusSummary} />);
    const text = screen.getByText(/정상 수집했지만/).textContent;

    expect(text).toContain("GitHub는 정상 수집했지만");
    expect(text).toContain("Hugging Face는 오류로");
    // Leading with the failure would make a mostly-successful run read as broken.
    expect(text.indexOf("정상 수집")).toBeLessThan(text.indexOf("Hugging Face"));
  });

  it("renders nothing when every collector succeeded", () => {
    render(
      <PartialFailureNotice
        summary={{
          sources: [
            {
              platform: "github",
              label: "GitHub Star",
              state: "collected",
              collectedCount: 3,
              lastRunAt: null,
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/건너뛰었어요/)).not.toBeInTheDocument();
  });
});

describe("PreviousDaySection", () => {
  it("renders the day label as a heading and its highlights as a list", async () => {
    const today = await payload();
    render(<PreviousDaySection days={today.previousDays} />);
    expect(screen.getByRole("heading", { name: /어제/ })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says how many the day actually had, and where the rest are", async () => {
    /*
     * The cards are at most three of what the day collected (`api/today.py`'s
     * `_highlights_for`), and the reference's heading is the bare word "Yesterday". On the
     * real board that drew three cards under 「3일 전」 for a day that collected 142 items,
     * with nothing on screen saying so — three is what a person would take the day to be.
     * `itemCount` was in the payload the whole time and no pixel used it.
     */
    const today = await payload();
    const day = { ...today.previousDays[0]!, itemCount: 142 };
    render(<PreviousDaySection days={[day]} />);

    expect(screen.getByRole("heading", { name: /142개/ })).toBeInTheDocument();
    const toTheDay = screen.getAllByRole("link", { name: /전체 보기|142개/ });
    expect(toTheDay.length).toBeGreaterThan(0);
    for (const link of toTheDay) {
      expect(link).toHaveAttribute("href", expect.stringContaining(`day=${day.date}`));
    }
  });

  it("does not offer to show more when there is no more", async () => {
    const today = await payload();
    const complete = { ...today.previousDays[0]! };
    render(<PreviousDaySection days={[{ ...complete, itemCount: complete.highlights.length }]} />);
    expect(screen.queryByText(/전체 보기/)).toBeNull();
  });

  it("tints each cover by source and marks it, never inventing a photograph", async () => {
    // A starred repository has no picture; a row of identical gradients said the same
    // thing three times, so the cover takes the source's own colour and mark.
    const today = await payload();
    const { container } = render(<PreviousDaySection days={today.previousDays} />);

    expect(container.querySelector("img")).toBeNull();
    const tinted = container.querySelectorAll('[style*="--cover-tint"]');
    expect(tinted).toHaveLength(today.previousDays[0]!.highlights.length);
    for (const cover of tinted) {
      expect(cover.querySelector("svg"), "the cover carries the source's mark").not.toBeNull();
    }
  });

  it("gives every row a cover, a title, a meta line and a trailing kind tag", async () => {
    // ref.js:497. The reference's trailing pills read "Ready" and "78%" — a compatibility
    // verdict and a price match, both removed. The item's kind is what the payload has.
    const today = await payload();
    render(<PreviousDaySection days={today.previousDays} />);

    const rows = screen.getAllByRole("listitem");
    const first = within(rows[0]!);
    expect(first.getByText("sample-org/tiny-eval-set")).toBeInTheDocument();
    expect(first.getByText("Hugging Face")).toBeInTheDocument();
    expect(first.getByText("Dataset")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Repo")).toBeInTheDocument();
  });

  it("keeps the Korean day label", async () => {
    // "Yesterday" is the reference's word; the product's is 어제 and stays that way.
    const today = await payload();
    render(<PreviousDaySection days={today.previousDays} />);
    expect(screen.queryByText("Yesterday")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no history", () => {
    const { container } = render(<PreviousDaySection days={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SavedItemsSummaryCard split", () => {
  it("names every kind that arrived, and they add up to the headline", async () => {
    const today = await payload();
    render(
      <SavedItemsSummaryCard
        summary={{
          ...today.savedSummary,
          newItemCount: 135,
          kindCounts: { repo: 120, paper: 9, dataset: 3, space: 3 },
        }}
      />,
    );

    const parts = ["Repo 120", "Paper 9", "Dataset 3", "Space 3"].map((label) =>
      Number(screen.getByText(label).textContent.replace(/[^0-9]/g, "")),
    );
    expect(parts.reduce((sum, count) => sum + count, 0)).toBe(135);
    expect(screen.queryByText(/^기타 /)).toBeNull();
  });

  it("names the leftover rather than hiding it", async () => {
    const today = await payload();
    render(
      <SavedItemsSummaryCard
        summary={{ ...today.savedSummary, newItemCount: 10, kindCounts: { paper: 4 } }}
      />,
    );
    expect(screen.getByText("Paper 4")).toBeInTheDocument();
    expect(screen.getByText("기타 6")).toBeInTheDocument();
  });
});

describe("WorkingQueuePanel — research and trial rows", () => {
  afterEach(() => {
    vi.useRealTimers();
    router.refresh.mockReset();
  });

  const row = (kind: TodayPayload["workingQueue"][number]["kind"], nextStep: string) => ({
    id: `queue-${kind}`,
    kind,
    target: "debpalash/VoiceStudio",
    nextStep,
    href: "/focus/abc",
    progress: kind.endsWith("_running") ? 0.33 : null,
  });

  it("names every new kind in Korean words, never by colour alone", () => {
    render(
      <WorkingQueuePanel
        items={[
          row("research_running", "NVIDIA AI-Q에 조사를 맡긴다"),
          row("research_ready", "조사 결과 읽기"),
          row("approval_required", "안전하게 실행할지 결정하기"),
          row("trial_running", "OpenShell 안에서 에이전트를 실행한다"),
          row("trial_ready", "결과 보기"),
          row("trial_blocked", "에이전트가 끝내지 못했습니다 (stop=aborted)"),
        ]}
      />,
    );

    for (const label of [
      "조사 중",
      "제안 준비됨",
      "승인 대기",
      "샌드박스 실행 중",
      "실행 완료",
      "차단됨 · 확인 필요",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const link of screen.getAllByRole("link", { name: /debpalash\/VoiceStudio/ })) {
      expect(link).toHaveAttribute("href", "/focus/abc");
    }
  });

  it("re-reads the route while a job is moving, and not otherwise", () => {
    vi.useFakeTimers();
    const { unmount } = render(<WorkingQueuePanel items={[row("trial_running", "실행 중")]} />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    unmount();

    render(<WorkingQueuePanel items={[row("trial_ready", "결과 보기")]} />);
    act(() => {
      vi.advanceTimersByTime(12000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
