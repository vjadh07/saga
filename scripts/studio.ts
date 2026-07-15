// Serve Saga Studio with a persistent Live workflow and an explicit deterministic Demo.
// Live audits use configured provider adapters, the SSRF-hardened page fetcher, and SQLite
// persistence. A failed or unconfigured Live provider never switches provider or to Demo.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runAudit } from "../src/verify/pipeline.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW, demoAuditId } from "../src/verify/fixtures/demo.js";
import { createLiveAuditService } from "../src/verify/live/composition.js";
import { createAuditApiServer } from "../src/verify/live/http.js";
import { createLiveProviders, UnconfiguredLiveSearch } from "../src/verify/live/provider-selection.js";
import type { CostRates } from "../src/verify/live/resources.js";
import { LivePageFetcher } from "../src/verify/net/fetcher.js";
import { SqliteAuditStore } from "../src/verify/providers/store-sqlite.js";
import { createStudioFallback } from "../src/verify/web/studio-server.js";

try {
  process.loadEnvFile();
} catch {
  // A local .env file is optional.
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
const providers = createLiveProviders(process.env);
const costRates = readCostRates();
const service = createLiveAuditService({
  store,
  model: providers.model,
  search: providers.search,
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
  console.log(`Live model: ${providers.model.id}`);
  console.log(`Live search: ${providers.search.id}`);
  if (providers.search instanceof UnconfiguredLiveSearch) {
    console.warn("Live search requires TAVILY_API_KEY or BRAVE_SEARCH_API_KEY. Demo mode remains available.");
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
