import { render, screen, fireEvent } from "@testing-library/react";
import type * as MockRepositoryModule from "@/lib/mock/repository";
import { afterEach, describe, expect, it, vi } from "vitest";

const writes = vi.hoisted(() => ({
  add: vi.fn(),
  move: vi.fn(),
  settings: vi.fn(),
  source: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
const { MockRepository } =
  await vi.importActual<typeof MockRepositoryModule>("@/lib/mock/repository");
vi.mock("@/lib/repository", () => ({
  ApiDataError: class extends Error {},
  getRepository: () => ({
    createManualItem: writes.add,
    setItemBoard: writes.move,
    updateSettings: writes.settings,
    updateSourceSetting: writes.source,
    connectAccount: writes.connect,
    getHostProfile: () => new MockRepository().getHostProfile(),
    getResourcePolicy: () => new MockRepository().getResourcePolicy(),
    getBoardCounts: () => new MockRepository().getBoardCounts(),
    listJobs: () => Promise.resolve([]),
    getLaunchdPlan: () => new MockRepository().getLaunchdPlan(),
  }),
  resolveDataSource: () => "mock",
}));

import { BoardPicker } from "@/components/collection/BoardPicker";
import { addManualItem, moveItemToBoard } from "@/app/(workspace)/actions";
import { connectAccount, saveSettings } from "@/app/settings/actions";
import SettingsPage from "@/app/settings/page";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("remote viewing does not pretend edits are available", () => {
  it("disables the picker and refuses even a programmatic change event", () => {
    vi.stubEnv("NEXT_PUBLIC_REMOTE_READ_ONLY", "1");
    render(<BoardPicker itemId="fixture" board="style" />);
    const picker = screen.getByRole("combobox");
    expect(picker).toBeDisabled();
    expect(picker).toHaveAttribute("title", expect.stringContaining("읽기 전용"));
    fireEvent.change(picker, { target: { value: "music" } });
    expect(writes.move).not.toHaveBeenCalled();
  });

  it("keeps the desktop/default picker editable", () => {
    vi.stubEnv("NEXT_PUBLIC_REMOTE_READ_ONLY", "0");
    render(<BoardPicker itemId="fixture" board="style" />);
    expect(screen.getByRole("combobox")).not.toBeDisabled();
  });

  it("guards all server actions before touching a repository", async () => {
    vi.stubEnv("NEXT_PUBLIC_REMOTE_READ_ONLY", "1");
    expect((await moveItemToBoard("fixture", "music")).ok).toBe(false);
    expect((await addManualItem({ url: "https://example.com", board: "trends" })).ok).toBe(false);
    expect((await saveSettings({ "collection.intervalHours": 8 })).ok).toBe(false);
    expect((await connectAccount("github", "ohsuz")).ok).toBe(false);
    expect(writes.move).not.toHaveBeenCalled();
    expect(writes.add).not.toHaveBeenCalled();
    expect(writes.settings).not.toHaveBeenCalled();
    expect(writes.connect).not.toHaveBeenCalled();
  });

  it("settings explains where to edit instead of rendering unusable forms", async () => {
    vi.stubEnv("NEXT_PUBLIC_REMOTE_READ_ONLY", "1");
    render(await SettingsPage());
    expect(screen.getByText(/맥미니 앱에서/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /저장/ })).not.toBeInTheDocument();
  });
});
