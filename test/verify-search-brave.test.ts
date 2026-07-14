import { expect, test } from "vitest";
import {
  BraveSearchProvider,
  type BraveSearchResponse,
  type BraveSearchTransport,
} from "../src/verify/providers/search-brave.js";

function response(body: unknown, status = 200): BraveSearchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("BraveSearchProvider sends the official request and maps validated web results", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const transport: BraveSearchTransport = async (url, init) => {
    requestedUrl = url;
    requestedInit = init;
    return response({
      web: {
        results: [
          {
            title: "Agency report",
            url: "https://agency.example/report",
            description: "Capacity increased during the reporting period.",
            profile: { long_name: "National Energy Agency" },
            page_age: "2026-07-01T12:00:00Z",
          },
          {
            title: "Independent analysis",
            url: "https://analysis.example/story",
            description: "An independent summary.",
          },
        ],
      },
    });
  };
  const provider = new BraveSearchProvider({ apiKey: "test-secret-token", transport });

  const results = await provider.search({ query: "solar growth & revenue", limit: 2 });

  expect(provider.id).toBe("brave-search");
  expect(requestedUrl?.origin).toBe("https://api.search.brave.com");
  expect(requestedUrl?.pathname).toBe("/res/v1/web/search");
  expect(requestedUrl?.searchParams.get("q")).toBe("solar growth & revenue");
  expect(requestedUrl?.searchParams.get("count")).toBe("2");
  expect(requestedUrl?.searchParams.get("safesearch")).toBe("moderate");
  expect(requestedInit?.method).toBe("GET");
  expect(requestedInit?.headers).toEqual({
    Accept: "application/json",
    "X-Subscription-Token": "test-secret-token",
  });
  expect(results).toEqual([
    {
      title: "Agency report",
      url: "https://agency.example/report",
      snippet: "Capacity increased during the reporting period.",
      publisher: "National Energy Agency",
      publishedAt: "2026-07-01T12:00:00Z",
    },
    {
      title: "Independent analysis",
      url: "https://analysis.example/story",
      snippet: "An independent summary.",
    },
  ]);
});

test("BraveSearchProvider caps count and returned results at 20", async () => {
  let count = "";
  const results = Array.from({ length: 25 }, (_, index) => ({
    title: `Result ${index}`,
    url: `https://example.com/${index}`,
    description: `Description ${index}`,
  }));
  const provider = new BraveSearchProvider({
    apiKey: "key",
    transport: async (url) => {
      count = url.searchParams.get("count") ?? "";
      return response({ web: { results } });
    },
  });
  expect(await provider.search({ query: "query", limit: 100 })).toHaveLength(20);
  expect(count).toBe("20");
});

test("BraveSearchProvider rejects a missing subscription key", () => {
  expect(() => new BraveSearchProvider({ apiKey: "" })).toThrow(/key|required/i);
  expect(() => new BraveSearchProvider({ apiKey: "   " })).toThrow(/key|required/i);
});

test("BraveSearchProvider rejects non-success responses without exposing its key", async () => {
  let parsed = false;
  const provider = new BraveSearchProvider({
    apiKey: "never-expose-this-token",
    transport: async () => ({
      ok: false,
      status: 429,
      json: async () => {
        parsed = true;
        return { error: "quota" };
      },
    }),
  });
  const error = await provider.search({ query: "query" }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/429/);
  expect((error as Error).message).not.toContain("never-expose-this-token");
  expect(parsed).toBe(false);
});

test("BraveSearchProvider rejects malformed JSON and invalid response schemas", async () => {
  const malformed = new BraveSearchProvider({
    apiKey: "json-secret",
    transport: async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("contains json-secret"); },
    }),
  });
  const malformedError = await malformed.search({ query: "query" }).catch((reason: unknown) => reason);
  expect(malformedError).toBeInstanceOf(Error);
  expect((malformedError as Error).message).toMatch(/malformed json/i);
  expect((malformedError as Error).message).not.toContain("json-secret");

  const invalid = new BraveSearchProvider({
    apiKey: "schema-secret",
    transport: async () => response({ web: { results: [{ title: "Missing fields" }] } }),
  });
  const schemaError = await invalid.search({ query: "query" }).catch((reason: unknown) => reason);
  expect(schemaError).toBeInstanceOf(Error);
  expect((schemaError as Error).message).toMatch(/schema|invalid response/i);
  expect((schemaError as Error).message).not.toContain("schema-secret");
});

test("BraveSearchProvider does not reflect transport errors that could contain credentials", async () => {
  const provider = new BraveSearchProvider({
    apiKey: "transport-secret",
    transport: async () => { throw new Error("request failed with transport-secret"); },
  });
  const error = await provider.search({ query: "query" }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("Brave Search request failed");
  expect((error as Error).message).not.toContain("transport-secret");
});
