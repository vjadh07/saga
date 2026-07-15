import { expect, test } from "vitest";
import {
  GeminiSearchProvider,
  type GeminiHttpResponse,
  type GeminiTransport,
} from "../src/verify/providers/search-gemini.js";

function response(body: unknown, status = 200): GeminiHttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("GeminiSearchProvider invokes Google Search grounding and maps direct cited URLs", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const transport: GeminiTransport = async (url, init) => {
    requestedUrl = url;
    requestedInit = init;
    return response({
      steps: [
        { type: "google_search_call", arguments: { queries: ["official solar capacity report"] } },
        {
          type: "model_output",
          content: [{
            type: "text",
            text: "Official capacity reached 90 GW. Independent analysts reported 88 GW.",
            annotations: [
              { type: "url_citation", url: "https://agency.example/report", title: "National Energy Agency", start_index: 0, end_index: 32 },
              { type: "url_citation", url: "https://analysis.example/story", title: "Independent Analysis", start_index: 33, end_index: 69 },
            ],
          }],
        },
      ],
    });
  };
  const provider = new GeminiSearchProvider({ apiKey: "gemini-secret", transport });

  const results = await provider.search({ query: "solar capacity 2026", limit: 2 });

  expect(provider.id).toBe("google-search-grounding/gemini-3.1-flash-lite");
  expect(requestedUrl?.href).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
  expect(requestedInit?.method).toBe("POST");
  expect(requestedInit?.headers).toEqual({
    "Content-Type": "application/json",
    "x-goog-api-key": "gemini-secret",
  });
  const body = JSON.parse(String(requestedInit?.body));
  expect(body.model).toBe("gemini-3.1-flash-lite");
  expect(body.tools).toEqual([{ type: "google_search" }]);
  expect(body.input).toContain("solar capacity 2026");
  expect(results).toEqual([
    {
      title: "National Energy Agency",
      url: "https://agency.example/report",
      snippet: "Official capacity reached 90 GW.",
    },
    {
      title: "Independent Analysis",
      url: "https://analysis.example/story",
      snippet: "Independent analysts reported 88 GW.",
    },
  ]);
});

test("GeminiSearchProvider deduplicates URLs, combines cited spans, and respects the limit", async () => {
  const provider = new GeminiSearchProvider({
    apiKey: "key",
    transport: async () => response({
      steps: [{
        type: "model_output",
        content: [{
          type: "text",
          text: "First fact. Second fact. Third fact.",
          annotations: [
            { type: "url_citation", url: "https://one.example/report", title: "One", start_index: 0, end_index: 11 },
            { type: "url_citation", url: "https://one.example/report", title: "One", start_index: 12, end_index: 24 },
            { type: "url_citation", url: "https://two.example/report", title: "Two", start_index: 25, end_index: 36 },
          ],
        }],
      }],
    }),
  });
  expect(await provider.search({ query: "facts", limit: 1 })).toEqual([{
    title: "One",
    url: "https://one.example/report",
    snippet: "First fact. Second fact.",
  }]);
});

test("GeminiSearchProvider requires valid configuration and query input", async () => {
  expect(() => new GeminiSearchProvider({ apiKey: "" })).toThrow(/key|required/i);
  expect(() => new GeminiSearchProvider({ apiKey: "key", model: "../secret" })).toThrow(/model/i);
  const provider = new GeminiSearchProvider({ apiKey: "key", transport: async () => response({ steps: [] }) });
  await expect(provider.search({ query: "   " })).rejects.toThrow(/query|required/i);
  await expect(provider.search({ query: "query", limit: 0 })).rejects.toThrow(/positive integer/i);
});

test("GeminiSearchProvider fails clearly when grounding returns no cited web results", async () => {
  const provider = new GeminiSearchProvider({
    apiKey: "key",
    transport: async () => response({
      steps: [{ type: "model_output", content: [{ type: "text", text: "No web citations were returned." }] }],
    }),
  });
  await expect(provider.search({ query: "query" })).rejects.toThrow(/no cited web results/i);
});

test("GeminiSearchProvider rejects provider errors and malformed responses without exposing its key", async () => {
  const failed = new GeminiSearchProvider({
    apiKey: "never-expose-gemini-key",
    transport: async () => response({ error: "never-expose-gemini-key" }, 403),
  });
  const providerError = await failed.search({ query: "query" }).catch((reason: unknown) => reason);
  expect((providerError as Error).message).toMatch(/403/);
  expect((providerError as Error).message).not.toContain("never-expose-gemini-key");

  const malformedJson = new GeminiSearchProvider({
    apiKey: "key",
    transport: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } }),
  });
  await expect(malformedJson.search({ query: "query" })).rejects.toThrow(/malformed json/i);

  const malformedShape = new GeminiSearchProvider({
    apiKey: "key",
    transport: async () => response({ steps: "not-an-array" }),
  });
  await expect(malformedShape.search({ query: "query" })).rejects.toThrow(/invalid response schema/i);
});

test("GeminiSearchProvider sanitizes transport failures and propagates cancellation", async () => {
  const failed = new GeminiSearchProvider({
    apiKey: "transport-secret",
    transport: async () => { throw new Error("failed with transport-secret"); },
  });
  const error = await failed.search({ query: "query" }).catch((reason: unknown) => reason);
  expect((error as Error).message).toBe("Gemini API request failed");

  const controller = new AbortController();
  controller.abort(new Error("cancelled by user"));
  const cancelled = new GeminiSearchProvider({ apiKey: "key", transport: async () => response({ steps: [] }) });
  await expect(cancelled.search({ query: "query", signal: controller.signal })).rejects.toThrow(/cancelled by user/i);
});
