import {
  AccountsResponseSchema,
  AIItemCardModelSchema,
  EffectiveResourcePolicySchema,
  FocusPayloadSchema,
  HostProfileSchema,
  JobModelSchema,
  ItemDetailModelSchema,
  LaunchdPlanSchema,
  TodayPayloadSchema,
  type OnboardingRequest,
  type OnboardingResponse,
  type Profile,
  type AccountConnectResponse,
  type AccountPlatform,
  type AccountsResponse,
  type AIItemCardModel,
  type EffectiveResourcePolicy,
  type FocusPayload,
  type HostProfile,
  type JobModel,
  type ItemDetailModel,
  type ManualItemCreateRequest,
  type ManualItemCreateResponse,
  type LaunchdPlan,
  type ResearchStartResponse,
  type SettingsDocument,
  type SettingsPatchRequest,
  type TodayPayload,
  type QuestionStartResponse,
  type TrialStartResponse,
} from "@taste-inbox/shared";
import hostProfileFixture from "../../../../../data/fixtures/host-profiles/capacity-16gb-512gb.json";
import resourcePolicyFixture from "../../../../../data/fixtures/resource-policy/expected/capacity-16gb-512gb.json";
import {
  DEFAULT_PAGE_SIZE,
  type AIItemQuery,
  type ListQuery,
  type Page,
  type TasteInboxRepository,
} from "../repository/types";
import { ApiDataError } from "../repository/http";
import { localDay } from "../filters/collected-days";
import { MOCK_LAUNCHD_PLAN } from "./launchd";
import { MockSettingRejected, MockSettingsStore } from "./settings";
import { MOCK_AI_ITEMS, MOCK_JOBS } from "./seed";
import { MOCK_TODAY } from "./today";

/**
 * Fixture-backed repository.
 *
 * Three properties matter here:
 *
 * 1. **No secrets.** Mock mode is what a clean checkout runs, so nothing in this file
 *    may require a credential or reach the network (Phase 0 exit criteria).
 * 2. **Same validation as live.** Responses go through the very schemas the HTTP client
 *    will use, so a shape mistake surfaces in mock mode rather than in Phase 2.
 * 3. **No filesystem.** Fixtures are imported statically rather than read at runtime,
 *    so behaviour does not depend on the working directory and the built server carries
 *    its own data.
 *
 * The imported fixtures are the same files `apps/api` resolves against, which is what
 * keeps mock mode honest: the numbers on screen are real resolver output, not invented.
 *
 * Mock mode shows the committed seed and nothing else. It used to read the developer's own
 * Instagram captures out of `var/captures` when they existed; that reader went with
 * Instagram on 2026-09-28, and the live service is how a person sees their own Inbox.
 */

/**
 * Which capacity class mock mode presents. The real host is detected at runtime by the
 * backend; mock mode has to name a fixture, and naming it once here keeps the choice
 * out of the components.
 */
const MOCK_HOST_PROFILE_ID = "capacity-16gb-512gb";

function paginate<T>(
  all: readonly T[],
  query: ListQuery | undefined,
  generatedAt: string,
  origin: Page<T>["origin"],
): Page<T> {
  const limit = query?.limit ?? DEFAULT_PAGE_SIZE;
  // An offset behind an opaque cursor string. The frontend never reads inside it, so the
  // real service is free to use a keyset instead without touching a single component.
  const parsed = query?.cursor == null ? 0 : Number.parseInt(query.cursor, 10);
  const offset = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
  const items = all.slice(offset, offset + limit);
  const next = offset + limit;
  return {
    items,
    nextCursor: next < all.length ? String(next) : null,
    generatedAt,
    origin,
  };
}

/**
 * `?day=` over a fixture list.
 *
 * The same grouping rule the rail's calendar counts with, deliberately from the same
 * function: a mock that split days by UTC date while the calendar split them by Seoul date
 * would show a count of 6 and return 5 items, and the disagreement would look like a bug
 * in the board. The live service converts with `api/today.py::_local_day`, which is the
 * rule this mirrors.
 */
function onDay<T extends { readonly source: { readonly firstSeenAt: string } }>(
  items: readonly T[],
  day: string | undefined,
): readonly T[] {
  return day === undefined
    ? items
    : items.filter((item) => localDay(item.source.firstSeenAt) === day);
}

/** Said wherever mock mode is asked for something only the NVIDIA runtime can answer. */
const MOCK_RUNTIME_MESSAGE =
  "목업 데이터 모드에서는 AI-Q와 샌드박스를 부르지 않아요. `pnpm dev`로 실제 서비스를 띄우면 동작합니다.";

export class MockRepository implements TasteInboxRepository {
  /** Fixed instant so server and client renders agree and snapshots stay stable. */
  private readonly generatedAt = "2026-08-08T07:00:00Z";

  readonly hostProfileFixtureId = MOCK_HOST_PROFILE_ID;

  getToday(): Promise<TodayPayload> {
    return Promise.resolve(TodayPayloadSchema.parse(MOCK_TODAY));
  }

  getHostProfile(): Promise<HostProfile> {
    // Parsing through the public schema also strips `availableMemoryGb`, a
    // backend-internal signal that must not reach the UI.
    return Promise.resolve(HostProfileSchema.parse(hostProfileFixture));
  }

  getResourcePolicy(): Promise<EffectiveResourcePolicy> {
    return Promise.resolve(EffectiveResourcePolicySchema.parse(resourcePolicyFixture));
  }

  private items(): readonly AIItemCardModel[] {
    return MOCK_AI_ITEMS.map((item) => AIItemCardModelSchema.parse(item));
  }

  listAIItems(query?: AIItemQuery): Promise<Page<AIItemCardModel>> {
    let items = this.items();
    if (query?.kind !== undefined && query.kind.length > 0) {
      const wanted = new Set<string>(query.kind);
      items = items.filter((item) => wanted.has(item.kind));
    }
    if (query?.source !== undefined && query.source.length > 0) {
      const wanted = new Set<string>(query.source);
      items = items.filter((item) => wanted.has(item.source.platform));
    }
    items = [...onDay(items, query?.day)];
    return Promise.resolve(paginate(items, query, this.generatedAt, "seed"));
  }

  getItemCount(): Promise<number> {
    return Promise.resolve(this.items().length);
  }

  async getAIItem(id: string): Promise<AIItemCardModel | null> {
    const { items } = await this.listAIItems({ limit: Number.MAX_SAFE_INTEGER });
    return items.find((item) => item.id === id) ?? null;
  }

  getItem(id: string): Promise<ItemDetailModel | null> {
    // Assembled from the card, so mock mode exercises the same page the live path does.
    // The fixture carries no stored observations of its own, so `evidence` is empty.
    const item = this.items().find((candidate) => candidate.id === id);
    if (item === undefined) return Promise.resolve(null);
    return Promise.resolve(
      ItemDetailModelSchema.parse({
        id: item.id,
        kind: item.kind,
        title: item.title,
        body: item.summary,
        source: item.source,
        tags: item.tags,
        links: item.links,
        evidence: [],
        sourcePublishedAt: null,
        checkedAt: item.checkedAt,
        firstSeenAt: item.source.firstSeenAt,
      }),
    );
  }

  /** The URL decides what it is, as it does live (`api/manual_items.py::_platform`). */
  createManualItem(request: ManualItemCreateRequest): Promise<ManualItemCreateResponse> {
    const url = new URL(request.url);
    const host = url.hostname.replace(/^www\./, "");
    const first = url.pathname.split("/").find((segment) => segment !== "") ?? "";
    const [platform, kind] =
      host === "github.com"
        ? (["github", "repo"] as const)
        : host === "huggingface.co"
          ? ([
              "huggingface",
              first === "datasets"
                ? "dataset"
                : first === "spaces"
                  ? "space"
                  : first === "papers"
                    ? "paper"
                    : "model",
            ] as const)
          : host === "arxiv.org"
            ? (["arxiv", "paper"] as const)
            : (["web", "post"] as const);
    const title = request.title?.trim();
    const item = ItemDetailModelSchema.parse({
      id: `manual-${String(Date.now())}`,
      kind,
      title: title === undefined || title === "" ? "직접 추가한 링크" : title,
      body: request.note?.trim() ?? "",
      source: {
        platform,
        label: "직접 추가",
        originalUrl: request.url,
        author: null,
        actionType: null,
        firstSeenAt: this.generatedAt,
      },
      tags: [],
      links: [],
      evidence: [],
      sourcePublishedAt: null,
      checkedAt: null,
      firstSeenAt: this.generatedAt,
    });
    return Promise.resolve({ created: true, item });
  }

  listJobs(): Promise<readonly JobModel[]> {
    return Promise.resolve(MOCK_JOBS.map((job) => JobModelSchema.parse(job)));
  }

  /**
   * The canvas for a fixture item, with nothing researched and nothing run.
   *
   * Not a demo of a finished run: attaching a recorded AI-Q report to a fixture item would
   * put a report about one repository under another's title, which is the kind of
   * plausible filler the canvas exists to refuse. The boundary says why it is unknown here.
   * The fully populated states are exercised by the component tests, against the goldens
   * the service itself produced (`data/fixtures/focus/`).
   */
  async getFocus(itemId: string): Promise<FocusPayload | null> {
    const item = await this.getItem(itemId);
    if (item === null) return null;
    return FocusPayloadSchema.parse({
      item: {
        id: item.id,
        kind: item.kind,
        platform: item.source.platform,
        title: item.title,
        summary: item.body === "" ? null : item.body,
        canonicalUrl: item.source.originalUrl,
        author: item.source.author ?? null,
        actionAt: null,
        actionType: item.source.actionType ?? null,
        firstSeenAt: item.firstSeenAt,
      },
      context: null,
      outbound: { serverUrl: null, local: null, query: null, error: MOCK_RUNTIME_MESSAGE },
      bundle: null,
      research: null,
      asked: null,
      // Mock mode reaches no runtime, so there is no research to condition a question on
      // and nothing is offered. The Lab says why rather than showing four dead chips.
      suggestedQuestions: [],
      suggestion: null,
      trial: null,
      jobs: { research: null, plan: null, trial: null },
      boundary: {
        sandbox: "taste-inbox",
        ready: false,
        busy: false,
        policies: [],
        missingPresets: [],
        endpoints: [],
        reason: MOCK_RUNTIME_MESSAGE,
      },
    });
  }

  startResearch(): Promise<ResearchStartResponse> {
    return Promise.reject(new ApiDataError("mock_mode", MOCK_RUNTIME_MESSAGE, false));
  }

  askQuestion(): Promise<QuestionStartResponse> {
    return Promise.reject(new ApiDataError("mock_mode", MOCK_RUNTIME_MESSAGE, false));
  }

  startTrial(): Promise<TrialStartResponse> {
    return Promise.reject(new ApiDataError("mock_mode", MOCK_RUNTIME_MESSAGE, false));
  }

  getLaunchdPlan(): Promise<LaunchdPlan> {
    // No filesystem here, in either direction: mock mode answers with a transcript and
    // touches nothing, which is the property that lets `pnpm e2e` open Settings without
    // leaving files behind.
    return Promise.resolve(LaunchdPlanSchema.parse(MOCK_LAUNCHD_PLAN));
  }

  /**
   * The one piece of mutable state in this class.
   *
   * Per-instance rather than module-level so a test gets a clean store from
   * `new MockRepository()`, while the app — which memoises one instance in
   * `getRepository()` — keeps a written value for the life of the process. That is as far
   * as mock persistence should go: writing it to disk would make a fixture-backed mode
   * accumulate state a fresh checkout does not have, which is the property `lib/mock`
   * exists to protect.
   */
  private readonly settings = new MockSettingsStore(this.generatedAt);

  getSettings(): Promise<SettingsDocument> {
    return Promise.resolve(this.settings.read());
  }

  updateSettings(changes: SettingsPatchRequest["changes"]): Promise<SettingsDocument> {
    return Promise.resolve(this.rejectable(() => this.settings.apply(changes)));
  }

  /**
   * The fixture workspace is already set up, as `Suzie` — the reference's own name — so every
   * screen renders without a first-run detour. Onboarding in mock mode stores its answers in
   * this process and collects nothing.
   */
  private profileName: string | null = "Suzie";

  getProfile(): Promise<Profile> {
    return Promise.resolve({ name: this.profileName, onboarded: this.profileName !== null });
  }

  updateProfileName(name: string): Promise<Profile> {
    const clean = name.trim();
    if (clean === "") {
      return Promise.reject(new ApiDataError("profile_rejected", "이름을 입력해 주세요.", true));
    }
    this.profileName = clean;
    return this.getProfile();
  }

  async completeOnboarding(request: OnboardingRequest): Promise<OnboardingResponse> {
    const name = request.name.trim();
    if (name === "") {
      throw new ApiDataError("onboarding_name", "이름을 입력해 주세요.", true);
    }
    if (request.github.trim() === "" && request.huggingface.trim() === "") {
      throw new ApiDataError(
        "onboarding_accounts",
        "GitHub와 Hugging Face 중 하나 이상의 계정명을 입력해 주세요.",
        true,
      );
    }
    for (const platform of ["github", "huggingface"] as const) {
      if (request[platform].trim() !== "") await this.connectAccount(platform, request[platform]);
    }
    this.profileName = name;
    return { profile: await this.getProfile(), accounts: this.accountsNow().accounts, jobIds: [] };
  }

  /** Names stored for this process only. Mock mode never reaches GitHub or the Hub. */
  private readonly accountHandles = new Map<AccountPlatform, string>();

  private accountsNow(): AccountsResponse {
    const rows: readonly {
      platform: AccountPlatform;
      label: string;
      profile: string;
      tokenEnv: string;
      tokenEffect: string;
      surfaces: readonly { id: string; label: string }[];
    }[] = [
      {
        platform: "github",
        label: "GitHub",
        profile: "https://github.com/",
        tokenEnv: "GITHUB_TOKEN",
        tokenEffect: "없으면 시간당 60회 제한으로 공개 스타 목록을 읽어요",
        surfaces: [{ id: "github_stars_api", label: "스타" }],
      },
      {
        platform: "huggingface",
        label: "Hugging Face",
        profile: "https://huggingface.co/",
        tokenEnv: "HF_TOKEN",
        tokenEffect: "없어도 공개 좋아요·업보트를 읽어요. 비공개 저장소 좋아요에만 필요해요",
        surfaces: [
          { id: "huggingface_activity", label: "좋아요 · 모델 · 데이터셋 · Space" },
          { id: "huggingface_upvotes", label: "업보트한 논문" },
        ],
      },
    ];
    return AccountsResponseSchema.parse({
      accounts: rows.map((row) => {
        const handle = this.accountHandles.get(row.platform) ?? null;
        return {
          platform: row.platform,
          label: row.label,
          handle,
          profileUrl: handle === null ? null : `${row.profile}${handle}`,
          tokenEnv: row.tokenEnv,
          tokenConfigured: false,
          tokenEffect: row.tokenEffect,
          itemCount: 0,
          surfaces: row.surfaces.map((surface) => ({
            ...surface,
            lastRunAt: null,
            outcome: null,
            stoppedBecause: null,
            itemsSeen: null,
          })),
          job: null,
        };
      }),
    });
  }

  getAccounts(): Promise<AccountsResponse> {
    return Promise.resolve(this.accountsNow());
  }

  connectAccount(platform: AccountPlatform, handle: string): Promise<AccountConnectResponse> {
    const name = handle.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/.test(name)) {
      return Promise.reject(
        new ApiDataError("account_rejected", `'${name}'는 계정명 형식이 아니에요.`, true),
      );
    }
    const changed = this.accountHandles.get(platform) !== name;
    this.accountHandles.set(platform, name);
    // No job: mock mode stores the name and collects nothing, and says so on the card.
    return Promise.resolve({ ...this.accountsNow(), handle: name, changed, jobId: null });
  }

  disconnectAccount(platform: AccountPlatform): Promise<AccountsResponse> {
    this.accountHandles.delete(platform);
    return Promise.resolve(this.accountsNow());
  }

  collectAccount(): Promise<{ readonly jobId: string }> {
    return Promise.reject(new ApiDataError("mock_mode", MOCK_RUNTIME_MESSAGE, false));
  }

  /**
   * Re-raises a rejected write as the same typed error the live client produces.
   *
   * Without this the two modes fail differently — mock with a bare `Error` the boundary
   * renders as a stack-trace `detail`, live with an `ApiDataError` the screen renders as a
   * sentence — and the rejection path would only ever be exercised in the mode that is not
   * shipped. `recoverable: true` because every rejection here names a value the user can
   * simply change.
   */
  private rejectable(write: () => SettingsDocument): SettingsDocument {
    try {
      return write();
    } catch (error) {
      if (error instanceof MockSettingRejected) {
        throw new ApiDataError("setting_rejected", error.rejection.message, true);
      }
      throw error;
    }
  }
}
