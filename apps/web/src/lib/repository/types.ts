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
  ItemDetailModel,
  ManualItemCreateRequest,
  ManualItemCreateResponse,
  JobModel,
  LaunchdPlan,
  QuestionStartResponse,
  ResearchStartResponse,
  SettingsDocument,
  SettingsPatchRequest,
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
   * no `limit` parameter either. So this narrows a fixture page and is silently ignored
   * live — the one place in this interface where the two implementations disagree. It stays
   * because the Inbox passes `limit: 200` to defeat `DEFAULT_PAGE_SIZE`.
   */
  readonly limit?: number;
}

/**
 * One local calendar day, `YYYY-MM-DD` — the rail's calendar, pushed down here.
 *
 * **Local**, in the app timezone: `first_seen_at` is stamped in UTC and Seoul is nine hours
 * ahead of it, so a UTC-date comparison would put every star between midnight and 09:00 on
 * the previous day. The service converts with the same function the Today screen
 * uses (`api/today.py::_local_day`), and the frontend with `lib/filters/collected-days`,
 * so the calendar, the board and Today cannot disagree about which day a row landed on.
 *
 * Unlike `limit`, this is honoured by **both** implementations. A filter parsed from the
 * URL and applied by only one of them is the failure docs/DECISIONS.md (2026-08-08) calls
 * worse than not offering the filter at all: every jsdom test passes and the live Inbox
 * answers `?day=2026-08-08` with every day it has.
 */
interface DayQuery {
  readonly day?: string;
}

export interface AIItemQuery extends ListQuery, DayQuery {
  readonly kind?: readonly AIItemCardModel["kind"][];
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
   * How many items the Inbox holds — `GET /api/health`, one count and no cards, for the
   * rail and the workspace shell that need the number and not the list.
   */
  getItemCount(): Promise<number>;

  /** The Inbox — `GET /api/items`, narrowed by kind, source and day. */
  listAIItems(query?: AIItemQuery): Promise<Page<AIItemCardModel>>;
  getAIItem(id: string): Promise<AIItemCardModel | null>;

  /** One item, whole — the page behind every "이 항목" link. */
  getItem(id: string): Promise<ItemDetailModel | null>;

  /** Store a user-supplied URL locally. Implementations must not fetch the destination. */
  createManualItem(request: ManualItemCreateRequest): Promise<ManualItemCreateResponse>;

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
