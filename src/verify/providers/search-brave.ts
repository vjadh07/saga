// Live Brave Search adapter. The API boundary is schema-validated before any result enters
// the research pipeline, and transport errors are deliberately summarized so credentials
// can never be reflected through provider error messages.
import { z } from "zod";
import type { SearchProvider, SearchRequest, SearchResult } from "./search.js";

const BRAVE_WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESULTS = 20;

const HttpUrlSchema = z.string().trim().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "result URL must use HTTP or HTTPS");

const BraveWebSearchSchema = z.object({
  web: z.object({
    results: z.array(z.object({
      title: z.string().trim().min(1),
      url: HttpUrlSchema,
      description: z.string().trim(),
      profile: z.object({ long_name: z.string().trim().min(1) }).optional(),
      page_age: z.string().trim().min(1).optional(),
    })),
  }),
});

export interface BraveSearchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type BraveSearchTransport = (url: URL, init: RequestInit) => Promise<BraveSearchResponse>;

export interface BraveSearchProviderOptions {
  apiKey?: string;
  transport?: BraveSearchTransport;
}

const defaultTransport: BraveSearchTransport = async (url, init) => globalThis.fetch(url, init);

export class BraveSearchProvider implements SearchProvider {
  readonly id = "brave-search";
  private apiKey: string;
  private transport: BraveSearchTransport;

  constructor(options: BraveSearchProviderOptions = {}) {
    const suppliedKey = options.apiKey === undefined ? process.env.BRAVE_SEARCH_API_KEY : options.apiKey;
    if (!suppliedKey?.trim()) throw new Error("Brave Search API key is required");
    this.apiKey = suppliedKey.trim();
    this.transport = options.transport ?? defaultTransport;
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    request.signal?.throwIfAborted();
    const query = request.query.trim();
    if (!query) throw new Error("Brave Search query is required");
    if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit <= 0)) {
      throw new Error("Brave Search result limit must be a positive integer");
    }
    const count = Math.min(request.limit ?? MAX_RESULTS, MAX_RESULTS);
    const url = new URL(BRAVE_WEB_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    url.searchParams.set("safesearch", "moderate");

    let response: BraveSearchResponse;
    try {
      response = await this.transport(url, {
        method: "GET",
        signal: request.signal,
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
      });
    } catch {
      request.signal?.throwIfAborted();
      throw new Error("Brave Search request failed");
    }
    if (!response.ok) throw new Error(`Brave Search request failed with status ${response.status}`);

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new Error("Brave Search returned malformed JSON");
    }
    const validated = BraveWebSearchSchema.safeParse(raw);
    if (!validated.success) throw new Error("Brave Search returned an invalid response schema");

    return validated.data.web.results.slice(0, count).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.description,
      ...(result.profile ? { publisher: result.profile.long_name } : {}),
      ...(result.page_age ? { publishedAt: result.page_age } : {}),
    }));
  }
}
