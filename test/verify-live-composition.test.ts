import { expect, test } from "vitest";
import { createLiveAuditService } from "../src/verify/live/composition.js";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { GeminiModelProvider, type GeminiTransport } from "../src/verify/providers/model-gemini.js";
import { FixturePageFetcher } from "../src/verify/providers/fetch.js";
import { FixtureSearchProvider } from "../src/verify/providers/search.js";
import { InMemoryAuditStore } from "../src/verify/providers/store.js";
import type { LiveAuditResult } from "../src/verify/live/audit.js";

test("the production composition maps arbitrary text and runs it through the live service", async () => {
  const document = "I think the sky is beautiful.";
  const model = new MockModelProvider({
    claim_mapper: [{ claims: [{
      originalText: document,
      normalized: "the sky is beautiful",
      claimType: "general",
      verifiable: false,
      timeSensitive: false,
      risk: "low",
      asOf: null,
    }] }],
  });
  const store = new InMemoryAuditStore(() => "2026-07-14T00:00:00.000Z");
  const service = createLiveAuditService({
    store,
    model,
    search: new FixtureSearchProvider(),
    fetcher: new FixturePageFetcher(),
    now: () => "2026-07-14T00:00:00.000Z",
    resourceOptions: { retryDelayMs: 0 },
  });
  const record = await service.create({ document, mode: "live", auditMode: "quick", workspaceId: "guest" });
  await service.process(record.id);
  const stored = await service.get(record.id);
  const result = stored.result as LiveAuditResult;
  expect(stored.record.status).toBe("completed");
  expect(stored.claims).toHaveLength(1);
  expect(result.claimAudits[0]!.verdict.verdict).toBe("not_verifiable");
  expect(result.metrics.modelCalls).toBeGreaterThanOrEqual(1);
  expect(result.receipt.mode).toBe("live");
});

test("the production composition records Gemini provenance without introducing fixture evidence", async () => {
  const document = "I think the sky is beautiful.";
  const scripted = [
    { claims: [{
      originalText: document,
      normalized: "the sky is beautiful",
      claimType: "general",
      verifiable: false,
      timeSensitive: false,
      risk: "low",
      asOf: null,
    }] },
  ];
  const transport: GeminiTransport = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(scripted.shift()) }] },
      }],
    }),
  });
  const model = new GeminiModelProvider({ apiKey: "test-key", transport });
  const store = new InMemoryAuditStore(() => "2026-07-14T00:00:00.000Z");
  const service = createLiveAuditService({
    store,
    model,
    search: new FixtureSearchProvider(),
    fetcher: new FixturePageFetcher(),
    now: () => "2026-07-14T00:00:00.000Z",
    resourceOptions: { retryDelayMs: 0 },
  });

  const record = await service.create({ document, mode: "live", auditMode: "quick", workspaceId: "guest" });
  await service.process(record.id);
  const stored = await service.get(record.id);
  const result = stored.result as LiveAuditResult;

  expect(stored.record.status).toBe("completed");
  expect(result.mode).toBe("live");
  expect(result.receipt.modelProvider).toBe("google-gemini/gemini-3.1-flash-lite");
  expect(result.receipt.modelId).toBe("google-gemini/gemini-3.1-flash-lite");
  expect(result.claimAudits[0]!.evidence).toEqual([]);
  expect(scripted).toEqual([]);
});
