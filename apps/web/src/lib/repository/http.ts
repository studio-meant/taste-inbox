import {
  OnboardingRequestSchema,
  OnboardingResponseSchema,
  ProfileSchema,
  AccountConnectResponseSchema,
  AccountsResponseSchema,
  AIItemCardModelSchema,
  JobStartResponseSchema,
  EffectiveResourcePolicySchema,
  FocusPayloadSchema,
  HostProfileSchema,
  ItemDetailModelSchema,
  ManualItemCreateRequestSchema,
  ManualItemCreateResponseSchema,
  JobModelSchema,
  LaunchdPlanSchema,
  SettingsDocumentSchema,
  SettingsPatchRequestSchema,
  TodayPayloadSchema,
  QuestionStartResponseSchema,
  ResearchStartResponseSchema,
  TrialStartResponseSchema,
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
  type LaunchdPlan,
  type ItemDetailModel,
  type ManualItemCreateRequest,
  type ManualItemCreateResponse,
  type QuestionStartResponse,
  type ResearchStartResponse,
  type SettingsDocument,
  type SettingsPatchRequest,
  type TodayPayload,
  type TrialStartResponse,
} from "@taste-inbox/shared";
import { z } from "zod";
import type { AIItemQuery, Page, TasteInboxRepository } from "./types";

/**
 * The same interface, backed by the local FastAPI service instead of fixtures.
 *
 * Every response is validated against the shared zod schema before a component sees it.
 * That is the point of the two languages sharing one contract: a field the Python side
 * renames or forgets fails here with the field named, rather than three layers later as
 * an undefined read inside a card.
 *
 * A validation failure is a typed data error, never a crash
 * (`FRONTEND_COMPONENT_ARCHITECTURE.md` §18).
 */

export class ApiDataError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable: boolean,
  ) {
    super(message);
    this.name = "ApiDataError";
  }
}

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
}

/**
 * The paged envelope as *received*, not as promised.
 *
 * `items` and `origin` are `unknown` on purpose: they are the two fields read directly
 * rather than handed to a schema, so declaring them in their happy shape is what let a
 * `{data:{}}` response reach `raw.items.entries()` and throw a TypeError — past every
 * typed-error path the error boundaries know how to render.
 */
interface RawPage {
  readonly items: unknown;
  readonly nextCursor: string | null;
  readonly generatedAt: string;
  readonly origin: unknown;
}

/**
 * `GET /api/health`. Only the count is read here; `status` is for the operator.
 *
 * Declared locally rather than in `@taste-inbox/shared` because no other consumer of the
 * contract has a use for it.
 */
const ItemCountResponseSchema = z.object({ itemCount: z.number().int().nonnegative() });

export class HttpRepository implements TasteInboxRepository {
  constructor(private readonly baseUrl: string) {}

  /**
   * Obtain an API envelope through this repository's transport.
   *
   * Split from `send` so the desktop subclass can replace TCP with Tauri IPC while every
   * query, schema and typed-error rule below remains exactly the same implementation.
   */
  protected async receive<T>(path: string, init: RequestInit): Promise<ApiEnvelope<T> | null> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, init);
    } catch {
      throw new ApiDataError(
        "service_unreachable",
        "로컬 서비스에 연결하지 못했어요. 실행 중인지 확인해 주세요.",
        true,
      );
    }
    return (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  }

  /**
   * One fetch, one envelope. `get` and `patch` differ only in what they send.
   *
   * The failure handling is the part that must not fork: a PATCH that reported an
   * unreachable service differently from a GET would give the same stopped process on the
   * same Mac two different sentences, and the user would have to learn both.
   *
   * `response.ok` is deliberately not consulted, here or anywhere in this class. The
   * service answers every failure with a typed `{error}` envelope and its own Korean
   * message (`api/app.py`), so the status line carries nothing the body does not — and
   * branching on it would produce a second, English, code-less error path for the same
   * 422 the settings screen has to render by name.
   */
  private async send<T>(path: string, init: RequestInit): Promise<T> {
    const envelope = await this.receive<T>(path, init);
    if (envelope === null) {
      throw new ApiDataError("invalid_response", "응답을 읽지 못했어요.", false);
    }
    if (envelope.error) {
      throw new ApiDataError(
        envelope.error.code,
        envelope.error.message,
        envelope.error.recoverable,
      );
    }
    if (envelope.data === undefined) {
      throw new ApiDataError("invalid_response", "응답에 데이터가 없어요.", false);
    }
    return envelope.data;
  }

  private get<T>(path: string): Promise<T> {
    return this.send<T>(path, {
      headers: { accept: "application/json" },
      // The service is the source of truth and changes when a collector runs; a cached
      // board would show yesterday's counts with no way to tell.
      cache: "no-store",
    });
  }

  /** A typed JSON write, shared by the manual link form and the settings controls. */
  private patch<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>(path, {
      method: "PATCH",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>(path, {
      method: "PUT",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private delete<T>(path: string): Promise<T> {
    return this.send<T>(path, { method: "DELETE", headers: { accept: "application/json" } });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>(path, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * The one place a schema is run against a response body.
   *
   * A bare `Schema.parse(await this.get(...))` reads well but breaks this class's own
   * promise: zod throws a `ZodError`, both error boundaries render `detail={error.message}`,
   * and the user gets a JSON issue dump instead of a sentence. Five endpoints did that.
   * Going through here makes the failure the same typed, unrecoverable data error the
   * paged endpoints already produced.
   */
  private static parsed<T>(
    schema: { parse: (value: unknown) => T },
    value: unknown,
    label: string,
  ): T {
    try {
      return schema.parse(value);
    } catch {
      throw new ApiDataError(
        "invalid_response",
        `${label}을(를) 불러왔지만 내용을 읽지 못했어요.`,
        false,
      );
    }
  }

  private async page<T>(
    path: string,
    parse: (value: unknown) => T,
    label: string,
  ): Promise<Page<T>> {
    const raw = await this.get<RawPage>(path);
    if (!Array.isArray(raw.items)) {
      // `{data:{}}` reaches here whenever the service answers with a body it built but did
      // not fill; without this it became `TypeError: Cannot read properties of undefined`.
      throw new ApiDataError("invalid_response", `${label} 목록을 받지 못했어요.`, false);
    }
    const rows: readonly unknown[] = raw.items;
    const items: T[] = [];
    for (const [index, candidate] of rows.entries()) {
      try {
        items.push(parse(candidate));
      } catch {
        // Named precisely so the mismatch is findable: which endpoint, which row.
        throw new ApiDataError(
          "invalid_item",
          `${label} 중 ${String(index + 1)}번째를 읽지 못했어요.`,
          false,
        );
      }
    }
    return {
      items,
      nextCursor: raw.nextCursor,
      generatedAt: raw.generatedAt,
      // Two board pages render this as `origin === "collected"`, so an unrecognised third
      // value would silently read as `seed` anyway. Made explicit here, and falling to
      // `seed` rather than `collected`: under-claiming demo data as demo data is the
      // recoverable mistake, presenting fixtures as the user's own collection is not.
      origin: raw.origin === "collected" || raw.origin === "seed" ? raw.origin : "seed",
    };
  }

  private static multi(values: readonly string[] | undefined): string | null {
    return values === undefined || values.length === 0 ? null : values.join(",");
  }

  /**
   * `?day=YYYY-MM-DD`, single-valued, on the Inbox list.
   *
   * Sent as the plain key the service declares rather than through `multi`: a day is one
   * value, and the service resolves it against the *local* calendar day with the same
   * function Today uses (`api/today.py::_local_day`). Serialising it here and stopping
   * would be the half-fix docs/DECISIONS.md warns about — the parameter would be accepted,
   * ignored, and the board would answer a day-filtered link with every day it has.
   */
  private static query(pairs: Record<string, string | null>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(pairs)) {
      if (value !== null) {
        params.set(key, value);
      }
    }
    const encoded = params.toString();
    return encoded === "" ? "" : `?${encoded}`;
  }

  listAIItems(query?: AIItemQuery): Promise<Page<AIItemCardModel>> {
    const search = HttpRepository.query({
      kind: HttpRepository.multi(query?.kind),
      source: HttpRepository.multi(query?.source),
      day: query?.day ?? null,
    });
    return this.page(`/api/items${search}`, (value) => AIItemCardModelSchema.parse(value), "Inbox");
  }

  async createManualItem(request: ManualItemCreateRequest): Promise<ManualItemCreateResponse> {
    const parsed = ManualItemCreateRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiDataError("manual_item_rejected", "링크와 입력 내용을 확인해 주세요.", true);
    }
    return HttpRepository.parsed(
      ManualItemCreateResponseSchema,
      await this.post<unknown>("/api/items/manual", parsed.data),
      "직접 추가한 항목",
    );
  }

  async getAIItem(id: string): Promise<AIItemCardModel | null> {
    const { items } = await this.listAIItems();
    return items.find((item) => item.id === id) ?? null;
  }

  async getItem(id: string): Promise<ItemDetailModel | null> {
    // A 404 here is an ordinary answer rather than a failure: a bookmark, or a Today
    // payload built before the item was removed, can name something no longer collected.
    // Everything else keeps `get`'s error handling, including the unreachable-service case.
    try {
      return HttpRepository.parsed(
        ItemDetailModelSchema,
        await this.get<unknown>(`/api/items/${encodeURIComponent(id)}`),
        "항목",
      );
    } catch (error) {
      if (error instanceof ApiDataError && error.code === "item_not_found") return null;
      throw error;
    }
  }

  async getHostProfile(): Promise<HostProfile> {
    // Detected at request time from the Mac actually running this, never a stored device
    // profile (CLAUDE.md §2).
    return HttpRepository.parsed(
      HostProfileSchema,
      await this.get<unknown>("/api/host/profile"),
      "이 맥의 정보",
    );
  }

  async getResourcePolicy(): Promise<EffectiveResourcePolicy> {
    return HttpRepository.parsed(
      EffectiveResourcePolicySchema,
      await this.get<unknown>("/api/host/policy"),
      "이 맥의 사용 한도",
    );
  }

  async getItemCount(): Promise<number> {
    const { itemCount } = HttpRepository.parsed(
      ItemCountResponseSchema,
      await this.get<unknown>("/api/health"),
      "Inbox 항목 수",
    );
    return itemCount;
  }

  async listJobs(): Promise<readonly JobModel[]> {
    const raw = await this.get<{ jobs?: unknown }>("/api/jobs");
    if (!Array.isArray(raw.jobs)) {
      throw new ApiDataError("invalid_response", "작업 목록을 받지 못했어요.", false);
    }
    const rows: readonly unknown[] = raw.jobs;
    return rows.map((job) => HttpRepository.parsed(JobModelSchema, job, "작업"));
  }

  async getFocus(itemId: string): Promise<FocusPayload | null> {
    // A 404 is an ordinary answer, as in `getItem`: a queue row or a bookmark can name an
    // item that is no longer collected.
    try {
      return HttpRepository.parsed(
        FocusPayloadSchema,
        await this.get<unknown>(`/api/focus/${encodeURIComponent(itemId)}`),
        "Focus Canvas",
      );
    } catch (error) {
      if (error instanceof ApiDataError && error.code === "item_not_found") return null;
      throw error;
    }
  }

  async startResearch(itemId: string): Promise<ResearchStartResponse> {
    return HttpRepository.parsed(
      ResearchStartResponseSchema,
      await this.post<unknown>("/api/research", { itemId }),
      "조사 요청",
    );
  }

  async askQuestion(itemId: string, question: string): Promise<QuestionStartResponse> {
    return HttpRepository.parsed(
      QuestionStartResponseSchema,
      await this.post<unknown>("/api/lab/questions", { itemId, question }),
      "질문",
    );
  }

  async startTrial(
    itemId: string,
    approval: { readonly approved: true },
  ): Promise<TrialStartResponse> {
    return HttpRepository.parsed(
      TrialStartResponseSchema,
      await this.post<unknown>("/api/trials", { itemId, approved: approval.approved }),
      "실행 요청",
    );
  }

  async getLaunchdPlan(): Promise<LaunchdPlan> {
    // `get`, and only ever `get`. `patch` is this class's single write path and this
    // endpoint must never reach it — the product does not install a launchd job, it prints
    // the command (CLAUDE.md §10). The service's GET writes nothing either — describing the
    // jobs is a pure read, and the install block's own first line is what rewrites the
    // plists with the interval currently saved.
    return HttpRepository.parsed(
      LaunchdPlanSchema,
      await this.get<unknown>("/api/collection/launchd"),
      "수집 작업 등록 명령",
    );
  }

  async getSettings(): Promise<SettingsDocument> {
    return HttpRepository.parsed(
      SettingsDocumentSchema,
      await this.get<unknown>("/api/settings"),
      "설정",
    );
  }

  async updateSettings(changes: SettingsPatchRequest["changes"]): Promise<SettingsDocument> {
    // Checked on the way *out*, which is unusual here and deliberate. Every other endpoint
    // only has to survive a bad answer; this one can send a bad question. `SETTING_KEYS` is
    // the single list of writable paths, and the service replies with the full refreshed
    // document whether or not it recognised a key — so an unknown key does not fail, it
    // returns a document in which nothing moved, which reads exactly like a change that had
    // no effect. Catching it here names it instead.
    const request = SettingsPatchRequestSchema.safeParse({ changes });
    if (!request.success) {
      throw new ApiDataError("invalid_setting_key", "저장할 수 없는 설정이 섞여 있어요.", false);
    }
    return HttpRepository.parsed(
      SettingsDocumentSchema,
      await this.patch<unknown>("/api/settings", request.data),
      "설정",
    );
  }

  async getProfile(): Promise<Profile> {
    return HttpRepository.parsed(ProfileSchema, await this.get<unknown>("/api/profile"), "프로필");
  }

  async updateProfileName(name: string): Promise<Profile> {
    return HttpRepository.parsed(
      ProfileSchema,
      await this.put<unknown>("/api/profile", { name }),
      "프로필",
    );
  }

  async completeOnboarding(request: OnboardingRequest): Promise<OnboardingResponse> {
    return HttpRepository.parsed(
      OnboardingResponseSchema,
      await this.post<unknown>("/api/onboarding", OnboardingRequestSchema.parse(request)),
      "시작 설정",
    );
  }

  async getAccounts(): Promise<AccountsResponse> {
    return HttpRepository.parsed(
      AccountsResponseSchema,
      await this.get<unknown>("/api/accounts"),
      "연결된 계정",
    );
  }

  async connectAccount(platform: AccountPlatform, handle: string): Promise<AccountConnectResponse> {
    return HttpRepository.parsed(
      AccountConnectResponseSchema,
      await this.put<unknown>(`/api/accounts/${encodeURIComponent(platform)}`, { handle }),
      "계정 연결",
    );
  }

  async disconnectAccount(platform: AccountPlatform): Promise<AccountsResponse> {
    return HttpRepository.parsed(
      AccountsResponseSchema,
      await this.delete<unknown>(`/api/accounts/${encodeURIComponent(platform)}`),
      "계정 연결 해제",
    );
  }

  async collectAccount(platform: AccountPlatform): Promise<{ readonly jobId: string }> {
    return HttpRepository.parsed(
      JobStartResponseSchema,
      await this.post<unknown>(`/api/accounts/${encodeURIComponent(platform)}/collect`, {}),
      "수집 요청",
    );
  }

  async getToday(): Promise<TodayPayload> {
    // The parts that need an enricher, a runner or the Focus engine come back empty
    // rather than filled with plausible activity — see `apps/api/.../api/today.py`.
    return HttpRepository.parsed(
      TodayPayloadSchema,
      await this.get<unknown>("/api/today"),
      "Today",
    );
  }
}

interface TauriCore {
  readonly invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

declare global {
  interface Window {
    readonly __TAURI__?: { readonly core: TauriCore };
  }
}

function tauriCore(): TauriCore {
  const core = typeof window === "undefined" ? undefined : window.__TAURI__?.core;
  if (core === undefined) {
    throw new ApiDataError(
      "desktop_unavailable",
      "데스크톱 연결을 찾지 못했어요. 앱을 다시 열어 주세요.",
      true,
    );
  }
  return core;
}

/**
 * The production desktop data source.
 *
 * It deliberately subclasses `HttpRepository`: the name of the old class describes its
 * default transport, while its validation and query implementation is the contract both
 * transports must share. Only `receive` changes — no fetch, no loopback port.
 */
export class TauriRepository extends HttpRepository {
  constructor() {
    super("desktop://taste-inbox");
  }

  protected override async receive<T>(
    path: string,
    init: RequestInit,
  ): Promise<ApiEnvelope<T> | null> {
    const core = tauriCore();
    let body: unknown;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        throw new ApiDataError(
          "desktop_request_invalid",
          "데스크톱 요청을 만들지 못했어요.",
          false,
        );
      }
    }

    try {
      const envelope = await core.invoke<unknown>("bridge_request", {
        request: {
          method: init.method ?? "GET",
          path,
          ...(body === undefined ? {} : { body }),
        },
      });
      return envelope as ApiEnvelope<T>;
    } catch (error) {
      if (error instanceof ApiDataError) throw error;
      throw new ApiDataError(
        "desktop_bridge_unreachable",
        "데스크톱 데이터 도우미를 실행하지 못했어요. 앱을 다시 열어 주세요.",
        true,
      );
    }
  }
}
