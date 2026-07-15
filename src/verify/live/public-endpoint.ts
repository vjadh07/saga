// Synchronous, stateless Live endpoint composition for hosted guest audits. This module
// intentionally imports only production providers. A failed Live audit is returned as a
// failed StoredAudit and is never replaced with Demo data.
import { mapClaimsWithModel } from "../agent/mapper.js";
import { LivePageFetcher } from "../net/fetcher.js";
import type { ModelProvider, StructuredModelRequest } from "../providers/model.js";
import { GeminiModelProvider } from "../providers/model-gemini.js";
import type { PageFetcher } from "../providers/fetch.js";
import type { SearchProvider, SearchRequest } from "../providers/search.js";
import { TavilySearchProvider } from "../providers/search-tavily.js";
import { InMemoryAuditStore, type AuditStore, type StoredAudit } from "../providers/store.js";
import { createLiveAuditService } from "./composition.js";
import type { AuditService } from "./service.js";

export const PUBLIC_LIVE_MAX_DOCUMENT_BYTES = 12_000;
export const PUBLIC_LIVE_MAX_CLAIMS = 1;
export const PUBLIC_LIVE_MAX_SEARCH_RESULTS = 2;

const TERMINAL_STATUSES = new Set(["completed", "partially_completed", "failed", "cancelled"]);

export interface PublicLiveEnvironment {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  TAVILY_API_KEY?: string;
}

export interface PublicLiveAuditInput {
  document: string;
  mode?: "quick";
}

export type PublicLiveAuditService = Pick<AuditService, "create" | "process" | "get" | "cancel">;

export interface PublicLiveDependencies {
  env?: PublicLiveEnvironment;
  service?: PublicLiveAuditService;
  store?: AuditStore;
  model?: ModelProvider;
  search?: SearchProvider;
  fetcher?: PageFetcher;
  now?: () => string;
}

class PublicLiveHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

class PublicLiveConfigurationError extends Error {}

/** Clamp the only model-controlled fan-out before Saga consumes it. */
export function clampPublicModel(model: ModelProvider): ModelProvider {
  return {
    id: model.id,
    async generateStructured<T>(request: StructuredModelRequest<T>): Promise<T> {
      const validated = request.schema.parse(await model.generateStructured(request));
      if (request.purpose !== "research_plan" || !validated || typeof validated !== "object") return validated;
      const plan = validated as Record<string, unknown>;
      if (!Array.isArray(plan.supportingQueries) || !Array.isArray(plan.skepticQueries)) return validated;
      return request.schema.parse({
        ...plan,
        supportingQueries: plan.supportingQueries.slice(0, 1),
        skepticQueries: plan.skepticQueries.slice(0, 1),
      });
    },
  };
}

/** Bound Tavily fan-out even if a caller asks for more or a provider ignores its limit. */
export function clampPublicSearch(search: SearchProvider): SearchProvider {
  return {
    id: search.id,
    async search(request: SearchRequest) {
      const results = await search.search({
        ...request,
        limit: Math.min(request.limit ?? PUBLIC_LIVE_MAX_SEARCH_RESULTS, PUBLIC_LIVE_MAX_SEARCH_RESULTS),
      });
      return results.slice(0, PUBLIC_LIVE_MAX_SEARCH_RESULTS);
    },
  };
}

export function createPublicLiveService(dependencies: PublicLiveDependencies = {}): PublicLiveAuditService {
  if (dependencies.service) return dependencies.service;
  const env = dependencies.env ?? process.env;
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const tavilyKey = env.TAVILY_API_KEY?.trim();
  if ((!geminiKey && !dependencies.model) || (!tavilyKey && !dependencies.search)) {
    throw new PublicLiveConfigurationError("GEMINI_API_KEY and TAVILY_API_KEY are required");
  }
  const now = dependencies.now ?? (() => new Date().toISOString());
  const model = clampPublicModel(dependencies.model ?? new GeminiModelProvider({
    apiKey: geminiKey!,
    ...(env.GEMINI_MODEL?.trim() ? { model: env.GEMINI_MODEL.trim() } : {}),
  }));
  const search = clampPublicSearch(dependencies.search ?? new TavilySearchProvider({ apiKey: tavilyKey! }));
  const fetcher = dependencies.fetcher ?? new LivePageFetcher({
    maxBytes: 100_000,
    maxRedirects: 4,
    timeoutMs: 8_000,
    now,
  });
  const store = dependencies.store ?? new InMemoryAuditStore(now);

  return createLiveAuditService({
    store,
    model,
    search,
    fetcher,
    now,
    mapper: async (document, provider, signal) =>
      (await mapClaimsWithModel(document, provider, signal)).slice(0, PUBLIC_LIVE_MAX_CLAIMS),
    resourceOptions: {
      limits: {
        maxClaims: PUBLIC_LIVE_MAX_CLAIMS,
        maxSearches: 2,
        maxModelCalls: 24,
        maxPageFetches: 4,
        maxAttempts: 1,
        callTimeoutMs: 30_000,
      },
      retryDelayMs: 0,
    },
    serviceOptions: {
      mappingTimeoutMs: 30_000,
      auditTimeoutMs: 270_000,
    },
  });
}

export async function runPublicLiveAudit(
  input: PublicLiveAuditInput,
  dependencies: PublicLiveDependencies = {},
  signal?: AbortSignal,
): Promise<StoredAudit> {
  const parsed = parsePublicLiveInput(input);
  const service = createPublicLiveService(dependencies);
  const record = await service.create({
    document: parsed.document,
    mode: "live",
    auditMode: "quick",
    workspaceId: "guest",
  });
  const cancel = () => void service.cancel(record.id);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    await service.process(record.id);
    const stored = await service.get(record.id);
    if (stored.record.mode !== "live" || stored.record.auditMode !== "quick" || stored.record.workspaceId !== "guest") {
      throw new Error("public Live service returned an audit outside its contract");
    }
    if (!TERMINAL_STATUSES.has(stored.record.status)) {
      throw new Error(`public Live audit did not reach a terminal state: ${stored.record.status}`);
    }
    return stored;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export async function handlePublicLiveRequest(
  request: Request,
  dependencies: PublicLiveDependencies = {},
): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method not allowed" }, { Allow: "POST" });
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new PublicLiveHttpError(415, "content-type must be application/json");
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > PUBLIC_LIVE_MAX_DOCUMENT_BYTES + 1_000) {
      throw new PublicLiveHttpError(413, "request body is too large");
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > PUBLIC_LIVE_MAX_DOCUMENT_BYTES + 1_000) {
      throw new PublicLiveHttpError(413, "request body is too large");
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new PublicLiveHttpError(400, "request body contains invalid JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new PublicLiveHttpError(400, "request body must be a JSON object");
    }
    const audit = await runPublicLiveAudit(body as PublicLiveAuditInput, dependencies, request.signal);
    return jsonResponse(200, audit);
  } catch (error) {
    if (error instanceof PublicLiveHttpError) return jsonResponse(error.status, { error: error.message });
    if (error instanceof PublicLiveConfigurationError) {
      return jsonResponse(503, { error: "Live audit is not configured" });
    }
    return jsonResponse(500, { error: "Live audit could not start" });
  }
}

function parsePublicLiveInput(input: PublicLiveAuditInput): Required<PublicLiveAuditInput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PublicLiveHttpError(400, "request body must be a JSON object");
  }
  const object = input as unknown as Record<string, unknown>;
  const unsupported = Object.keys(object).filter((key) => key !== "document" && key !== "mode");
  if (unsupported.length > 0) throw new PublicLiveHttpError(400, `unsupported field: ${unsupported[0]}`);
  if (typeof object.document !== "string" || object.document.trim().length === 0) {
    throw new PublicLiveHttpError(400, "document must be a non-empty string");
  }
  if (new TextEncoder().encode(object.document).byteLength > PUBLIC_LIVE_MAX_DOCUMENT_BYTES) {
    throw new PublicLiveHttpError(413, `document exceeds ${PUBLIC_LIVE_MAX_DOCUMENT_BYTES} bytes`);
  }
  if (object.mode !== undefined && object.mode !== "quick") {
    throw new PublicLiveHttpError(400, "public Live audits support quick mode only");
  }
  return { document: object.document, mode: "quick" };
}

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}
