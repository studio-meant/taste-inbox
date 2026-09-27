import { StyleMatchGradeSchema } from "@taste-inbox/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StyleMatchPill } from "@/components/items/DomainStatusPill";
import { STYLE_MATCH, STYLE_MATCH_FILTERS } from "@/lib/status/registry";

describe("Style match registry", () => {
  it("covers every grade", () => {
    expect(Object.keys(STYLE_MATCH).sort()).toEqual([...StyleMatchGradeSchema.options].sort());
  });

  it("matches DESIGN.md §5.4 Korean copy", () => {
    expect(STYLE_MATCH.exact.label).toBe("정확히 확인됨");
    expect(STYLE_MATCH.likely.label).toBe("유력한 후보");
    expect(STYLE_MATCH.similar.label).toBe("유사 상품");
    expect(STYLE_MATCH.unknown.label).toBe("확인 필요");
  });

  it("never presents a guess with the tone of a confirmed fact", () => {
    // DESIGN.md §3.5 — trust over confidence.
    expect(STYLE_MATCH.exact.tone).toBe("ready");
    expect(STYLE_MATCH.likely.tone).not.toBe("ready");
    expect(STYLE_MATCH.similar.tone).not.toBe("ready");
    expect(STYLE_MATCH.unknown.tone).not.toBe("ready");
  });

  it("shows all four grades as filters", () => {
    expect(STYLE_MATCH_FILTERS).toHaveLength(4);
  });
});

describe("DomainStatusPill", () => {
  it("renders English pill text with the Korean name as the accessible name", () => {
    // Measured, not read off the attribute: the aria-label used to sit on a role-less
    // <span>, where it is prohibited and the computed name is "Exact match" instead.
    render(<StyleMatchPill grade="exact" />);
    const pill = screen.getByRole("img");

    expect(pill).toHaveAccessibleName("정확히 확인됨");
    expect(pill).toHaveTextContent("Exact match");
  });

  it("marks the English text with lang so a Korean reader pronounces it correctly", () => {
    const { container } = render(<StyleMatchPill grade="unknown" />);
    expect(container.querySelector('[lang="en"]')).toHaveTextContent("Not identified");
  });

  it("renders a style grade", () => {
    render(<StyleMatchPill grade="likely" />);
    const pill = screen.getByRole("img");

    expect(pill).toHaveAccessibleName("유력한 후보");
    expect(pill).toHaveTextContent("Likely match");
  });
});
