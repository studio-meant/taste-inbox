import {
  AccountsResponseSchema,
  AIItemCardModelSchema,
  EffectiveResourcePolicySchema,
  FocusPayloadSchema,
  HostProfileSchema,
  JobModelSchema,
  ItemDetailModelSchema,
  LaunchdPlanSchema,
  MusicItemCardModelSchema,
  StyleItemCardModelSchema,
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
  type ItemBoard,
  type JobModel,
  type ItemDetailModel,
  type ManualItemCreateRequest,
  type ManualItemCreateResponse,
  type LaunchdPlan,
  type MusicItemCardModel,
  type ResearchStartResponse,
  type SettingsDocument,
  type SettingsPatchRequest,
  type SourcePlatform,
  type StyleItemCardModel,
  type TodayPayload,
  type QuestionStartResponse,
  type TrialStartResponse,
} from "@taste-inbox/shared";
import hostProfileFixture from "../../../../../data/fixtures/host-profiles/capacity-16gb-512gb.json";
import resourcePolicyFixture from "../../../../../data/fixtures/resource-policy/expected/capacity-16gb-512gb.json";
import {
  DEFAULT_PAGE_SIZE,
  type AIItemQuery,
  type BoardCounts,
  type DeclinedItemQuery,
  type ListQuery,
  type Page,
  type MusicItemQuery,
  type PlacesItemQuery,
  type StyleItemQuery,
  type TasteInboxRepository,
} from "../repository/types";
import { ApiDataError } from "../repository/http";
import { localDay } from "../filters/collected-days";
import { loadCollected } from "./captures";
import { toAICard, toMusicCard, toStyleCard } from "./mappers";
import { MOCK_LAUNCHD_PLAN } from "./launchd";
import { MockSettingRejected, MockSettingsStore } from "./settings";
import { MOCK_AI_ITEMS, MOCK_JOBS, MOCK_STYLE_ITEMS } from "./seed";
import { MOCK_MUSIC_ITEMS } from "./music";
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

/**
 * One board's fixture, before any board move is applied, with where it came from.
 *
 * Three of these exist and each is read by two callers that want opposite halves of it —
 * the board's own list wants the rows still on it, `aiModelBoard` wants exactly the rows
 * that are not, and `getItem` wants all of them whatever board they are on now. Reading a
 * list method twice would make a moved item invisible to every one of them.
 */
interface Fixture<T> {
  readonly items: readonly T[];
  /** `seed` is the committed demo fixture; `collected` is the user's own captures. */
  readonly origin: Page<unknown>["origin"];
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

  /**
   * The trends fixture, before any board move is applied.
   *
   * Split out because two callers need the same rows for opposite reasons: `listAIItems`
   * wants the ones still on `/trends`, and `aiModelBoard` wants exactly the ones that are
   * not. Reading it twice through `listAIItems` would make an item moved to `/places`
   * invisible on both.
   */
  private aiFixture(): Fixture<AIItemCardModel> {
    const collected = loadCollected("ai");
    return {
      items: (collected.length > 0
        ? collected.map(toAICard)
        : MOCK_AI_ITEMS.map((item) => AIItemCardModelSchema.parse(item))
      ).map((item) => AIItemCardModelSchema.parse(item)),
      origin: collected.length > 0 ? "collected" : "seed",
    };
  }

  listAIItems(query?: AIItemQuery): Promise<Page<AIItemCardModel>> {
    const fixture = this.aiFixture();
    let items = fixture.items.filter(this.stillOn("trends"));
    if (query?.kind !== undefined && query.kind.length > 0) {
      const wanted = new Set<string>(query.kind);
      items = items.filter((item) => wanted.has(item.kind));
    }
    if (query?.source !== undefined && query.source.length > 0) {
      const wanted = new Set<string>(query.source);
      items = items.filter((item) => wanted.has(item.source.platform));
    }
    items = [...onDay(items, query?.day)];
    return Promise.resolve(paginate(items, query, this.generatedAt, fixture.origin));
  }

  /** The style fixture, before any board move is applied. See `aiFixture`. */
  private styleFixture(): Fixture<StyleItemCardModel> {
    const collected = loadCollected("fashion");
    return {
      items: (collected.length > 0
        ? collected.map(toStyleCard)
        : MOCK_STYLE_ITEMS.map((item) => StyleItemCardModelSchema.parse(item))
      ).map((item) => StyleItemCardModelSchema.parse(item)),
      origin: collected.length > 0 ? "collected" : "seed",
    };
  }

  listStyleItems(query?: StyleItemQuery): Promise<Page<StyleItemCardModel>> {
    const fixture = this.styleFixture();
    let items = fixture.items.filter(this.stillOn("style"));
    if (query?.source !== undefined && query.source.length > 0) {
      const wanted = new Set<string>(query.source);
      items = items.filter((item) => wanted.has(item.source.platform));
    }
    items = [...onDay(items, query?.day)];
    return Promise.resolve(paginate(items, query, this.generatedAt, fixture.origin));
  }

  async getAIItem(id: string): Promise<AIItemCardModel | null> {
    const { items } = await this.listAIItems({ limit: Number.MAX_SAFE_INTEGER });
    return items.find((item) => item.id === id) ?? null;
  }

  getItem(id: string): Promise<ItemDetailModel | null> {
    // Assembled from whichever board fixture holds the id, so mock mode exercises the same
    // page the live path does. Evidence is whatever that board's mapper already produced —
    // the fixture format carries no stored observations of its own.
    //
    // Read off the *fixtures* rather than the board lists, and `board` is where the item is
    // now rather than which fixture it came out of. An item moved to `/none` is not on any
    // board list any more, and looking it up through one would make its own detail page —
    // the place it can be moved back from — answer 404 the moment it was declined.
    const ai = this.aiFixture().items.find((item) => item.id === id);
    if (ai !== undefined) {
      return Promise.resolve(
        ItemDetailModelSchema.parse({
          id: ai.id,
          kind: ai.kind,
          board: this.moved.get(id) ?? "trends",
          title: ai.title,
          body: ai.summary,
          source: ai.source,
          media: ai.preview,
          photos: ai.preview === null ? [] : [ai.preview],
          author: null,
          tags: ai.tags,
          links: ai.links,
          evidence: [],
          sourcePublishedAt: null,
          checkedAt: ai.checkedAt,
          firstSeenAt: ai.source.firstSeenAt,
        }),
      );
    }

    const style = this.styleFixture().items.find((item) => item.id === id);
    if (style !== undefined) {
      return Promise.resolve(
        ItemDetailModelSchema.parse({
          id: style.id,
          kind: "outfit",
          board: this.moved.get(id) ?? "style",
          title: style.descriptor,
          body: style.descriptor,
          source: style.source,
          media: style.media[0] ?? null,
          photos: style.media,
          author: style.author,
          tags: style.tags,
          links: style.links,
          evidence: [],
          sourcePublishedAt: null,
          checkedAt: style.checkedAt,
          firstSeenAt: style.source.firstSeenAt,
        }),
      );
    }

    const music = this.musicFixture().items.find((item) => item.id === id);
    if (music === undefined) return Promise.resolve(null);
    return Promise.resolve(
      ItemDetailModelSchema.parse({
        id: music.id,
        kind: "post",
        board: this.moved.get(id) ?? "music",
        title: music.collectionName ?? music.source.label,
        body: music.caption,
        source: music.source,
        media: music.media,
        photos: music.media === null ? [] : [music.media],
        author: null,
        tags: [],
        links: music.links,
        evidence: music.candidates.flatMap((candidate) => candidate.evidence),
        sourcePublishedAt: null,
        checkedAt: music.coverCheckedAt,
        firstSeenAt: music.source.firstSeenAt,
      }),
    );
  }

  createManualItem(request: ManualItemCreateRequest): Promise<ManualItemCreateResponse> {
    const title = request.title?.trim();
    const item = ItemDetailModelSchema.parse({
      id: `manual-${String(Date.now())}`,
      kind: request.url.includes("github.com/") ? "repo" : "post",
      board: request.board,
      title: title === undefined || title === "" ? "직접 추가한 링크" : title,
      body: request.note?.trim() ?? "",
      source: {
        platform: request.url.includes("instagram.com/") ? "instagram" : "web",
        label: "직접 추가",
        originalUrl: request.url,
        author: null,
        actionType: null,
        firstSeenAt: this.generatedAt,
      },
      media: null,
      photos: [],
      author: null,
      tags: [],
      links: [],
      evidence: [],
      sourcePublishedAt: null,
      checkedAt: null,
      firstSeenAt: this.generatedAt,
    });
    return Promise.resolve({ created: true, item });
  }

  async getStyleItem(id: string): Promise<StyleItemCardModel | null> {
    const { items } = await this.listStyleItems({ limit: Number.MAX_SAFE_INTEGER });
    return items.find((item) => item.id === id) ?? null;
  }

  /** The music fixture, before any board move is applied. See `aiFixture`. */
  private musicFixture(): Fixture<MusicItemCardModel> {
    const collected = loadCollected("music");
    return {
      items: (collected.length > 0
        ? collected.map(toMusicCard)
        : MOCK_MUSIC_ITEMS.map((item) => MusicItemCardModelSchema.parse(item))
      ).map((item) => MusicItemCardModelSchema.parse(item)),
      origin: collected.length > 0 ? "collected" : "seed",
    };
  }

  listMusicItems(query?: MusicItemQuery): Promise<Page<MusicItemCardModel>> {
    const fixture = this.musicFixture();
    let items = fixture.items.filter(this.stillOn("music"));
    if (query?.includeHandled !== true) {
      items = items.filter((item) => item.handledAt === null);
    }
    if (query?.source !== undefined && query.source.length > 0) {
      const wanted = new Set<string>(query.source);
      items = items.filter((item) => wanted.has(item.source.platform));
    }
    items = [...onDay(items, query?.day)];
    return Promise.resolve(paginate(items, query, this.generatedAt, fixture.origin));
  }

  /**
   * The places board, empty — and empty *is* the fixture.
   *
   * There is no `MOCK_PLACES_ITEMS` and no `saved-places.json` capture, because nothing
   * files an item onto this board yet: `collection_name = "places"` is written by a
   * classifier that is a later phase, or by the user. Seeding it would put invented
   * restaurants on a board whose real state is "nothing classified" — the one thing
   * DESIGN.md §3.5 asks the product never to do.
   *
   * `origin: "collected"` rather than the `originOf([])` the other boards would give.
   * `seed` means "you are looking at the committed demo fixture", and the header would then
   * badge an empty board as 샘플 데이터 while no fixture exists. This board is showing the
   * user's own collection; it just has nothing in it.
   */
  listPlacesItems(query?: PlacesItemQuery): Promise<Page<AIItemCardModel>> {
    return this.aiModelBoard("places", query);
  }

  listDeclinedItems(query?: DeclinedItemQuery): Promise<Page<AIItemCardModel>> {
    return this.aiModelBoard("none", query);
  }

  /**
   * Where a board move is remembered in mock mode, and the exact limit of what it can do.
   *
   * Per-instance like `settings`, for the same reason: a test gets a clean store from
   * `new MockRepository()` and the app keeps one for the life of the process. Nothing is
   * written to disk — a fixture-backed mode must not accumulate state a fresh checkout does
   * not have.
   *
   * **Leaving a board is exact.** An item moved off a board is gone from it here as it is
   * live, so the thing this feature exists for — reading down a board, correcting what is
   * wrong, and watching the card go — behaves identically in both modes.
   *
   * **Arriving is exact only where the two boards render the same model.** There is no
   * shared item store behind mock mode: each board is its own fixture in its own card model.
   * `/trends`, `/places` and `/none` all render `AIItemCardModel`, so a move among those
   * three shows up on the destination. `/style` and `/music` do not, and putting a
   * `StyleItemCardModel` on `/music` would mean inventing the candidate list a music card is
   * made of — which is the one thing `lib/mock` exists not to do (see `listPlacesItems`
   * above). A move into either of those two is therefore recorded, honoured as a removal,
   * and shows up on the destination only against the real service.
   *
   * Counts go through the same list methods, so nothing on screen disagrees with the cards.
   */
  private readonly moved = new Map<string, ItemBoard>();

  /** Is this item still on the board that is listing it? */
  private stillOn(board: ItemBoard): (item: { readonly id: string }) => boolean {
    return (item) => (this.moved.get(item.id) ?? board) === board;
  }

  /**
   * One of the three boards that render `AIItemCardModel`, assembled after moves.
   *
   * `/trends` holds the fixture; `/places` and `/none` hold whatever has been moved onto
   * them and nothing else — neither has a committed fixture, because nothing in this
   * repository has ever been filed as a place or declined by anybody.
   */
  private aiModelBoard(board: ItemBoard, query?: PlacesItemQuery): Promise<Page<AIItemCardModel>> {
    // The fixture, not `listAIItems` — that method filters *out* exactly the rows this one
    // is looking for, so reading through it would leave every arrival invisible on both
    // boards at once.
    let arrivals = this.aiFixture().items.filter((item) => this.moved.get(item.id) === board);
    if (query?.source !== undefined && query.source.length > 0) {
      const wanted = new Set<string>(query.source);
      arrivals = arrivals.filter((item) => wanted.has(item.source.platform));
    }
    // `collected`, not `originOf([])`. `seed` means "you are looking at the committed demo
    // fixture", and an empty shelf would then be badged as sample data while no fixture for
    // it exists — the reasoning `listPlacesItems` has carried since the board was built.
    return Promise.resolve(
      paginate([...onDay(arrivals, query?.day)], query, this.generatedAt, "collected"),
    );
  }

  async setItemBoard(id: string, board: ItemBoard): Promise<ItemDetailModel> {
    const item = await this.getItem(id);
    if (item === null) {
      // The same code and sentence the service answers with, so the two modes fail alike.
      throw new ApiDataError("item_not_found", "그 항목을 찾을 수 없어요.", false);
    }
    this.moved.set(id, board);
    // Read back rather than echoed, matching the live contract: what comes back is where
    // the item now is.
    return ItemDetailModelSchema.parse({ ...item, board });
  }

  async getBoardCounts(): Promise<BoardCounts> {
    // Counted through the list methods rather than off the fixtures directly, so the
    // filtering that decides what a board *contains* — notably the music board hiding
    // handled rows — is applied once and cannot drift from what the board renders.
    // `Number.MAX_SAFE_INTEGER` because `paginate` would otherwise return the first
    // `DEFAULT_PAGE_SIZE` and the count would silently cap at 20.
    const [ai, style, music, places, none] = await Promise.all([
      this.listAIItems({ limit: Number.MAX_SAFE_INTEGER }),
      this.listStyleItems({ limit: Number.MAX_SAFE_INTEGER }),
      this.listMusicItems({ limit: Number.MAX_SAFE_INTEGER }),
      this.listPlacesItems({ limit: Number.MAX_SAFE_INTEGER }),
      this.listDeclinedItems({ limit: Number.MAX_SAFE_INTEGER }),
    ]);
    return {
      ai: ai.items.length,
      style: style.items.length,
      music: music.items.length,
      places: places.items.length,
      // Separate from the four filed boards; the rail adds it to the complete `all` view.
      none: none.items.length,
    };
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
    // No filesystem here, in either direction. The live endpoint writes six plists while
    // answering; mock mode answers with a transcript and touches nothing, which is the
    // property that lets `pnpm e2e` open /system without leaving files behind.
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

  updateSourceSetting(platform: SourcePlatform, enabled: boolean): Promise<SettingsDocument> {
    return Promise.resolve(this.rejectable(() => this.settings.applySource(platform, enabled)));
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
