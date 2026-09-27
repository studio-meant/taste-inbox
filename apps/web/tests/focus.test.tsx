import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FocusPayloadSchema, type FocusPayload } from "@taste-inbox/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FocusCanvas } from "@/components/focus/FocusCanvas";
import { canvasState, jobDuration } from "@/components/focus/focus-state";
import { RepoProvenanceBadge } from "@/components/paper/PaperBundleCard";
import { MockRepository } from "@/lib/mock/repository";

/**
 * The Focus Canvas, rendered from the payloads the service itself produced.
 *
 * `data/fixtures/focus/*.json` are written by `apps/api/tests/test_focus_contract.py` from
 * the real endpoint and validated by `packages/shared` against the schema — so what is
 * drawn here is what the live screen gets, not a sample someone typed to please the
 * component.
 */

const actions = vi.hoisted(() => ({
  requestResearch: vi.fn(),
  approveTrial: vi.fn(),
}));
vi.mock("@/app/(workspace)/focus/actions", () => actions);

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function golden(name: string): FocusPayload {
  // Relative to this file, not the working directory: the suite runs from `apps/web` alone
  // and from the repository root as one workspace. `import.meta.url` is a `/@fs/` URL here.
  const path = join(__dirname, "..", "..", "..", "data", "fixtures", "focus", `${name}.json`);
  return FocusPayloadSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

beforeEach(() => {
  actions.requestResearch.mockReset();
  actions.approveTrial.mockReset();
  router.refresh.mockReset();
});

describe("an item nobody has researched", () => {
  const payload = golden("repo-unresearched");

  it("says so, and says what would leave the machine and to where", () => {
    render(<FocusCanvas payload={payload} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "debpalash/VoiceStudio" }),
    ).toBeInTheDocument();
    expect(screen.getByText("조사 전")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:8010 (이 기계)")).toBeInTheDocument();
    expect(screen.getByText("보낼 질문 원문 보기")).toBeInTheDocument();
    // The exact brief, not a paraphrase of it.
    expect(
      screen.getByText(/^Subject: debpalash\/VoiceStudio \(repo, github\)/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI-Q로 조사하기" })).toBeEnabled();
    // No plan yet, so nothing to approve.
    expect(screen.queryByRole("button", { name: /Try safely/ })).not.toBeInTheDocument();
  });

  it("starts research through the server action and shows where it went", async () => {
    actions.requestResearch.mockResolvedValue({
      ok: true,
      message: "조사 질의를 http://localhost:8010 (이 기계) 로 보냅니다.",
      jobId: "research-1",
    });
    render(<FocusCanvas payload={payload} />);

    await userEvent.click(screen.getByRole("button", { name: "AI-Q로 조사하기" }));

    expect(actions.requestResearch).toHaveBeenCalledWith(payload.item.id);
    expect(await screen.findByRole("status")).toHaveTextContent("http://localhost:8010");
  });

  it("disables research with the reason when there is no backend to send to", () => {
    render(
      <FocusCanvas
        payload={{
          ...payload,
          outbound: {
            ...payload.outbound,
            serverUrl: null,
            local: null,
            error: "AIQ_SERVER_URL이 설정되지 않았습니다.",
          },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "AI-Q로 조사하기" })).toBeDisabled();
    expect(screen.getByText("AIQ_SERVER_URL이 설정되지 않았습니다.")).toBeInTheDocument();
  });
});

describe("a plan waiting for approval", () => {
  const payload = golden("repo-awaiting-approval");

  it("shows the report verbatim with its URLs as links", () => {
    render(<FocusCanvas payload={payload} />);

    expect(screen.getByText("승인 대기")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "https://voicestudio.sh/download" });
    expect(link).toHaveAttribute("href", "https://voicestudio.sh/download");
    expect(screen.getByText(/인용과 URL을 자르지 않았어요/)).toBeInTheDocument();
  });

  it("states what opens and what the report cannot open", () => {
    render(<FocusCanvas payload={payload} />);

    expect(
      screen.getByText("리포트가 제시한 방법 3가지 중 샌드박스에서 되는 것부터 시도하기"),
    ).toBeInTheDocument();
    const action = screen.getByRole("region", { name: "다음 한 걸음" });
    expect(within(action).getByText("github.com")).toBeInTheDocument();
    expect(
      within(action).getByText("voicestudio.sh, www.remio.ai, tessl.io, hoangyell.com"),
    ).toBeInTheDocument();
  });

  it("asks for approval with the terms in front of it before anything runs", async () => {
    actions.approveTrial.mockResolvedValue({
      ok: true,
      message: "샌드박스 'taste-inbox'에서 실행을 시작했어요.",
      jobId: "trial-1",
    });
    render(<FocusCanvas payload={payload} />);

    await userEvent.click(screen.getByRole("button", { name: /Try safely/ }));
    expect(actions.approveTrial).not.toHaveBeenCalled();

    const terms = screen.getByRole("group", { name: "이렇게 실행합니다" });
    expect(terms).toHaveFocus();
    expect(within(terms).getByText(/이 Mac의 파일은 샌드박스에 보이지 않아요/)).toBeInTheDocument();
    expect(within(terms).getByText("taste-inbox")).toBeInTheDocument();

    await userEvent.click(within(terms).getByRole("button", { name: "승인하고 실행" }));

    expect(actions.approveTrial).toHaveBeenCalledWith(payload.item.id);
    expect(await screen.findByRole("status")).toHaveTextContent("실행을 시작했어요");
  });

  it("cancels on Escape and returns focus to the button", async () => {
    render(<FocusCanvas payload={payload} />);
    await userEvent.click(screen.getByRole("button", { name: /Try safely/ }));

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("group", { name: "이렇게 실행합니다" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try safely/ })).toHaveFocus();
    expect(actions.approveTrial).not.toHaveBeenCalled();
  });
});

describe("a trial that did not finish", () => {
  const payload = golden("repo-trial-timed-out");

  it("is not called a success", () => {
    render(<FocusCanvas payload={payload} />);

    expect(screen.getAllByText("차단됨 · 확인 필요").length).toBeGreaterThan(0);
    const trial = screen.getByRole("region", { name: "샌드박스 실행 결과" });
    expect(within(trial).getByText("일부만 완료")).toBeInTheDocument();
    expect(within(trial).getByText("50회")).toBeInTheDocument();
    expect(within(trial).getByText("aborted")).toBeInTheDocument();
    expect(within(trial).getAllByText(/LLM request timed out\./).length).toBeGreaterThan(0);
  });

  it("puts the refused connection in the ledger as a finding", () => {
    render(<FocusCanvas payload={payload} />);

    const ledger = screen.getByRole("region", { name: "Policy ledger" });
    expect(within(ledger).getByText("voicestudio.sh")).toBeInTheDocument();
    expect(within(ledger).getByText(/연결하려다 정책에 막혔어요/)).toBeInTheDocument();
    // Hosts and the programs allowed to reach them, as pairs.
    expect(within(ledger).getByText("갈 수 있는 프로그램: /usr/bin/git")).toBeInTheDocument();
  });

  it("says which program was refused and why, from the sandbox's own log", () => {
    render(<FocusCanvas payload={payload} />);

    const ledger = screen.getByRole("region", { name: "Policy ledger" });
    // Open to git, refused to uv: the finding people do not expect.
    expect(
      within(ledger).getByText(
        "이 호스트는 'brew' 정책에 열려 있지만, 이 프로그램에는 열려 있지 않아요.",
      ),
    ).toBeInTheDocument();
    expect(within(ledger).getByText("어느 정책도 이 호스트를 열지 않아요.")).toBeInTheDocument();
    expect(within(ledger).getAllByText("/sandbox/.local/bin/uv")).toHaveLength(2);
    expect(within(ledger).getAllByText(/· 4회/)).toHaveLength(2);
  });

  it("lists what the run left behind", () => {
    render(<FocusCanvas payload={payload} />);

    const files = screen.getByRole("region", { name: "Related files" });
    expect(within(files).getByText("plan.md")).toBeInTheDocument();
  });
});

describe("a sandbox that is down", () => {
  it("disables Try safely and gives the runtime's own reason", () => {
    render(<FocusCanvas payload={golden("repo-sandbox-down")} />);

    expect(screen.getByRole("button", { name: /Try safely/ })).toBeDisabled();
    expect(
      screen.getByText(/docker_unreachable: Docker daemon is not reachable\./),
    ).toBeInTheDocument();
  });
});

describe("a paper", () => {
  it("draws its bundle with who linked the code", () => {
    render(<FocusCanvas payload={golden("paper-bundle")} />);

    const bundle = screen.getByRole("region", { name: "논문에서 이어지는 것" });
    expect(within(bundle).getByText("공식 저장소 · 저자가 연결")).toBeInTheDocument();
    expect(within(bundle).getByText("· Model 521")).toBeInTheDocument();
    expect(within(bundle).getByText("· Demo 4,297")).toBeInTheDocument();
    expect(within(bundle).getByText("외 4,297개")).toBeInTheDocument();
  });

  it("never draws a Hub match like an author's link", () => {
    const { rerender } = render(<RepoProvenanceBadge provenance="author-linked" />);
    const official = screen.getByText("공식 저장소 · 저자가 연결").className;
    rerender(<RepoProvenanceBadge provenance="auto-linked" />);
    const matched = screen.getByText("Hub 자동 연결 · 확인 필요").className;

    expect(matched).not.toEqual(official);
  });
});

describe("canvas state", () => {
  it("lets the newest state win", () => {
    const base = golden("repo-trial-timed-out");
    expect(canvasState(base).label).toBe("차단됨 · 확인 필요");

    const running = {
      ...base,
      jobs: {
        ...base.jobs,
        trial: base.jobs.trial && { ...base.jobs.trial, state: "running" as const },
      },
    };
    expect(canvasState(running)).toEqual({ label: "샌드박스 실행 중", tone: "info", moving: true });
  });

  it("re-reads the route only while something is moving", () => {
    vi.useFakeTimers();
    const base = golden("repo-awaiting-approval");
    const researching = {
      ...base,
      jobs: {
        ...base.jobs,
        research: base.jobs.research && { ...base.jobs.research, state: "running" as const },
      },
    };
    const { unmount } = render(<FocusCanvas payload={researching} />);
    vi.advanceTimersByTime(4000);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    unmount();

    render(<FocusCanvas payload={base} />);
    vi.advanceTimersByTime(8000);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("measures a job by its own stamps", () => {
    expect(
      jobDuration({
        id: "j",
        state: "succeeded",
        currentStep: null,
        createdAt: "2026-09-28T00:00:00Z",
        startedAt: "2026-09-28T00:00:00Z",
        finishedAt: "2026-09-28T00:09:11Z",
        steps: [],
      }),
    ).toBe("9분 11초");
  });
});

describe("mock mode", () => {
  it("draws an honest empty canvas and refuses to reach the runtime", async () => {
    const repository = new MockRepository();
    const { items } = await repository.listAIItems();
    const first = items[0];
    if (first === undefined) throw new Error("no fixture item");

    const payload = await repository.getFocus(first.id);

    expect(payload?.research).toBeNull();
    expect(payload?.boundary.ready).toBe(false);
    expect(payload?.outbound.error).toMatch(/목업 데이터 모드/);
    await expect(repository.startResearch()).rejects.toThrow(/목업 데이터 모드/);
    await expect(repository.getFocus("no-such-item")).resolves.toBeNull();
  });
});
