import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollRestore } from "@/components/collection/ScrollRestore";

vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(),
}));

describe("ScrollRestore", () => {
  let frames: FrameRequestCallback[];
  let scrollToMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    frames = [];
    Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    scrollToMock = vi.fn((options: ScrollToOptions | number, y?: number) => {
      const top = typeof options === "number" ? (y ?? 0) : (options.top ?? 0);
      Object.defineProperty(window, "scrollY", {
        value: top,
        writable: true,
        configurable: true,
      });
    });
    window.scrollTo = scrollToMock;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function paint(): void {
    const callback = frames.shift();
    if (callback)
      act(() => {
        callback(0);
      });
  }

  it("restores after Next and the board have both painted", () => {
    sessionStorage.setItem("taste-inbox:scroll:/library", "640");

    render(<ScrollRestore />);
    paint();
    expect(scrollToMock).not.toHaveBeenCalled();
    paint();

    expect(scrollToMock).toHaveBeenCalledWith({ top: 640, behavior: "instant" });
  });

  it("saves before item navigation and does not overwrite it during unmount", () => {
    const { unmount } = render(
      <>
        <ScrollRestore />
        <a
          href="/items/track-1"
          onClick={(event) => {
            event.preventDefault();
          }}
        >
          상세 보기
        </a>
      </>,
    );
    Object.defineProperty(window, "scrollY", { value: 512, writable: true, configurable: true });

    fireEvent.click(document.querySelector('a[href="/items/track-1"]')!);
    expect(sessionStorage.getItem("taste-inbox:scroll:/library")).toBe("512");

    Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
    unmount();
    expect(sessionStorage.getItem("taste-inbox:scroll:/library")).toBe("512");
  });
});
