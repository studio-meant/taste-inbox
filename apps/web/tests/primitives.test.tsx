import { Sparkles } from "lucide-react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Button,
  CardSurface,
  EmptyState,
  ErrorState,
  IconButton,
  Meter,
  SignalChip,
  Skeleton,
  StatusPill,
  VisuallyHidden,
} from "@/components/primitives";

describe("Button", () => {
  it("defaults to a non-submitting button", () => {
    // A button inside a form that submits by accident is a real data-loss path.
    render(<Button>실행</Button>);
    expect(screen.getByRole("button", { name: "실행" })).toHaveAttribute("type", "button");
  });

  it("fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>실행</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is activated by keyboard", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>실행</Button>);
    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("announces and blocks while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        준비
      </Button>,
    );
    const button = screen.getByRole("button");

    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    // The label stays in the DOM so the width cannot change mid-action.
    expect(button).toHaveTextContent("준비");
    expect(screen.getByText("처리 중")).toBeInTheDocument();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("hides its icon from assistive technology", () => {
    render(<Button icon={Sparkles}>추천</Button>);
    // The visible label already carries the meaning.
    expect(screen.getByRole("button", { name: "추천" })).toBeInTheDocument();
  });
});

describe("IconButton", () => {
  it("requires and exposes an accessible name", () => {
    render(<IconButton icon={Sparkles} label="추천 보기" />);
    expect(screen.getByRole("button", { name: "추천 보기" })).toBeInTheDocument();
  });
});

describe("StatusPill", () => {
  it("renders the label as text, never colour alone", () => {
    render(<StatusPill tone="ready">Ready · Local</StatusPill>);
    expect(screen.getByText("Ready · Local")).toBeInTheDocument();
  });

  it.each(["ready", "info", "warning", "danger", "neutral"] as const)(
    "renders an icon alongside the label for %s",
    (tone) => {
      const { container } = render(<StatusPill tone={tone}>상태</StatusPill>);
      // The icon is the second channel; every tone must have one.
      expect(container.querySelector("svg")).not.toBeNull();
      expect(screen.getByText("상태")).toBeInTheDocument();
    },
  );

  it("accepts an explicit accessible name for abbreviated labels", () => {
    // The name is computed, not just present as an attribute: on a role-less <span>
    // aria-label is prohibited and browsers ignore it, so the pill announced "토큰 필요".
    render(
      <StatusPill tone="warning" ariaLabel="토큰이 필요합니다">
        토큰 필요
      </StatusPill>,
    );
    expect(screen.getByRole("img")).toHaveAccessibleName("토큰이 필요합니다");
  });

  it("stays a role-less span when no name is given, so it is read inline", () => {
    // An unnamed role="img" would be a violation of its own, and the visible label is
    // already the second channel.
    render(<StatusPill tone="ready">Ready · Local</StatusPill>);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("SignalChip", () => {
  it("is a plain span when not interactive", () => {
    render(<SignalChip>GitHub</SignalChip>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });

  it("exposes selection through aria-pressed when interactive", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <SignalChip selected={false} onClick={onClick}>
        GitHub
      </SignalChip>,
    );
    const chip = screen.getByRole("button", { name: /GitHub/ });
    expect(chip).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <SignalChip selected onClick={onClick}>
        GitHub
      </SignalChip>,
    );
    expect(screen.getByRole("button", { name: /GitHub/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("formats the count for the Korean locale", () => {
    render(<SignalChip count={1234}>GitHub</SignalChip>);
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });
});

describe("Meter", () => {
  it("reports the measurement to assistive technology", () => {
    render(<Meter label="예상 최대 메모리" value={6.4} max={7.68} unit="GB" tone="ready" />);
    const meter = screen.getByRole("meter", { name: "예상 최대 메모리" });

    expect(meter).toHaveAttribute("aria-valuenow", "6.4");
    expect(meter).toHaveAttribute("aria-valuemax", "7.68");
    expect(meter).toHaveAttribute("aria-valuetext", "6.4 GB / 7.68 GB");
  });

  it("states an over-budget value instead of silently clipping it", () => {
    render(<Meter label="예상 최대 메모리" value={40} max={7.68} unit="GB" tone="danger" />);
    expect(screen.getByRole("meter")).toHaveAttribute(
      "aria-valuetext",
      "40 GB / 7.68 GB · 예산 초과",
    );
  });

  it("renders an unknown state rather than a zero-length bar", () => {
    // DESIGN.md §3.5 — an unmeasured value must not look like a measured zero.
    render(<Meter label="예상 최대 메모리" value={null} max={null} />);
    const meter = screen.getByRole("meter");

    expect(meter).not.toHaveAttribute("aria-valuenow");
    expect(meter).toHaveAttribute("aria-valuetext", "확인 필요");
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
  });

  it("treats a zero maximum as unknown", () => {
    render(<Meter label="디스크" value={5} max={0} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuetext", "확인 필요");
  });

  it("renders a verdict slot next to the label", () => {
    render(
      <Meter
        label="예상 최대 메모리"
        value={2}
        max={8}
        unit="GB"
        verdict={<StatusPill tone="ready">여유 있음</StatusPill>}
      />,
    );
    expect(screen.getByText("여유 있음")).toBeInTheDocument();
  });
});

describe("CardSurface", () => {
  it("renders the requested semantic element", () => {
    render(
      <CardSurface as="article" aria-label="항목">
        내용
      </CardSurface>,
    );
    expect(screen.getByRole("article", { name: "항목" })).toBeInTheDocument();
  });

  it("passes through arbitrary attributes", () => {
    render(<CardSurface data-testid="card">내용</CardSurface>);
    expect(screen.getByTestId("card")).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive technology", () => {
    // The surrounding region announces loading once; placeholders stay silent.
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("reserves an aspect ratio without forcing a height", () => {
    const { container } = render(<Skeleton shape="media" aspectRatio="4 / 5" />);
    const node = container.firstElementChild as HTMLElement;
    expect(node.style.aspectRatio).toBe("4 / 5");
    expect(node.style.height).toBe("");
  });
});

describe("EmptyState and ErrorState", () => {
  it("renders the empty title at the requested heading level", () => {
    render(
      <EmptyState as="h2" title="아직 항목이 없어요" description="수집이 끝나면 채워집니다." />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "아직 항목이 없어요" }),
    ).toBeInTheDocument();
  });

  it("stays silent to assistive technology by default", () => {
    // DESIGN.md §18 restricts aria-live to cases that need it. A boundary that
    // replaces a page is already announced by the page change itself.
    render(<ErrorState as="h2" title="불러오지 못했어요" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces politely — never assertively — when asked to", () => {
    render(<ErrorState as="h2" title="수집이 중단됐어요" live />);
    // `role="status"` is polite; `role="alert"` would interrupt the user.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps technical detail collapsed", () => {
    render(<ErrorState as="h2" title="불러오지 못했어요" detail="ECONNREFUSED 127.0.0.1:8787" />);
    const details = screen.getByText("기술 정보 보기").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });
});

describe("VisuallyHidden", () => {
  it("keeps content in the accessibility tree", () => {
    render(<VisuallyHidden>스크린 리더 전용</VisuallyHidden>);
    expect(screen.getByText("스크린 리더 전용")).toBeInTheDocument();
  });
});
