import { expect, test, vi } from "vitest";
import { z } from "zod";
import {
  clampPublicModel,
  clampPublicSearch,
  handlePublicLiveRequest,
  type PublicLiveAuditService,
} from "../src/verify/live/public-endpoint.js";
import type { ModelProvider } from "../src/verify/providers/model.js";
import type { SearchProvider, SearchRequest } from "../src/verify/providers/search.js";
import type { AuditRecord, StoredAudit } from "../src/verify/providers/store.js";

function fakeService(): PublicLiveAuditService & {
  create: ReturnType<typeof vi.fn>;
  process: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
} {
  const record: AuditRecord = {
    id: "aud_public_1",
    mode: "live",
    auditMode: "quick",
    document: "The Eiffel Tower is 500 metres tall.",
    workspaceId: "guest",
    status: "created",
    error: null,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
  const stored: StoredAudit = { record: { ...record, status: "completed" }, claims: [], evidence: [], events: [], result: {} };
  const create = vi.fn(async () => structuredClone(record));
  const process = vi.fn(async () => undefined);
  const get = vi.fn(async () => structuredClone(stored));
  return { create, process, get, cancel: vi.fn(async () => undefined) };
}

test("the public endpoint runs one synchronous quick Live audit and returns its terminal record", async () => {
  const service = fakeService();
  const response = await handlePublicLiveRequest(new Request("https://saga.example/api/live-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ document: "The Eiffel Tower is 500 metres tall.", mode: "quick" }),
  }), { service });

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ record: { id: "aud_public_1", mode: "live", auditMode: "quick", status: "completed" } });
  expect(service.create).toHaveBeenCalledWith({
    document: "The Eiffel Tower is 500 metres tall.",
    mode: "live",
    auditMode: "quick",
    workspaceId: "guest",
  });
  expect(service.process).toHaveBeenCalledWith("aud_public_1");
  expect(service.get).toHaveBeenCalledWith("aud_public_1");
});

test.each([
  [{ document: "" }, 400],
  [{ document: "claim", mode: "deep" }, 400],
  [{ document: "claim", fixture: true }, 400],
] as const)("the public endpoint rejects input outside its one-claim quick contract", async (body, status) => {
  const service = fakeService();
  const response = await handlePublicLiveRequest(new Request("https://saga.example/api/live-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { service });
  expect(response.status).toBe(status);
  expect(service.create).not.toHaveBeenCalled();
});

test("the hosted endpoint reports missing Live credentials without falling back", async () => {
  const response = await handlePublicLiveRequest(new Request("https://saga.example/api/live-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ document: "A factual claim." }),
  }), { env: {} });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Live audit is not configured" });
});

test("public provider wrappers clamp both model queries and search results while preserving provider ids", async () => {
  const querySchema = z.object({
    supportingQueries: z.array(z.string()).min(1),
    skepticQueries: z.array(z.string()).min(1),
  });
  const model: ModelProvider = {
    id: "google-gemini/test",
    async generateStructured<T>() {
      return {
        supportingQueries: ["support one", "support two"],
        skepticQueries: ["skeptic one", "skeptic two"],
      } as T;
    },
  };
  const clampedModel = clampPublicModel(model);
  const plan = await clampedModel.generateStructured({
    purpose: "research_plan",
    system: "system",
    prompt: "prompt",
    schema: querySchema,
  });
  expect(clampedModel.id).toBe(model.id);
  expect(plan).toEqual({ supportingQueries: ["support one"], skepticQueries: ["skeptic one"] });

  const requests: SearchRequest[] = [];
  const search: SearchProvider = {
    id: "tavily-search",
    async search(request) {
      requests.push(request);
      return [
        { title: "One", url: "https://one.example", snippet: "one" },
        { title: "Two", url: "https://two.example", snippet: "two" },
      ];
    },
  };
  const clampedSearch = clampPublicSearch(search);
  const results = await clampedSearch.search({ query: "claim", limit: 20 });
  expect(clampedSearch.id).toBe(search.id);
  expect(requests).toEqual([{ query: "claim", limit: 2 }]);
  expect(results).toEqual([
    { title: "One", url: "https://one.example", snippet: "one" },
    { title: "Two", url: "https://two.example", snippet: "two" },
  ]);
});
