import type {
  OnboardingRequest,
  OnboardingResponse,
  Profile,
  AccountConnectResponse,
  AccountPlatform,
  AccountsResponse,
  AIItemCardModel,
  EffectiveResourcePolicy,
  FocusPayload,
  HostProfile,
  ItemBoard,
  ItemDetailModel,
  ManualItemCreateRequest,
  ManualItemCreateResponse,
  JobModel,
  LaunchdPlan,
  MusicItemCardModel,
  QuestionStartResponse,
  ResearchStartResponse,
  SettingsDocument,
  SettingsPatchRequest,
  SourcePlatform,
  StyleItemCardModel,
  TodayPayload,
  TrialStartResponse,
} from "@taste-inbox/shared";

/**
 * Repository boundary.
 *
 * The frontend never reads SQLite, never runs browser automation, and never executes a
 * repository or model (frontend architecture §1 "비목표"). Everything it knows arrives
 * through this interface — backed by fixtures in mock mode and by the FastAPI service
 * from Phase 2 onward. Swapping the implementation must not touch a single component.
 */

/** Cursor-based pagination (frontend architecture §19). */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  /** When the underlying data was produced, for stale badges. */
  readonly generatedAt: string;
  /**
   * Where these items came from.
   *
   * `seed` is the committed demo fixture; `collected` is the user's own data. The two
   * look identical on screen otherwise, and judging the product on the wrong one is a
   * real mistake — so the board says which it is, and the answer comes from whoever
   * produced the page rather than from a component guessing.
   */
  readonly origin: "collected" | "seed";
}

export interface ListQuery {
  readonly cursor?: string | null;
  /**
   * Honoured by `MockRepository` only.
   *
   * `HttpRepository.query()` serialises filter keys and nothing else, and the service has
   * no `limit` parameter either: measured, `?limit=5` against `/api/trends/items` returns
   * all 76 items. So this narrows a fixture page and is silently ignored live — the one
   * place in this interface where the two implementations disagree.
   *
   * It stays only because the three board pages pass `limit: 200` to defeat
   * `DEFAULT_PAGE_SIZE`. Whoever removes those call sites should remove this with them
   * rather than implement pagination to match; the boards are a local inbox, not a feed.
   */
  readonly limit?: number;
}

/**
 * How many items each board holds right now — nothing else.
 *
 * The workspace shell and System want three integers, and asking for them by fetching
 * three boards was the single most expensive thing either page did: /library paid four
 * requests and ~175 KB to render zero cards, and /today pulled 176 KiB of board JSON and
 * 653 SQL statements for the same three numbers. `GET /api/health` answers in 3 SQL
 * statements and 69 bytes.
 *
 * `ai` rather than `trends` because that is the vocabulary the rest of this interface
 * uses (`listAIItems`); the service calls the same board `trends`.
 *
 * `BrowseModeStrip` takes `Record<string, number>`, which an interface does not satisfy —
 * interfaces have no implicit index signature. Rather than widen the call site, the counts
 * are spread there; the shape stays an interface so it matches every other type in this
 * file and the lint rule that enforces that.
 */
export interface BoardCounts {
  readonly ai: number;
  readonly style: number;
  readonly music: number;
  /** Zero until something files an item onto the places board. Still counted, not omitted. */
  readonly places: number;
  /**
   * How many items have no visible board: pending Instagram Likes plus explicit None.
   *
   * It remains separate from the four filed-board totals, but Browse > All adds it because
   * `/library` renders the same inbox beside those boards.
   */
  readonly none: number;
}

/**
 * One local calendar day, `YYYY-MM-DD` — the rail's calendar, pushed down here.
 *
 * On every list, because the rail is on all four boards plus None and `/library` answers one
 * `?day=` across all of them at once. **Local**, in the app timezone: `first_seen_at` is
 * stamped in UTC and Seoul is nine hours ahead of it, so a UTC-date comparison would put
 * every save between midnight and 09:00 on the previous day — the early-morning saves this
 * product exists to catch. The service converts with the same function the Today screen
 * uses (`api/today.py::_local_day`), and the frontend with `lib/filters/collected-days`,
 * so the calendar, the board and Today cannot disagree about which day a row landed on.
 *
 * Unlike `limit`, this is honoured by **both** implementations. A filter parsed from the
 * URL and applied by only one of them is the failure docs/DECISIONS.md (2026-08-08) calls
 * worse than not offering the filter at all: every jsdom test passes and the live board
 * answers `?day=2026-08-08` with every day it has.
 */
interface DayQuery {
  readonly day?: string;
}

export interface AIItemQuery extends ListQuery, DayQuery {
  readonly kind?: readonly AIItemCardModel["kind"][];
  readonly source?: readonly AIItemCardModel["source"]["platform"][];
}

export interface MusicItemQuery extends ListQuery, DayQuery {
  /** `false` (the default) shows only items still waiting to be dealt with. */
  readonly includeHandled?: boolean;
  /**
   * The same source filter the other two boards take.
   *
   * `/music` does not offer it — every saved Reel is from Instagram, so the facet cannot
   * narrow that board and is not rendered on it. `/library` is why it exists: the merged
   * board answers one `?source=` across all three lists, and a list that silently ignored
   * the filter would put Instagram Reels on a board asked for GitHub — the failure
   * docs/DECISIONS.md (2026-08-08) names as worse than not offering the filter at all.
   */
  readonly source?: readonly MusicItemCardModel["source"]["platform"][];
}

export interface StyleItemQuery extends ListQuery, DayQuery {
  readonly source?: readonly StyleItemCardModel["source"]["platform"][];
}

/**
 * The places board's query.
 *
 * No `kind`. `AIItemQuery` has one because `/trends` can hold a repository and a post side
 * by side; every place is a saved post, so the axis would have a single value and narrow
 * nothing — the rule `lib/filters/facets.ts` already applies to every other facet.
 *
 * `source` is here for `/library`, which answers one `?source=` across every board at once.
 */
/**
 * The no-board inbox query — the same two axes every board list takes.
 *
 * They are also passed through when `/library` merges this inbox into All, so a bookmarked
 * day from Today cannot silently omit a collected but still-unclassified Like.
 */
export interface DeclinedItemQuery extends ListQuery, DayQuery {
  readonly source?: readonly AIItemCardModel["source"]["platform"][];
}

export interface PlacesItemQuery extends ListQuery, DayQuery {
  readonly source?: readonly AIItemCardModel["source"]["platform"][];
}

export interface TasteInboxRepository {
  /** `GET /api/today?date=` — PAGE_SPECIFICATIONS.md §5.2. */
  getToday(date?: string): Promise<TodayPayload>;

  /** The Apple Silicon Mac currently running Taste Inbox. */
  getHostProfile(): Promise<HostProfile>;
  /** Limits derived from that host at runtime — never a fixed device profile. */
  getResourcePolicy(): Promise<EffectiveResourcePolicy>;

  /**
   * Board sizes without the boards.
   *
   * Two things to know before touching this. It is a three-implementation change — the
   * interface, `MockRepository` and `HttpRepository` — not a one-line swap, because the
   * live answer comes from a different endpoint than the boards do. And that endpoint
   * counts the music board *without* the default `handled` filter `listMusicItems` applies:
   * the two agree today only because `handledAt` is hardcoded null everywhere, and they
   * will diverge the moment clearing an item is implemented.
   */
  getBoardCounts(): Promise<BoardCounts>;

  listAIItems(query?: AIItemQuery): Promise<Page<AIItemCardModel>>;
  getAIItem(id: string): Promise<AIItemCardModel | null>;

  /**
   * One item, whole, whichever board it belongs to.
   *
   * Board-agnostic on purpose: Today links to items from all three, and answering with a
   * Trends card described a saved Reel as though it were a repository.
   */
  getItem(id: string): Promise<ItemDetailModel | null>;

  /** Store a user-supplied URL locally. Implementations must not fetch the destination. */
  createManualItem(request: ManualItemCreateRequest): Promise<ManualItemCreateResponse>;

  listStyleItems(query?: StyleItemQuery): Promise<Page<StyleItemCardModel>>;
  getStyleItem(id: string): Promise<StyleItemCardModel | null>;

  /**
   * Saved music-recommendation Reels. `handled` filters out rows the user has cleared,
   * which is what makes the board an inbox rather than an archive.
   */
  listMusicItems(query?: MusicItemQuery): Promise<Page<MusicItemCardModel>>;

  /**
   * Saved restaurants, cafés and travel spots — as `AIItemCardModel`, not a fourth model.
   *
   * A place the user saved is an Instagram post: a caption, a photo, hashtags and whatever
   * the account linked, which is what this model already describes. A dedicated one would
   * have to justify each field it added, and a rating, an address and a map are all things
   * nothing in this product collects or will produce (docs/DECISIONS.md, 2026-08-09 — a
   * field with no honest producer is removed rather than nulled).
   */
  listPlacesItems(query?: PlacesItemQuery): Promise<Page<AIItemCardModel>>;

  /**
   * The no-board inbox — pending Instagram Likes plus explicit None decisions.
   *
   * Same model as `/trends` and `/places`, and the same reason: what was collected is a
   * caption, a photo, hashtags and links, and its classification state adds no card field.
   *
   * The method name is retained at the repository boundary for compatibility. The live
   * endpoint now returns both states, and Browse > All deliberately merges it.
   */
  listDeclinedItems(query?: DeclinedItemQuery): Promise<Page<AIItemCardModel>>;

  /**
   * `PATCH /api/items/{id}/board` — move one item onto one board, or onto none.
   *
   * The one write in this product that changes collected data rather than configuration.
   * It answers with the **whole refreshed item** rather than an acknowledgement, for the
   * reason `updateSettings` does: `board` comes back read out of the database, so a caller
   * learns where the item actually ended up instead of hearing its own request repeated.
   *
   * A refused board arrives as an `ApiDataError` carrying the service's Korean message.
   */
  setItemBoard(id: string, board: ItemBoard): Promise<ItemDetailModel>;

  listJobs(): Promise<readonly JobModel[]>;

  /**
   * `GET /api/focus/{itemId}` — everything the Focus Canvas draws, in one response.
   *
   * Null when there is no such item, like `getItem`. Every section inside may be null,
   * and that is a state the canvas draws rather than a failure.
   */
  getFocus(itemId: string): Promise<FocusPayload | null>;

  /**
   * `POST /api/research` — ask NVIDIA AI-Q about one item. Answers with a queued job.
   *
   * Refusals — no `AIQ_SERVER_URL`, a backend that is not AI-Q, another research already
   * running — arrive as an `ApiDataError` with the service's Korean message, never as a
   * job that fails later.
   */
  startResearch(itemId: string): Promise<ResearchStartResponse>;

  /**
   * `POST /api/lab/questions` — what the person wants to know, and the plan AI-Q designs
   * for it. Answers with a queued job, like research.
   *
   * Reached only from a person choosing a chip or typing: the agent never picks the
   * question, which is the asymmetry the Lab is built on.
   *
   * Refusals — no research yet, a question over the length bound, another planning pass
   * running — arrive as an `ApiDataError` with the service's Korean message.
   */
  askQuestion(itemId: string, question: string): Promise<QuestionStartResponse>;

  /**
   * `POST /api/trials` — run the item's plan inside the OpenShell sandbox.
   *
   * `approval` is typed as the literal `true` so no call site can reach this without
   * stating it; the service refuses anything else as well (docs/DECISIONS.md, 2026-09-28).
   */
  startTrial(itemId: string, approval: { readonly approved: true }): Promise<TrialStartResponse>;

  /**
   * `GET /api/collection/launchd` — the generated schedule jobs and the commands that load
   * them. **Reading this never loads anything**, here or anywhere: the product shows the
   * `launchctl` lines and a person runs them (CLAUDE.md §10).
   *
   * Two properties of the live call that a caller has to know:
   *
   * - **It writes nothing.** It used to: `generate()` rewrote six plists into `var/launchd/`
   *   on every request, which was harmless only while nothing called the endpoint — and
   *   then this screen started calling it, so *rendering a page* rewrote six files (and so
   *   did every run of the API's test suite). The endpoint now describes the plan with
   *   `plan()`, and the writing moved into the install block itself: its first line is
   *   `python -m taste_inbox.api.launchd`, so the plists are written by the same act that
   *   installs them, carrying whatever interval is saved at that moment.
   * - **It is not on the critical path.** Every other thing System renders is still true
   *   when this fails, so the caller contains the failure rather than letting it reach the
   *   root error boundary — `/system` has no local `error.tsx`, so an uncaught throw here
   *   replaces the entire document, navigation included.
   */
  getLaunchdPlan(): Promise<LaunchdPlan>;

  /** `GET /api/settings` — PAGE_SPECIFICATIONS.md §11. */
  getSettings(): Promise<SettingsDocument>;

  /**
   * `PATCH /api/settings` — PAGE_SPECIFICATIONS.md §11.
   *
   * Takes dotted keys and answers with the **whole** refreshed document rather than the
   * fields it changed, because two things move that the caller did not name: `origin`
   * flips to `user` on every touched key, and `staggerMinutes.max` is derived from
   * `intervalHours` (`CollectionSection._stagger_must_fit_inside_one_interval` refuses
   * `stagger × 5 >= interval × 60`), so changing the interval silently retightens a bound
   * on a control the patch never mentioned. Merging a partial response into local state
   * would leave that stale bound on screen.
   *
   * A rejected change arrives as an `ApiDataError` carrying the service's Korean message.
   */
  updateSettings(changes: SettingsPatchRequest["changes"]): Promise<SettingsDocument>;

  /**
   * `PATCH /api/settings/sources/{platform}` — per-account, so it is not a dotted key.
   *
   * The contract does not state this endpoint's response body. It is read here as the same
   * refreshed document the other write returns, for the same reason: a source's `state` is
   * resolved from `checkpoints` + `collector_runs` and can move without anyone asking. If
   * the service answers with only the changed row instead, that disagreement surfaces as a
   * named validation error at this boundary rather than as a half-updated screen.
   */
  updateSourceSetting(platform: SourcePlatform, enabled: boolean): Promise<SettingsDocument>;

  /** `GET /api/profile` — whose workspace this is, and whether first-run setup is done. */
  getProfile(): Promise<Profile>;

  /** `PUT /api/profile` — change the display name. */
  updateProfileName(name: string): Promise<Profile>;

  /**
   * `POST /api/onboarding` — name, accounts and interval in one request, then the first
   * collection. A refusal is an `ApiDataError` whose code names the field
   * (`onboarding_github`, `onboarding_accounts`, …).
   */
  completeOnboarding(request: OnboardingRequest): Promise<OnboardingResponse>;

  /** `GET /api/accounts` — which GitHub and Hugging Face account this Mac collects. */
  getAccounts(): Promise<AccountsResponse>;

  /**
   * `PUT /api/accounts/{platform}` — name the account and collect it at once.
   *
   * A malformed name arrives as an `ApiDataError` carrying the service's Korean sentence.
   */
  connectAccount(platform: AccountPlatform, handle: string): Promise<AccountConnectResponse>;

  /** `DELETE /api/accounts/{platform}` — stop collecting it. Collected items stay. */
  disconnectAccount(platform: AccountPlatform): Promise<AccountsResponse>;

  /** `POST /api/accounts/{platform}/collect` — collect now, without waiting for the interval. */
  collectAccount(platform: AccountPlatform): Promise<{ readonly jobId: string }>;
}

export const DEFAULT_PAGE_SIZE = 20;
