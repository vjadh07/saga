// Live Tavily Search adapter. Basic search is a direct fit for Saga's discovery boundary;
// every returned page is still fetched, sanitized, hashed, and evidence-validated by Saga.
import { z } from "zod";
import type { SearchProvider, SearchRequest, SearchResult } from "./search.js";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_RESULTS = 20;

const HttpUrlSchema = z.string().trim().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "result URL must use HTTP or HTTPS");

const TavilyResponseSchema = z.object({
  results: z.array(z.object({
    title: z.string().trim().min(1),
    url: HttpUrlSchema,
    content: z.string().trim(),
    score: z.number().optional(),
  }).passthrough()),
}).passthrough();

export interface TavilySearchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type TavilySearchTransport = (url: URL, init: RequestInit) => Promise<TavilySearchResponse>;

export interface TavilySearchProviderOptions {
  apiKey?: string;
  transport?: TavilySearchTransport;
}

const defaultTransport: TavilySearchTransport = async (url, init) => globalThis.fetch(url, init);

export class TavilySearchProvider implements SearchProvider {
  readonly id = "tavily-search";
  private apiKey: string;
  private transport: TavilySearchTransport;

  constructor(options: TavilySearchProviderOptions = {}) {
    const suppliedKey = options.apiKey === undefined ? process.env.TAVILY_API_KEY : options.apiKey;
    if (!suppliedKey?.trim()) throw new Error("Tavily API key is required");
    this.apiKey = suppliedKey.trim();
    this.transport = options.transport ?? defaultTransport;
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    request.signal?.throwIfAborted();
    const query = request.query.trim();
    if (!query) throw new Error("Tavily Search query is required");
    if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit <= 0)) {
      throw new Error("Tavily Search result limit must be a positive integer");
    }
    const count = Math.min(request.limit ?? MAX_RESULTS, MAX_RESULTS);
    let response: TavilySearchResponse;
    try {
      response = await this.transport(new URL(TAVILY_SEARCH_URL), {
        method: "POST",
        signal: request.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: count,
          include_answer: false,
          include_raw_content: false,
        }),
      });
    } catch {
      request.signal?.throwIfAborted();
      throw new Error("Tavily Search request failed");
    }
    if (!response.ok) throw new Error(`Tavily Search request failed with status ${response.status}`);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new Error("Tavily Search returned malformed JSON");
    }
    const validated = TavilyResponseSchema.safeParse(raw);
    if (!validated.success) throw new Error("Tavily Search returned an invalid response schema");
    return validated.data.results.slice(0, count).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.content,
    }));
  }
}
