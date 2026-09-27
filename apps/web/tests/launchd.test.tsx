import type { LaunchdPlan } from "@taste-inbox/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { splitCommandBlocks } from "@/components/system/commands";
import { LAUNCHD_SECTION_HEADING, LaunchdPanel } from "@/components/system/LaunchdPanel";
import { MockRepository } from "@/lib/mock/repository";
import { readSource } from "./source-files";

/**
 * The launchd panel exists because Settings had been pointing at it since before it was
 * built: `components/settings/fields.ts` told anyone who changed the collection interval
 * that the reinstall commands were on the System screen, and `/system` contained no
 * reference to launchd at all. `GET /api/collection/launchd` had been generating the
 * commands correctly the whole time with no consumer in `apps/web`.
 *
 * Most of what follows holds the panel to the one product rule that makes it a panel and
 * not a button: launchd jobs are generated, never installed (docs/DECISIONS.md 2026-08-08,
 * CLAUDE.md §10). Loading these jobs points six timers at four logged-in accounts, so the
 * product prints the command and a person runs it. That rule was previously stated only in
 * comments, which is why it is asserted here.
 */

const repository = new MockRepository();

async function plan(): Promise<LaunchdPlan> {
  return repository.getLaunchdPlan();
}

async function showPanel(dataSource: "mock" | "live" = "live") {
  return render(<LaunchdPanel data={{ ok: true, plan: await plan() }} dataSource={dataSource} />);
}

/** The whole section, so a query cannot accidentally reach past it. */
function panel(): HTMLElement {
  return screen.getByRole("region", { name: LAUNCHD_SECTION_HEADING });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("The commands the service generated", () => {
  it("renders every line the service sent, verbatim", async () => {
    const { commands } = await plan();
    await showPanel();

    const text = panel().textContent;
    for (const line of commands) {
      if (line === "") continue;
      expect(text).toContain(line);
    }
  });

  it("keeps `$(id -u)` unexpanded and keeps the two forms apart", async () => {
    // Literal shell. `bootstrap` takes `gui/$(id -u) <path>` with a space and `bootout`
    // takes `gui/$(id -u)/<label>` with a slash; a renderer that "helpfully" resolved or
    // normalised either would hand the user a command that does not work.
    await showPanel();
    const text = panel().textContent;
    expect(text).toContain("launchctl bootstrap gui/$(id -u) /");
    expect(text).toContain("launchctl bootout gui/$(id -u)/dev.tasteinbox.github-stars");
  });

  it("keeps the sleep stagger, which is the only thing spacing the jobs apart", async () => {
    // `StartInterval` counts from load time, so how far apart the jobs are loaded is how
    // far apart they collect. Dropping these lines would silently collapse the stagger.
    await showPanel();
    const text = panel().textContent;
    expect(text).toContain("sleep 180  # instagram_saved_music → +3분");
  });

  it("separates 등록 from 해제, because pasting both at once undoes the first", async () => {
    await showPanel();
    expect(within(panel()).getByRole("heading", { name: "등록" })).toBeInTheDocument();
    expect(within(panel()).getByRole("heading", { name: "해제" })).toBeInTheDocument();

    const install = screen.getByRole("region", { name: "등록 명령" }).textContent;
    const uninstall = screen.getByRole("region", { name: "해제 명령" }).textContent;
    expect(install).toContain("launchctl bootstrap");
    expect(install).not.toContain("launchctl bootout");
    expect(uninstall).toContain("launchctl bootout");
    expect(uninstall).not.toContain("launchctl bootstrap");
  });

  it("names every job and the cadence it was generated with", async () => {
    const { jobs } = await plan();
    await showPanel();

    expect(jobs).toHaveLength(6);
    for (const job of jobs) {
      expect(within(panel()).getByText(job.label)).toBeInTheDocument();
    }
    // The interval, in the service's own words — `runsAt` is a cadence sentence and never
    // a timestamp, because a job loaded at an arbitrary moment has no clock time to name.
    expect(within(panel()).getAllByText("4시간마다 (+3분)").length).toBeGreaterThan(0);
  });
});

describe("Who runs these", () => {
  it("says the person runs them and the app does not", async () => {
    await showPanel();
    const text = panel().textContent;
    expect(text).toContain("터미널에서 직접 실행");
    expect(text).toContain("등록도 해제도 하지 않아요");
  });

  it("offers nothing that could install a job", async () => {
    // The product rule, as a test rather than as a comment. Every control in this section
    // must be a copy affordance; an install button here would load six timers against four
    // logged-in accounts without a person having read a single command (CLAUDE.md §10).
    await showPanel();

    const buttons = within(panel()).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).toHaveAccessibleName(/명령 복사$/);
    }

    // No other way to send anything either: no form to submit, no link dressed as an
    // action, nothing with a `formaction`.
    expect(panel().querySelector("form")).toBeNull();
    expect(within(panel()).queryAllByRole("link")).toHaveLength(0);
    expect(panel().querySelector("[formaction]")).toBeNull();
  });

  it("runs no shell and sends no write from the code behind this panel", () => {
    // A rendered tree cannot show the absence of a `child_process` import or a POST, and
    // the absence is the requirement. Source text, following `repository-boundary.test.ts`.
    for (const file of ["LaunchdPanel.tsx", "CopyCommands.tsx", "commands.ts"]) {
      const text = readSource("components", "system", file);
      expect(text).not.toMatch(/child_process|execSync|execFile|spawn\(/);
      expect(text).not.toMatch(/fetch\(/);
    }

    // And the client that does talk to the service reads this endpoint and only reads it.
    // `patch` is `HttpRepository`'s single write path.
    const http = readSource("lib", "repository", "http.ts");
    expect(http).toContain('this.get<unknown>("/api/collection/launchd")');
    expect(http).not.toMatch(/patch<[^>]*>\([^)]*launchd/);
  });

  it("copies a block to the clipboard and says so in words", async () => {
    // Typed with its parameter so the recorded call keeps it: a bare `vi.fn(() => …)` has
    // arity 0 and `mock.calls[0][0]` is then a tuple index that does not exist.
    const writeText = vi.fn((_text: string) => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await showPanel();
    fireEvent.click(within(panel()).getByRole("button", { name: "등록 명령 복사" }));

    await waitFor(() => {
      expect(screen.getByText("복사됨")).toBeInTheDocument();
    });

    const copied = writeText.mock.calls[0]![0];
    // What lands on the clipboard is the block as it would be typed — the comments and the
    // sleep lines included, nothing rewritten.
    expect(copied.split("\n")[0]).toBe("# 설치 — 각 줄을 확인한 뒤 실행하세요.");
    expect(copied).toContain("sleep 180");
    expect(copied).not.toContain("launchctl bootout");
  });

  it("tells the user to copy it themselves when the clipboard refuses", async () => {
    // An insecure context, or a browser that says no. Silently doing nothing would read as
    // a copy that worked.
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: () => Promise.reject(new Error("denied")),
      },
    });

    await showPanel();
    fireEvent.click(within(panel()).getByRole("button", { name: "해제 명령 복사" }));

    await waitFor(() => {
      expect(screen.getByText(/직접 선택해서 복사해 주세요/)).toBeInTheDocument();
    });
  });
});

describe("What Settings promised", () => {
  it("renders the section Settings sends people to", async () => {
    // The defect this panel fixes. `fields.ts` named a destination for weeks while
    // `/system` had no reference to launchd, installing or reinstalling anywhere in it.
    const fields = readSource("components", "settings", "fields.ts");
    expect(fields).toContain(LAUNCHD_SECTION_HEADING);

    await showPanel();
    expect(
      within(panel()).getByRole("heading", { name: LAUNCHD_SECTION_HEADING, level: 2 }),
    ).toBeInTheDocument();
  });

  it("says a saved interval does not move a job already loaded", async () => {
    // The whole reason Settings points here: `StartInterval` is baked into the plist at
    // generation time and counted from when the job was loaded, so saving 6 changes the
    // file and nothing about the six timers currently running.
    await showPanel();
    const text = panel().textContent;
    expect(text).toContain("등록할 때의 간격 그대로 계속 돕니다");
    expect(text).toContain("해제한 뒤 다시 등록해야");
  });

  it("does not claim the jobs start collecting the moment they are loaded", async () => {
    // `RunAtLoad` is false, so the first run is one whole interval later.
    await showPanel();
    expect(panel().textContent).toContain("한 간격 뒤부터 시작합니다");
  });
});

describe("What the panel refuses to claim", () => {
  it("never reports whether a job is currently installed", async () => {
    // `installed` is hardcoded `false` in `api/app.py` and is a statement about the request
    // rather than about the machine — nothing asks launchd what is loaded. Printing it
    // would be an unchecked claim that goes stale the moment the user runs the command.
    const { installed } = await plan();
    expect(installed).toBe(false);

    await showPanel();
    const text = panel().textContent;
    expect(text).not.toMatch(/등록됨|설치됨|등록되지 않음|설치 안 됨/);
  });

  it("does not print the repo-relative path beside the absolute one", async () => {
    // `jobs[].path` arrives relative to the repo root while the path inside the command is
    // absolute. Only the absolute one works when pasted; showing both prints two different
    // strings for one file.
    await showPanel();
    const text = panel().textContent;
    expect(text).toContain("/var/launchd/dev.tasteinbox.github-stars.plist");
    expect(text).not.toContain(" var/launchd/dev.tasteinbox.github-stars.plist");
  });

  it("says so when the paths on screen are not this Mac's", async () => {
    // Mock mode cannot know the repository's absolute path. Commands that quietly point at
    // nothing are worse than commands labelled as an example.
    await showPanel("mock");
    expect(within(panel()).getByText(/아래 경로는 예시입니다/)).toBeInTheDocument();
  });

  it("says nothing about examples when the service answered", async () => {
    await showPanel("live");
    expect(within(panel()).queryByText(/아래 경로는 예시입니다/)).not.toBeInTheDocument();
  });
});

describe("When the service is not there", () => {
  it("keeps the failure inside the section instead of taking the page down", () => {
    // `/system` has no local `error.tsx`, so an uncaught throw here reaches the root
    // boundary and replaces the whole document, navigation included.
    render(
      <LaunchdPanel
        data={{ ok: false, message: "로컬 서비스에 연결하지 못했어요. 실행 중인지 확인해 주세요." }}
        dataSource="live"
      />,
    );

    expect(screen.getByRole("heading", { name: LAUNCHD_SECTION_HEADING })).toBeInTheDocument();
    expect(screen.getByText("등록 명령을 불러오지 못했어요.")).toBeInTheDocument();
    // The service's own sentence survives, collapsed, rather than being replaced by a
    // generic one the user cannot act on.
    expect(screen.getByText(/로컬 서비스에 연결하지 못했어요/)).toBeInTheDocument();
    // And nothing pretends to have commands.
    expect(screen.queryByRole("button", { name: /명령 복사/ })).not.toBeInTheDocument();
  });

  it("catches the failure in the page rather than letting the boundary have it", () => {
    const page = readSource("app", "settings", "page.tsx");
    expect(page).toContain("loadLaunchdPlan");
    expect(page).toMatch(/catch\s*\(error\)/);
  });
});

describe("splitCommandBlocks", () => {
  it("drops the blank separator without losing the boundary it marks", () => {
    // `api/launchd.py:197` appends `""` between the blocks. A `.filter(Boolean)` in the
    // renderer would collapse the gap; a `z.string().min(1)` in the schema would reject the
    // real payload outright.
    const blocks = splitCommandBlocks([
      "# 설치",
      "launchctl bootstrap gui/$(id -u) /tmp/a.plist",
      "",
      "# 해제",
      "launchctl bootout gui/$(id -u)/a",
    ]);

    expect(blocks.map((block) => block.id)).toEqual(["install", "uninstall"]);
    expect(blocks[0]?.lines).toEqual(["# 설치", "launchctl bootstrap gui/$(id -u) /tmp/a.plist"]);
    expect(blocks[1]?.lines).toEqual(["# 해제", "launchctl bootout gui/$(id -u)/a"]);
  });

  it("keeps every line when the service stops emitting the marker", () => {
    // The marker is the payload's one structural signal. If it changes, the lines stay
    // visible in one block rather than half of them disappearing from the screen.
    const blocks = splitCommandBlocks(["# 설치", "launchctl bootstrap gui/$(id -u) /tmp/a.plist"]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe("install");
    expect(blocks[0]?.lines).toHaveLength(2);
  });

  it("produces nothing from nothing", () => {
    expect(splitCommandBlocks([])).toEqual([]);
    expect(splitCommandBlocks(["", ""])).toEqual([]);
  });
});
