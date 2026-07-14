// Per-mode resource controls for Live audits. The wrappers count real provider attempts,
// apply bounded retries and timeouts, honor cancellation, and stop before a configured
// budget is exceeded. Demo mode does not use these providers.
import type { AuditMode } from "../mapview.js";
import type { ModelProvider, StructuredModelRequest } from "../providers/model.js";
import type { PageFetcher } from "../providers/fetch.js";
import type { SearchProvider, SearchRequest } from "../providers/search.js";

export interface AuditLimits {
  maxClaims: number;
  maxSearches: number;
  maxModelCalls: number;
  maxPageFetches: number;
  maxAttempts: number;
  callTimeoutMs: number;
}

export const MODE_LIMITS: Readonly<Record<AuditMode, AuditLimits>> = Object.freeze({
  quick: Object.freeze({ maxClaims: 4, maxSearches: 16, maxModelCalls: 100, maxPageFetches: 32, maxAttempts: 2, callTimeoutMs: 12_000 }),
  deep: Object.freeze({ maxClaims: 8, maxSearches: 64, maxModelCalls: 400, maxPageFetches: 128, maxAttempts: 2, callTimeoutMs: 15_000 }),
  high_stakes: Object.freeze({ maxClaims: 12, maxSearches: 144, maxModelCalls: 900, maxPageFetches: 288, maxAttempts: 2, callTimeoutMs: 20_000 }),
});

export interface CostRates {
  modelCallUsd: number;
  searchUsd: number;
  pageFetchUsd: number;
}

export interface AuditMetrics {
  durationMs: number;
  claims: number;
  modelCalls: number;
  searches: number;
  pageFetches: number;
  retries: number;
  estimatedCostUsd: number | null;
  costBasis: "configured per-call rates" | "not configured by provider";
}

export interface AuditResourceOptions {
  signal?: AbortSignal;
  limits?: AuditLimits;
  costRates?: CostRates;
  clock?: () => number;
  retryDelayMs?: number;
  initialUsage?: Partial<Pick<AuditMetrics, "modelCalls" | "searches" | "pageFetches" | "retries">>;
}

type CountedResource = "modelCalls" | "searches" | "pageFetches";

class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

class ProviderTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

export class AuditResources {
  readonly limits: AuditLimits;
  private signal?: AbortSignal;
  private rates?: CostRates;
  private clock: () => number;
  private startedAt: number;
  private retryDelayMs: number;
  private usage = { claims: 0, modelCalls: 0, searches: 0, pageFetches: 0, retries: 0 };

  constructor(mode: AuditMode, options: AuditResourceOptions = {}) {
    this.limits = options.limits ?? MODE_LIMITS[mode];
    this.signal = options.signal;
    this.rates = options.costRates;
    this.clock = options.clock ?? (() => performance.now());
    this.startedAt = this.clock();
    this.retryDelayMs = options.retryDelayMs ?? 150;
    for (const resource of ["modelCalls", "searches", "pageFetches", "retries"] as const) {
      const value = options.initialUsage?.[resource] ?? 0;
      if (!Number.isInteger(value) || value < 0) throw new Error(`initial ${resource} must be a non-negative integer`);
      this.usage[resource] = value;
    }
    if (this.usage.modelCalls > this.limits.maxModelCalls) throw new BudgetExceededError("initial model call usage exceeds the selected mode limit");
    if (this.usage.searches > this.limits.maxSearches) throw new BudgetExceededError("initial search usage exceeds the selected mode limit");
    if (this.usage.pageFetches > this.limits.maxPageFetches) throw new BudgetExceededError("initial page fetch usage exceeds the selected mode limit");
  }

  checkClaimCount(count: number): void {
    if (!Number.isInteger(count) || count < 0) throw new Error("claim count must be a non-negative integer");
    if (count > this.limits.maxClaims) {
      throw new BudgetExceededError(`claim limit exceeded: ${count} requested, ${this.limits.maxClaims} allowed`);
    }
    this.usage.claims = count;
  }

  guard(input: { model: ModelProvider; search: SearchProvider; fetcher: PageFetcher }): {
    model: ModelProvider;
    search: SearchProvider;
    fetcher: PageFetcher;
  } {
    const model: ModelProvider = {
      id: input.model.id,
      generateStructured: <T>(request: StructuredModelRequest<T>) =>
        this.run("modelCalls", "model call", (signal) => input.model.generateStructured({ ...request, signal })),
    };
    const search: SearchProvider = {
      id: input.search.id,
      search: (request: SearchRequest) => this.run("searches", "search", (signal) => input.search.search({ ...request, signal })),
    };
    const fetcher: PageFetcher = {
      id: input.fetcher.id,
      fetch: (url: string) => this.run("pageFetches", "page fetch", (signal) => input.fetcher.fetch(url, { signal })),
    };
    return { model, search, fetcher };
  }

  snapshot(): AuditMetrics {
    const durationMs = Math.max(0, Math.round(this.clock() - this.startedAt));
    const estimatedCostUsd = this.rates
      ? roundMoney(
          this.usage.modelCalls * this.rates.modelCallUsd
          + this.usage.searches * this.rates.searchUsd
          + this.usage.pageFetches * this.rates.pageFetchUsd,
        )
      : null;
    return {
      durationMs,
      ...this.usage,
      estimatedCostUsd,
      costBasis: this.rates ? "configured per-call rates" : "not configured by provider",
    };
  }

  private maximum(resource: CountedResource): number {
    if (resource === "modelCalls") return this.limits.maxModelCalls;
    if (resource === "searches") return this.limits.maxSearches;
    return this.limits.maxPageFetches;
  }

  private label(resource: CountedResource): string {
    if (resource === "modelCalls") return "model call";
    if (resource === "searches") return "search";
    return "page fetch";
  }

  private consume(resource: CountedResource): void {
    const next = this.usage[resource] + 1;
    const maximum = this.maximum(resource);
    if (next > maximum) throw new BudgetExceededError(`${this.label(resource)} limit exceeded: ${maximum} allowed`);
    this.usage[resource] = next;
  }

  private async run<T>(resource: CountedResource, label: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.signal?.throwIfAborted();
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.limits.maxAttempts; attempt++) {
      this.consume(resource);
      try {
        return await withDeadline(operation, label, this.limits.callTimeoutMs, this.signal);
      } catch (error) {
        lastError = error;
        if (attempt >= this.limits.maxAttempts || !this.retryable(error)) throw error;
        this.usage.retries += 1;
        if (this.retryDelayMs > 0) await cancellableDelay(this.retryDelayMs, this.signal);
      }
    }
    throw lastError;
  }

  private retryable(error: unknown): boolean {
    if (this.signal?.aborted) return false;
    if (error instanceof BudgetExceededError) return false;
    if (error instanceof ProviderTimeoutError) return false;
    if (error instanceof Error && error.name === "ZodError") return false;
    const message = error instanceof Error ? error.message : String(error);
    return !/(?:blocked|private address|loopback|metadata|unsupported (?:scheme|protocol|content type)|credentials|response too large|redirect loop|too many redirects|no scripted response|no fixture)/i.test(message);
  }
}

async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  label: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onParentAbort = () => controller.abort(signal?.reason ?? new Error("audit cancelled"));
  signal?.addEventListener("abort", onParentAbort, { once: true });
  timer = setTimeout(() => controller.abort(new ProviderTimeoutError(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
  }
}

function cancellableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("audit cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
