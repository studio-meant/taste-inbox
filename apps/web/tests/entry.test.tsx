import type { CeremonialEntry, TodayPayload } from "@taste-inbox/shared";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listSource, readSource } from "./source-files";
import { EntrySequence } from "@/components/entry/EntrySequence";
import { GreetingScreen } from "@/components/entry/GreetingScreen";
import { SplashScreen } from "@/components/entry/SplashScreen";
import {
  PROFILE_NAME,
  entryStatusPills,
  entrySubline,
  formatEntryDate,
  greetingHeadline,
} from "@/components/entry/copy";
import { MockRepository } from "@/lib/mock/repository";
import type { TasteInboxRepository } from "@/lib/repository";

/**
 * The front door.
 *
 * Three things are being held to account here, in this order of importance.
 *
 * **Nobody is trapped.** The ceremony sits between a person and the only screen they came
 * for, so every assertion about advancing — click, Enter, ⌘Enter, the visible link out,
 * the auto-advance — is really an assertion that the app is still usable by someone who
 * cannot or will not click a decoration.
 *
 * **Nothing on it is invented.** The reference's middle status pill counted prepared
 * execution environments, which this product removed (CLAUDE.md §8). The tests below
 * pin the two counts that are real and pin the absence of the one that is not.
 *
 * **Reduced motion is a different sequence, not a faster one.** IA §7.0 requires the
 * Splash to be skipped rather than shortened.
 */

const nav = vi.hoisted(() => ({ redirected: [] as string[], pushed: [] as string[] }));

vi.mock("next/navigation", () => ({
  // The real `redirect` throws to unwind the render; a mock that returns would let the
  // route keep going and render a ceremony for the one mode that has none.
  redirect: (path: string) => {
    nav.redirected.push(path);
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  useRouter: () => ({
    push: (path: string) => {
      nav.pushed.push(path);
    },
    replace: () => undefined,
    prefetch: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const repository = vi.hoisted(() => ({ current: null as unknown as TasteInboxRepository }));

vi.mock("@/lib/repository", () => ({
  getRepository: () => repository.current,
}));

/** Imported after the mocks so the route sees them. */
const { default: StartupOrchestrator } = await import("@/app/page");

/** A repository whose ceremonial-entry setting has been written through the real store. */
async function repositoryWith(mode: CeremonialEntry): Promise<TasteInboxRepository> {
  const mock = new MockRepository();
  await mock.updateSettings({ "general.ceremonialEntry": mode });
  return mock;
}

async function basePayload(): Promise<TodayPayload> {
  return new MockRepository().getToday();
}

function withCounts(base: TodayPayload, counts: Partial<TodayPayload["counts"]>): TodayPayload {
  return { ...base, counts: { ...base.counts, ...counts } };
}

/** The four strings `api/today.py:50-58` produces, by local hour. */
const SERVICE_GREETINGS = {
  lateNight: "늦은 밤이네요",
  morning: "좋은 아침이에요",
  afternoon: "좋은 오후예요",
  evening: "오늘 하루 어땠나요",
} as const;

beforeEach(() => {
  nav.redirected.length = 0;
  nav.pushed.length = 0;
  document.documentElement.removeAttribute("data-motion");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Which screen the app opens with", () => {
  it("sends `skip` straight to Today, exactly as the old unconditional redirect did", async () => {
    repository.current = await repositoryWith("skip");

    await expect(StartupOrchestrator()).rejects.toThrow("NEXT_REDIRECT:/today");
    expect(nav.redirected).toEqual(["/today"]);
  });

  it("opens `full` on the Splash", async () => {
    repository.current = await repositoryWith("full");

    render(await StartupOrchestrator());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Taste Inbox");
    expect(nav.redirected).toEqual([]);
  });

  it("opens `brief` on the Greeting, with no Splash in front of it", async () => {
    repository.current = await repositoryWith("brief");

    render(await StartupOrchestrator());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PROFILE_NAME);
    expect(screen.queryByText("아무 곳이나 눌러 시작하세요")).not.toBeInTheDocument();
  });

  it("keeps the page's single `main` landmark addressable by the layout's skip link", async () => {
    repository.current = await repositoryWith("full");

    render(await StartupOrchestrator());

    // `app/layout.tsx:41` renders `<a href="#main">`; a route without `#main` silently
    // makes that link a no-op for the one screen it matters most on.
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });
});

describe("The greeting line", () => {
  it("changes with the hour, because the hour is the service's answer and not ours", async () => {
    const base = await basePayload();

    const rendered = Object.values(SERVICE_GREETINGS).map((greeting) => {
      const view = render(
        <GreetingScreen today={{ ...base, greeting }} onBegin={() => undefined} />,
      );
      const text = screen.getByRole("heading", { level: 1 }).textContent;
      view.unmount();
      return text;
    });

    expect(rendered).toEqual([
      `${PROFILE_NAME}님, 늦은 밤이네요`,
      `${PROFILE_NAME}님, 좋은 아침이에요`,
      `${PROFILE_NAME}님, 좋은 오후예요`,
      `${PROFILE_NAME}님, 오늘 하루 어땠나요`,
    ]);
    expect(new Set(rendered).size).toBe(4);
  });

  it("has no clock of its own, so the browser's hour cannot contradict the service's", async () => {
    // `TodayPayload.greeting` is written by `api/today.py::_greeting` from the *service's*
    // local hour. If this screen re-derived it, a browser in another timezone — or one left
    // open past midnight — would print a different greeting than every other surface.
    const base = await basePayload();
    const today = { ...base, greeting: SERVICE_GREETINGS.morning };

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T03:00:00+09:00"));
    const first = render(<GreetingScreen today={today} onBegin={() => undefined} />);
    const atThree = screen.getByRole("heading", { level: 1 }).textContent;
    first.unmount();

    vi.setSystemTime(new Date("2026-08-09T21:00:00+09:00"));
    render(<GreetingScreen today={today} onBegin={() => undefined} />);
    const atNine = screen.getByRole("heading", { level: 1 }).textContent;

    expect(atThree).toBe(atNine);
    expect(atNine).toContain(SERVICE_GREETINGS.morning);
  });

  it("falls back to a claimless greeting rather than printing a dangling name", () => {
    // `TodayPayloadSchema.greeting` is `z.string()` with no `min`.
    expect(greetingHeadline("")).toBe(`${PROFILE_NAME}님, 안녕하세요`);
    expect(greetingHeadline("   ")).toBe(`${PROFILE_NAME}님, 안녕하세요`);
  });

  it("takes the name from one constant and invents nothing", () => {
    // There is no display-name setting anywhere: the API's twelve `LEAVES`, the twelve
    // `SETTING_KEYS` and `config/app.example.yaml` all lack one. The only name the app has
    // is the literal `(workspace)/layout.tsx:51` passes to the ContextBar, so this screen
    // imports it rather than writing a third copy.
    expect(greetingHeadline("좋은 아침이에요", "Nari")).toBe("Nari님, 좋은 아침이에요");
  });

  it("tells the truth in the sub-line when nothing was collected", () => {
    expect(entrySubline(17)).toBe("오늘 새로 들어온 관심 항목을 정리했어요.");
    expect(entrySubline(0)).toBe("오늘은 아직 새로 들어온 항목이 없어요.");
  });

  it("prints the payload's own calendar day without re-projecting it", () => {
    // The service already resolved this day in the product timezone; formatting it in
    // another one is how `8월 9일` silently becomes `8월 8일`.
    expect(formatEntryDate("2026-08-09")).toBe("8월 9일 일요일");
    expect(formatEntryDate("2026-08-08")).toBe("8월 8일 토요일");
    expect(formatEntryDate("not-a-day")).toBe("not-a-day");
  });
});

describe("The status pills", () => {
  it("carries the two counts the product actually has", async () => {
    const base = await basePayload();
    render(
      <GreetingScreen
        today={withCounts(base, { newItems: 17, attention: 1 })}
        onBegin={() => undefined}
      />,
    );

    expect(screen.getByText("신규 17개")).toBeInTheDocument();
    expect(screen.getByText("확인 필요 1개")).toBeInTheDocument();
  });

  it("never offers the reference's `Ready`, whatever the payload says", async () => {
    // `api/today.py:159` returns a literal `0` with the comment "Nothing can be acted on
    // until an enricher has run." The reference's Ready counted prepared execution
    // environments, and code execution was removed (CLAUDE.md §8). A pill for it could
    // only ever be a container looking for a number.
    const base = await basePayload();
    const pills = entryStatusPills({ newItems: 3, readyActions: 99, attention: 0 });

    expect(pills.map((pill) => pill.label)).toEqual(["신규 3개"]);

    render(
      <GreetingScreen
        today={withCounts(base, { newItems: 3, readyActions: 99, attention: 0 })}
        onBegin={() => undefined}
      />,
    );
    expect(screen.queryByText(/99/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ready|준비 완료/)).not.toBeInTheDocument();
  });

  it("hides Attention when there is nothing to attend to", async () => {
    // IA §7.1: "status에 문제가 없으면 Attention을 숨긴다."
    const base = await basePayload();
    render(
      <GreetingScreen
        today={withCounts(base, { newItems: 4, attention: 0 })}
        onBegin={() => undefined}
      />,
    );

    expect(screen.getByText("신규 4개")).toBeInTheDocument();
    expect(screen.queryByText(/확인 필요/)).not.toBeInTheDocument();
  });

  it("separates the two pills by more than colour", async () => {
    // CLAUDE.md §6: no colour-only statuses. Each pill carries an icon *and* a worded
    // count, and the two icons are different shapes — greyscale still tells them apart.
    const base = await basePayload();
    render(
      <GreetingScreen
        today={withCounts(base, { newItems: 17, attention: 1 })}
        onBegin={() => undefined}
      />,
    );

    const marks = [screen.getByText("신규 17개"), screen.getByText("확인 필요 1개")].map(
      (label) => {
        const pill = label.closest("span");
        expect(pill).not.toBeNull();
        const icon = pill?.querySelector("svg");
        expect(icon).not.toBeNull();
        return icon?.innerHTML ?? "";
      },
    );

    expect(marks[0]).not.toBe("");
    expect(marks[0]).not.toBe(marks[1]);
  });
});

describe("Getting out of the ceremony", () => {
  it("advances from Splash to Greeting on a click anywhere", async () => {
    repository.current = await repositoryWith("full");
    render(await StartupOrchestrator());

    fireEvent.click(screen.getByRole("button", { name: "아무 곳이나 눌러 시작하세요" }));

    expect(screen.getByRole("heading", { level: 1, name: /님,/ })).toBeInTheDocument();
  });

  it("advances on Enter alone, with no pointer involved", async () => {
    repository.current = await repositoryWith("full");
    render(await StartupOrchestrator());

    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(screen.getByRole("heading", { level: 1, name: /님,/ })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(nav.pushed).toEqual(["/today"]);
  });

  it("makes the printed ⌘ Enter caps do what they say", async () => {
    // In the reference these two caps are decoration: `App.prototype.keydown` (ref.js:559)
    // handles digits, arrows, Space and three letters, and neither Meta nor Enter.
    repository.current = await repositoryWith("brief");
    render(await StartupOrchestrator());

    const begin = screen.getByRole("button", { name: "눌러서 시작하기" });
    expect(begin).toHaveAttribute("aria-keyshortcuts", "Meta+Enter");

    fireEvent.keyDown(begin, { key: "Enter", metaKey: true });
    expect(nav.pushed).toEqual(["/today"]);
  });

  it("does not fire the ceremony twice for one keystroke on a focused button", async () => {
    repository.current = await repositoryWith("brief");
    render(await StartupOrchestrator());

    // Plain Enter on a button is native activation; the global handler must stand aside or
    // the click and the shortcut both run.
    fireEvent.keyDown(screen.getByRole("button", { name: "눌러서 시작하기" }), { key: "Enter" });
    expect(nav.pushed).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "눌러서 시작하기" }));
    expect(nav.pushed).toEqual(["/today"]);
  });

  it("leaves Enter alone inside a text field", async () => {
    repository.current = await repositoryWith("brief");
    render(await StartupOrchestrator());

    const field = document.createElement("input");
    document.body.append(field);
    fireEvent.keyDown(field, { key: "Enter" });
    field.remove();

    expect(nav.pushed).toEqual([]);
  });

  it("never leaves the Splash on screen waiting for a click", async () => {
    // IA §7.0: 600–1000ms, and never held past 1.2s. The reference has no timer at all —
    // a person who does not click sits on a black screen.
    vi.useFakeTimers();
    repository.current = await repositoryWith("full");
    render(await StartupOrchestrator());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Taste Inbox");

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(screen.getByRole("heading", { level: 1, name: /님,/ })).toBeInTheDocument();
  });

  it("offers a visible, keyboard-reachable way to Today without waiting", async () => {
    repository.current = await repositoryWith("brief");
    render(await StartupOrchestrator());

    const link = screen.getByRole("link", { name: /Today로 바로 가기/ });
    expect(link).toHaveAttribute("href", "/today");
  });

  it("makes the Splash hit area a real control rather than a clickable section", () => {
    // ref.js:484 is a bare `<section onClick>`: not focusable, no role, no keyboard path.
    render(<SplashScreen onBegin={() => undefined} />);

    const hit = screen.getByRole("button", { name: "아무 곳이나 눌러 시작하세요" });
    hit.focus();
    expect(hit).toHaveFocus();
  });

  it("carries focus onto the arriving screen instead of dropping it on the body", async () => {
    // Only for the person it happened to: the control they were on is destroyed by the
    // swap, and the browser's answer is `<body>` — silently, at the top of the document.
    repository.current = await repositoryWith("full");
    render(await StartupOrchestrator());

    const hit = screen.getByRole("button", { name: "아무 곳이나 눌러 시작하세요" });
    hit.focus();
    fireEvent.click(hit);

    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("main").contains(document.activeElement)).toBe(true);
  });

  it("leaves focus where it was when the Splash times out on its own", async () => {
    // Nobody touched the keyboard; yanking focus at 900ms would be the intrusive half of
    // the same fix.
    vi.useFakeTimers();
    repository.current = await repositoryWith("full");
    render(await StartupOrchestrator());

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(document.activeElement).toBe(document.body);
  });
});

describe("Reduced motion", () => {
  it("skips the Splash instead of shortening it", async () => {
    // IA §7.0: "reduced motion에서는 fade 없이 즉시 Greeting 또는 Today로 이동한다."
    document.documentElement.dataset.motion = "reduced";
    const base = await basePayload();

    render(<EntrySequence mode="full" today={base} />);

    expect(screen.queryByText("아무 곳이나 눌러 시작하세요")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /님,/ })).toBeInTheDocument();
  });

  it("does not co-mount an outgoing layer to crossfade", async () => {
    const base = await basePayload();
    document.documentElement.dataset.motion = "reduced";

    render(<EntrySequence mode="full" today={base} />);

    // One scene layer, not two: there is nothing to fade from.
    expect(screen.getByRole("main").firstElementChild?.children).toHaveLength(1);
  });

  it("crossfades two layers when motion is not reduced", async () => {
    const base = await basePayload();
    render(<EntrySequence mode="full" today={base} />);

    fireEvent.click(screen.getByRole("button", { name: "아무 곳이나 눌러 시작하세요" }));

    expect(screen.getByRole("main").firstElementChild?.children).toHaveLength(2);
  });

  it("switches every looping animation off under both triggers, rather than speeding it up", () => {
    // `motion.css` caps duration and iteration count globally, which settles an entrance —
    // but one 150ms pass of an infinite pulse is still the same movement, faster. Every
    // stylesheet in this folder that starts a loop has to turn it off in both places.
    const sheets = listSource("components", "entry").filter((name) => name.endsWith(".module.css"));
    expect(sheets.length).toBeGreaterThan(0);

    for (const name of sheets) {
      const css = readSource("components", "entry", name);
      if (!css.includes("animation:")) continue;
      expect(css, `${name} honours the OS preference`).toContain("prefers-reduced-motion");
      expect(css, `${name} honours the product switch`).toContain('data-motion="reduced"');
    }
  });
});

describe("The scenic backdrop", () => {
  it("renders the Greeting at full strength, the one screen the reference does", async () => {
    // Today/Browse/Focus all pass `quiet`; `AmbientCanvas`'s `scenic` and `animated` props
    // existed with no caller until this screen.
    const base = await basePayload();
    const { container } = render(<GreetingScreen today={base} onBegin={() => undefined} />);

    const art = container.querySelector("svg[viewBox='0 0 1440 960']");
    expect(art).not.toBeNull();
    // Seven hills, one water body, five surface lines — the reference's own geometry.
    expect(art?.querySelectorAll("path")).toHaveLength(13);
  });

  it("keeps the four-petal mark out of the reading order", async () => {
    const base = await basePayload();
    const { container } = render(<GreetingScreen today={base} onBegin={() => undefined} />);

    // The mark is decoration beside a wordmark that already says the same thing, so it is
    // hidden rather than announced a second time.
    const petals = container.querySelectorAll("span[aria-hidden='true'] > i");
    expect(petals).toHaveLength(4);
    expect(screen.getAllByText("Taste Inbox R&D")).toHaveLength(1);
  });
});
