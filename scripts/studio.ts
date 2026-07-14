// Serve Saga Studio with a persistent Live workflow and an explicit deterministic Demo.
// Live audits use the Agent SDK model, Brave Search, the SSRF-hardened page fetcher, and
// SQLite persistence. A failed or unconfigured Live provider never switches to Demo.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runAudit } from "../src/verify/pipeline.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW, demoAuditId } from "../src/verify/fixtures/demo.js";
import { createLiveAuditService } from "../src/verify/live/composition.js";
import { createAuditApiServer } from "../src/verify/live/http.js";
import type { CostRates } from "../src/verify/live/resources.js";
import { LivePageFetcher } from "../src/verify/net/fetcher.js";
import { AgentSdkModelProvider } from "../src/verify/providers/model-agent.js";
import { BraveSearchProvider } from "../src/verify/providers/search-brave.js";
import type { SearchProvider, SearchRequest, SearchResult } from "../src/verify/providers/search.js";
import { SqliteAuditStore } from "../src/verify/providers/store-sqlite.js";
import { createStudioFallback } from "../src/verify/web/studio-server.js";

try {
  process.loadEnvFile();
} catch {
  // A local .env file is optional.
}

class UnconfiguredLiveSearch implements SearchProvider {
  readonly id = "unconfigured-live-search";

  async search(_request: SearchRequest): Promise<SearchResult[]> {
    throw new Error("Live search credentials are not configured. Set BRAVE_SEARCH_API_KEY.");
  }
}

const demo = runAudit({
  auditId: demoAuditId(),
  document: DEMO_DOCUMENT,
  claims: DEMO_CLAIMS,
  corpus: DEMO_CORPUS,
  now: DEMO_NOW,
});

const databasePath = process.env.AUDIT_DB_PATH?.trim() || "data/audits.db";
mkdirSync(dirname(resolve(databasePath)), { recursive: true });
const store = new SqliteAuditStore(databasePath);
const search = process.env.BRAVE_SEARCH_API_KEY?.trim()
  ? new BraveSearchProvider({ apiKey: process.env.BRAVE_SEARCH_API_KEY })
  : new UnconfiguredLiveSearch();
const costRates = readCostRates();
const service = createLiveAuditService({
  store,
  model: new AgentSdkModelProvider(),
  search,
  fetcher: new LivePageFetcher(),
  ...(costRates ? { resourceOptions: { costRates } } : {}),
  serviceOptions: {
    mappingTimeoutMs: readPositiveInteger("AUDIT_MAPPING_TIMEOUT_MS", 60_000),
    auditTimeoutMs: readPositiveInteger("AUDIT_TIMEOUT_MS", 300_000),
  },
});

const server = createAuditApiServer({
  service,
  enqueue(job) {
    void job().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Live audit worker failed: ${message}`);
    });
  },
  fallback: createStudioFallback(demo),
});

const port = readPort(process.env.STUDIO_PORT);
server.listen(port, "127.0.0.1", () => {
  console.log(`Saga Studio on http://127.0.0.1:${port}`);
  console.log(`Deterministic guest demo on http://127.0.0.1:${port}/demo`);
  if (search instanceof UnconfiguredLiveSearch) {
    console.warn("Live audits require BRAVE_SEARCH_API_KEY. Demo mode remains available.");
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}

function readPort(raw: string | undefined): number {
  const value = Number(raw ?? 4500);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error("STUDIO_PORT must be an integer from 1 to 65535");
  }
  return value;
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function readCostRates(): CostRates | undefined {
  const names = ["MODEL_CALL_COST_USD", "SEARCH_CALL_COST_USD", "PAGE_FETCH_COST_USD"] as const;
  const values = names.map((name) => process.env[name]?.trim()).filter((value) => value !== undefined && value !== "");
  if (values.length === 0) return undefined;
  if (values.length !== names.length) throw new Error(`Configure all cost rates together: ${names.join(", ")}`);
  const parsed = names.map((name) => Number(process.env[name]));
  if (parsed.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Cost rates must be non-negative numbers");
  }
  return {
    modelCallUsd: parsed[0]!,
    searchUsd: parsed[1]!,
    pageFetchUsd: parsed[2]!,
  };
}
