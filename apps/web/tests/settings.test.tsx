import type { SettingsDocument, SettingsPatchRequest } from "@taste-inbox/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SETTING_FIELDS } from "@/components/settings/fields";
import type { SaveSettings } from "@/components/settings/fields";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { MockSettingsStore } from "@/lib/mock/settings";

/**
 * The Settings screen exists to answer one question no other screen can: *is this value mine,
 * or is it just what shipped?* Most of what follows is written against that.
 *
 * The rest holds it to not lying about timing. The collection interval is baked into launchd
 * plists, so saving it changes nothing about the jobs currently loaded — a screen that says
 * only "저장됨" would be stating something false about a schedule the user is relying on.
 */

const STAMP = "2026-08-09T19:00:00.000Z";

function store(): MockSettingsStore {
  return new MockSettingsStore(STAMP);
}

function document_(): SettingsDocument {
  return store().read();
}

function withChange(changes: SettingsPatchRequest["changes"]): SettingsDocument {
  const it = store();
  it.apply(changes);
  return it.read();
}

// Typed as the real callbacks rather than as bare thunks, so `vi.fn` keeps their arity and
// a test can assert what was actually sent.
const accepted: SaveSettings = () => Promise.resolve({ ok: true, settings: document_() });

function show(settings: SettingsDocument = document_(), onSave = accepted) {
  return render(<SettingsForm settings={settings} onSave={onSave} />);
}

/** The `<li>` a given setting lives in, found by its visible label. */
function row(label: string): HTMLElement {
  const found = screen.getByText(label).closest("li");
  if (found === null) {
    throw new Error(`no settings row for ${label}`);
  }
  return found;
}

function interval(): HTMLElement {
  return within(row("수집 간격")).getByRole("spinbutton");
}

describe("Where a value came from", () => {
  it("marks a value the user changed, in words and not only in colour", () => {
    // CLAUDE.md §6 forbids a colour-only status, and this is the screen's primary signal.
    show(withChange({ "collection.intervalHours": 6 }));
    expect(within(row("수집 간격")).getByText("직접 바꾼 값")).toBeInTheDocument();
  });

  it("does not mark a value nobody has touched", () => {
    show();
    expect(within(row("수집 간격")).queryByText("직접 바꾼 값")).not.toBeInTheDocument();
  });

  it("separates what the config file set from what the product decided", () => {
    // `config/app.yaml` pins the interval; `ceremonial_entry` is absent from it and falls
    // through to the schema default. Both are "not mine", and the difference matters: one
    // is a choice somebody already made in a file, the other is what shipped.
    const settings = document_();
    expect(settings.collection.intervalHours.origin).toBe("file");
    expect(settings.general.ceremonialEntry.origin).toBe("default");

    show(settings);
    expect(within(row("수집 간격")).getByText("설정 파일 값")).toBeInTheDocument();
    expect(within(row("시작 연출")).getByText("기본값")).toBeInTheDocument();
  });

  it("has no section for settings that do not exist yet", () => {
    // "아직 없는 설정" and the feature flags that described collectors never built went on
    // 2026-09-28, with the debug retention only a browser collector read.
    show();
    for (const gone of ["기능 플래그", "기록 정리", "LinkedIn 수집기", "실패 캡처 보관 기간"]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
  });
});

describe("When a change takes effect", () => {
  it("says an interval change applies from the next collection", () => {
    // The in-app scheduler reads the interval every minute (2026-09-28), so a change lands
    // with the next collection rather than waiting for launchd jobs to be reinstalled.
    show();
    expect(within(row("수집 간격")).getByText("다음 수집부터")).toBeInTheDocument();
  });

  it("says a manual-refresh change applies at once", () => {
    show();
    expect(within(row("지금 수집 허용")).getByText("즉시 적용")).toBeInTheDocument();
  });

  it("gives every editable setting a timing statement", () => {
    // PAGE_SPECIFICATIONS.md §11 acceptance: "설정 효과가 즉시 또는 next run으로 명확히
    // 구분". One control without it is one control that reads as instant.
    //
    // Derived from the document rather than listed, so a field that becomes editable later
    // is covered the day it does. Hardcoding the list is how this test first passed while
    // asserting nothing about `실패 캡처 보관 기간`, which is read-only.
    const settings = document_();
    show(settings);
    const editable = SETTING_FIELDS.filter((field) => field.read(settings).editable);
    expect(editable.length).toBeGreaterThan(0);
    for (const field of editable) {
      expect(
        within(row(field.label)).getByText(/^(즉시 적용|다음 수집부터|다음 설치부터)$/),
      ).toBeInTheDocument();
    }
  });

  it("does not claim a timing for a value that cannot be changed", () => {
    // 즉시 적용 next to a fixed value would answer a question nobody can ask.
    show();
    const fixed = row("시간대");
    expect(within(fixed).getByText("고정됨")).toBeInTheDocument();
    expect(
      within(fixed).queryByText(/^(즉시 적용|다음 수집부터|다음 설치부터)$/),
    ).not.toBeInTheDocument();
  });
});

describe("What this screen cannot do", () => {
  it("shows a fixed setting as text rather than as an input", () => {
    const settings = document_();
    expect(settings.general.timezone.editable).toBe(false);
    show(settings);
    expect(within(row("시간대")).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(row("시간대")).getByText(settings.general.timezone.value)).toBeInTheDocument();
  });
});

describe("Saving", () => {
  it("sends only what was actually changed", async () => {
    const onSave = vi.fn(accepted);
    show(document_(), onSave);

    fireEvent.change(interval(), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: /저장/ }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[0]).toEqual({ "collection.intervalHours": 6 });
  });

  it("batches the pair the cross-field rule is about into one request", async () => {
    // `stagger × 2 < interval × 60` is a statement about a *pair*. Sending each control as
    // it changes would refuse a user halfway through an edit that is legal as a whole.
    const onSave = vi.fn(accepted);
    show(document_(), onSave);

    fireEvent.change(interval(), { target: { value: "8" } });
    fireEvent.change(within(row("수집기 사이 간격")).getByRole("spinbutton"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /저장/ }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      "collection.intervalHours": 8,
      "collection.staggerMinutes": 10,
    });
  });

  it("shows the service's own words when a change is refused", async () => {
    // The API states the cross-field refusal in Korean and names the offending pair. There
    // is nowhere else for the user to read why the save did not happen.
    const refused: SaveSettings = () =>
      Promise.resolve({
        ok: false,
        message: "수집 주기를 1시간으로 줄이면 수집기 사이 간격이 한 주기를 넘어서요.",
      });
    show(document_(), refused);

    fireEvent.change(interval(), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /저장/ }));

    expect(await screen.findByText(/한 주기를 넘어서요/)).toBeInTheDocument();
  });

  it("keeps the rejected edit on screen so it can be corrected", async () => {
    // Discarding it would make the error message advice about a value the user can no
    // longer see.
    const refused: SaveSettings = () => Promise.resolve({ ok: false, message: "안 돼요." });
    show(document_(), refused);

    fireEvent.change(interval(), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /저장/ }));

    await screen.findByText("안 돼요.");
    expect(interval()).toHaveValue(1);
  });

  it("announces the outcome rather than only redrawing", async () => {
    show(document_(), () =>
      Promise.resolve({ ok: true, settings: withChange({ "collection.intervalHours": 6 }) }),
    );
    fireEvent.change(interval(), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: /저장/ }));

    await waitFor(() => {
      const said = screen.getAllByRole("status").map((node) => node.textContent);
      expect(said.join(" ")).toMatch(/저장/);
    });
  });

  it("cannot be saved when nothing has been changed", () => {
    show();
    expect(screen.getByRole("button", { name: /저장/ })).toBeDisabled();
  });

  it("says a change is unsaved while it is still only typed in", () => {
    show();
    fireEvent.change(interval(), { target: { value: "6" } });
    expect(within(row("수집 간격")).getByText("저장 안 됨")).toBeInTheDocument();
  });
});
