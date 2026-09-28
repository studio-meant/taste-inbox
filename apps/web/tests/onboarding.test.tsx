import type { Account, OnboardingRequest, SourceRef } from "@taste-inbox/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutboundLinks } from "@/components/collection/OutboundLinks";
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import { AccountsSection } from "@/components/settings/AccountsSection";
import { MockRepository } from "@/lib/mock/repository";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  router.replace.mockReset();
});

const blank = { name: "", github: "", huggingface: "" };

function form(submit = vi.fn().mockResolvedValue({ ok: true, message: "" })) {
  render(<OnboardingForm initial={blank} returning={false} onSubmit={submit} />);
  return submit;
}

describe("first-run onboarding", () => {
  it("asks a name and an account, and nothing else", () => {
    form();

    expect(screen.getByRole("heading", { level: 1, name: "시작하기" })).toBeInTheDocument();
    expect(screen.getByLabelText(/이름/)).toHaveValue("");
    expect(screen.getByLabelText("GitHub")).toBeInTheDocument();
    expect(screen.getByLabelText("Hugging Face")).toBeInTheDocument();
    /*
     * The collection interval is not asked on a first run (2026-09-28). The service
     * applies its default when the field is absent, and it is a control on Settings from
     * the first minute — a first screen should ask only what it cannot proceed without.
     */
    expect(screen.queryByLabelText("수집 주기")).toBeNull();
  });

  it("needs a name before anything is sent", async () => {
    const submit = form();

    await userEvent.type(screen.getByLabelText("GitHub"), "ohsuz");
    await userEvent.click(screen.getByRole("button", { name: /시작하기/ }));

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText("이름을 입력해 주세요.")).toBeInTheDocument();
  });

  it("needs GitHub or Hugging Face — either one", async () => {
    const submit = form();

    await userEvent.type(screen.getByLabelText(/이름/), "Suzie");
    await userEvent.click(screen.getByRole("button", { name: /시작하기/ }));
    expect(submit).not.toHaveBeenCalled();
    expect(
      screen.getByText("GitHub와 Hugging Face 중 하나 이상의 계정명을 입력해 주세요."),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Hugging Face"), "ohsuz");
    await userEvent.click(screen.getByRole("button", { name: /시작하기/ }));
    expect(submit).toHaveBeenCalledWith({
      name: "Suzie",
      github: "",
      huggingface: "ohsuz",
    } satisfies OnboardingRequest);
    expect(router.replace).toHaveBeenCalledWith("/today");
  });

  it("puts the service's refusal under the field it belongs to", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: false,
      message: "'oh suz'는 GitHub 계정명 형식이 아니에요.",
      field: "github",
    });
    form(submit);

    await userEvent.type(screen.getByLabelText(/이름/), "Suzie");
    await userEvent.type(screen.getByLabelText("GitHub"), "oh suz");
    await userEvent.click(screen.getByRole("button", { name: /시작하기/ }));

    const input = screen.getByLabelText("GitHub");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("'oh suz'는 GitHub 계정명 형식이 아니에요.");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("mock onboarding", () => {
  it("stores the name and the accounts, and collects nothing", async () => {
    const repository = new MockRepository();

    const result = await repository.completeOnboarding({
      name: "수지",
      github: "ohsuz",
      huggingface: "",
    });

    expect(result.profile).toEqual({ name: "수지", onboarded: true });
    expect(result.jobIds).toEqual([]);
    expect(result.accounts.find((row) => row.platform === "github")?.handle).toBe("ohsuz");
  });

  it("refuses without either account", async () => {
    await expect(
      new MockRepository().completeOnboarding({
        name: "수지",
        github: " ",
        huggingface: "",
      }),
    ).rejects.toThrow(/하나 이상의 계정명/);
  });
});

describe("Settings account cards", () => {
  const accounts = async (): Promise<Account[]> => {
    const repository = new MockRepository();
    await repository.connectAccount("github", "ohsuz");
    return [...(await repository.getAccounts()).accounts];
  };

  it("draws GitHub and Hugging Face separately, connected or not", async () => {
    render(
      <AccountsSection
        accounts={await accounts()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onCollect={vi.fn()}
      />,
    );

    const github = screen.getByRole("article", { name: /GitHub/ });
    const hf = screen.getByRole("article", { name: /Hugging Face/ });
    expect(within(github).getByText("연결됨")).toBeInTheDocument();
    expect(within(github).getByLabelText("계정명")).toHaveValue("ohsuz");
    expect(within(hf).getByText("연결 안 됨")).toBeInTheDocument();
    expect(within(hf).queryByRole("button", { name: "지금 수집" })).not.toBeInTheDocument();
  });

  it("says whether a token is set and never asks for one", async () => {
    render(
      <AccountsSection
        accounts={await accounts()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onCollect={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/\.env의 (GITHUB_TOKEN|HF_TOKEN)/)).toHaveLength(2);
    expect(screen.queryByLabelText(/토큰/)).not.toBeInTheDocument();
  });

  it("connects by name", async () => {
    const connect = vi.fn().mockResolvedValue({ ok: true, message: "저장했어요." });
    render(
      <AccountsSection
        accounts={await accounts()}
        onConnect={connect}
        onDisconnect={vi.fn()}
        onCollect={vi.fn()}
      />,
    );

    const hf = screen.getByRole("article", { name: /Hugging Face/ });
    await userEvent.type(within(hf).getByLabelText("계정명"), "ohsuz");
    await userEvent.click(within(hf).getByRole("button", { name: "연결" }));

    expect(connect).toHaveBeenCalledWith("huggingface", "ohsuz");
    expect(await within(hf).findByRole("status")).toHaveTextContent("저장했어요.");
  });
});

describe("the Inbox card's links", () => {
  const source: SourceRef = {
    platform: "huggingface",
    label: "Hugging Face",
    originalUrl: "https://huggingface.co/papers/2607.11699",
    actionType: "upvote",
    firstSeenAt: "2026-09-28T00:00:00Z",
  };
  const link = (id: string, url: string, label: string) => ({
    id,
    url,
    label,
    kind: "artifact" as const,
    origin: "post" as const,
    via: null,
  });

  it("draws the permalink as a host, like every other link", () => {
    render(
      <OutboundLinks
        links={[link("a", "https://github.com/QwenLM/Qwen-Music", "github.com")]}
        source={source}
        showHeading={false}
        compact={3}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(
      links.map((node) => node.querySelector("span:not(.visually-hidden)")?.textContent),
    ).toEqual(["huggingface.co", "github.com"]);
    // The signal is still said — to a screen reader and on hover.
    expect(links[0]).toHaveAccessibleName(/Hugging Face 업보트/);
    expect(screen.queryByText("Hugging Face 업보트")).not.toBeInTheDocument();
  });

  it("draws three and counts the rest instead of clipping them", () => {
    render(
      <OutboundLinks
        links={["a", "b", "c", "d"].map((id) =>
          link(id, `https://${id}.example/x`, `${id}.example`),
        )}
        source={source}
        showHeading={false}
        compact={3}
      />,
    );

    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
