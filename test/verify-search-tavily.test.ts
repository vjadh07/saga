import { expect, test } from "vitest";
import {
  TavilySearchProvider,
  type TavilySearchResponse,
  type TavilySearchTransport,
} from "../src/verify/providers/search-tavily.js";

function response(body: unknown, status = 200): TavilySearchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("TavilySearchProvider sends a basic search request and maps validated results", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const transport: TavilySearchTransport = async (url, init) => {
    requestedUrl = url;
    requestedInit = init;
    return response({
      query: "solar growth",
      results: [
        { title: "Agency report", url: "https://agency.example/report", content: "Capacity rose during 2026.", score: 0.9 },
        { title: "Analysis", url: "https://analysis.example/story", content: "Independent analysis.", score: 0.8 },
      ],
    });
  };
  const provider = new TavilySearchProvider({ apiKey: "tvly-secret", transport });

  const results = await provider.search({ query: "solar growth", limit: 2 });

  expect(provider.id).toBe("tavily-search");
  expect(requestedUrl?.href).toBe("https://api.tavily.com/search");
  expect(requestedInit?.method).toBe("POST");
  expect(requestedInit?.headers).toEqual({
    Authorization: "Bearer tvly-secret",
    "Content-Type": "application/json",
  });
  expect(JSON.parse(String(requestedInit?.body))).toEqual({
    query: "solar growth",
    search_depth: "basic",
    max_results: 2,
    include_answer: false,
    include_raw_content: false,
  });
  expect(results).toEqual([
    { title: "Agency report", url: "https://agency.example/report", snippet: "Capacity rose during 2026." },
    { title: "Analysis", url: "https://analysis.example/story", snippet: "Independent analysis." },
  ]);
});

test("TavilySearchProvider validates configuration and caps results at 20", async () => {
  expect(() => new TavilySearchProvider({ apiKey: "" })).toThrow(/key|required/i);
  let maxResults = 0;
  const provider = new TavilySearchProvider({
    apiKey: "key",
    transport: async (_url, init) => {
      maxResults = JSON.parse(String(init.body)).max_results;
      return response({
        results: Array.from({ length: 25 }, (_, index) => ({
          title: `Result ${index}`,
          url: `https://example.com/${index}`,
          content: `Content ${index}`,
        })),
      });
    },
  });
  expect(await provider.search({ query: "query", limit: 100 })).toHaveLength(20);
  expect(maxResults).toBe(20);
  await expect(provider.search({ query: "  " })).rejects.toThrow(/query|required/i);
  await expect(provider.search({ query: "query", limit: 0 })).rejects.toThrow(/positive integer/i);
});

test("TavilySearchProvider rejects provider and schema errors without exposing its key", async () => {
  const failed = new TavilySearchProvider({
    apiKey: "never-expose-tavily-key",
    transport: async () => response({ detail: "never-expose-tavily-key" }, 429),
  });
  const error = await failed.search({ query: "query" }).catch((reason: unknown) => reason);
  expect((error as Error).message).toMatch(/429/);
  expect((error as Error).message).not.toContain("never-expose-tavily-key");

  const malformed = new TavilySearchProvider({
    apiKey: "key",
    transport: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } }),
  });
  await expect(malformed.search({ query: "query" })).rejects.toThrow(/malformed json/i);

  const invalid = new TavilySearchProvider({ apiKey: "key", transport: async () => response({ results: [{ title: "bad" }] }) });
  await expect(invalid.search({ query: "query" })).rejects.toThrow(/invalid response schema/i);
});

test("TavilySearchProvider sanitizes transport failures and propagates cancellation", async () => {
  const failed = new TavilySearchProvider({
    apiKey: "transport-secret",
    transport: async () => { throw new Error("transport-secret"); },
  });
  const error = await failed.search({ query: "query" }).catch((reason: unknown) => reason);
  expect((error as Error).message).toBe("Tavily Search request failed");

  const controller = new AbortController();
  controller.abort(new Error("cancelled by user"));
  const cancelled = new TavilySearchProvider({ apiKey: "key", transport: async () => response({ results: [] }) });
  await expect(cancelled.search({ query: "query", signal: controller.signal })).rejects.toThrow(/cancelled by user/i);
});
