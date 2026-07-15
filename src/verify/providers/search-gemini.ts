// Live Google Search grounding adapter using the Gemini Interactions API. Citation spans
// are discovery snippets only. Saga still fetches every cited page through LivePageFetcher,
// sanitizes it, and validates exact evidence before it can affect a verdict.
import { z } from "zod";
import type { SearchProvider, SearchRequest, SearchResult } from "./search.js";
import {
  GeminiApiClient,
  type GeminiApiClientOptions,
  type GeminiHttpResponse,
  type GeminiTransport,
} from "./gemini-api.js";

export type { GeminiHttpResponse, GeminiTransport } from "./gemini-api.js";

export interface GeminiSearchProviderOptions extends GeminiApiClientOptions {}

const MAX_RESULTS = 20;
const HttpUrlSchema = z.string().trim().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "citation URL must use HTTP or HTTPS");

const InteractionResponseSchema = z.object({
  steps: z.array(z.object({ type: z.string() }).passthrough()),
}).passthrough();

const ModelOutputStepSchema = z.object({
  type: z.literal("model_output"),
  content: z.array(z.object({
    type: z.string(),
    text: z.string().optional(),
    annotations: z.array(z.object({ type: z.string() }).passthrough()).optional(),
  }).passthrough()),
}).passthrough();

const UrlCitationSchema = z.object({
  type: z.literal("url_citation"),
  url: HttpUrlSchema,
  title: z.string().trim().min(1),
  start_index: z.number().int().nonnegative().optional(),
  end_index: z.number().int().nonnegative().optional(),
  startIndex: z.number().int().nonnegative().optional(),
  endIndex: z.number().int().nonnegative().optional(),
}).passthrough();

export class GeminiSearchProvider implements SearchProvider {
  readonly id: string;
  private client: GeminiApiClient;

  constructor(options: GeminiSearchProviderOptions = {}) {
    this.client = new GeminiApiClient(options);
    this.id = `google-search-grounding/${this.client.model}`;
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    request.signal?.throwIfAborted();
    const query = request.query.trim();
    if (!query) throw new Error("Gemini Search query is required");
    if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit <= 0)) {
      throw new Error("Gemini Search result limit must be a positive integer");
    }
    const count = Math.min(request.limit ?? MAX_RESULTS, MAX_RESULTS);
    const raw = await this.client.interact({
      model: this.client.model,
      input: `Search the public web for this exact research query: ${JSON.stringify(query)}. Cite distinct, relevant source pages. Return at least ${count} sources when the web supports them.`,
      tools: [{ type: "google_search" }],
    }, request.signal);

    const response = InteractionResponseSchema.safeParse(raw);
    if (!response.success) throw new Error("Gemini Search returned an invalid response schema");
    const byUrl = new Map<string, SearchResult>();
    for (const rawStep of response.data.steps) {
      if (rawStep.type !== "model_output") continue;
      const step = ModelOutputStepSchema.safeParse(rawStep);
      if (!step.success) throw new Error("Gemini Search returned an invalid response schema");
      for (const block of step.data.content) {
        if (block.type !== "text" || !block.text) continue;
        for (const rawAnnotation of block.annotations ?? []) {
          if (rawAnnotation.type !== "url_citation") continue;
          const annotation = UrlCitationSchema.safeParse(rawAnnotation);
          if (!annotation.success) throw new Error("Gemini Search returned an invalid response schema");
          const start = annotation.data.start_index ?? annotation.data.startIndex ?? 0;
          const end = annotation.data.end_index ?? annotation.data.endIndex ?? start;
          const cited = end >= start && end <= block.text.length ? block.text.slice(start, end).trim() : "";
          const existing = byUrl.get(annotation.data.url);
          if (existing) {
            if (cited && !existing.snippet.includes(cited)) existing.snippet = `${existing.snippet} ${cited}`.trim();
            continue;
          }
          byUrl.set(annotation.data.url, {
            title: annotation.data.title,
            url: annotation.data.url,
            snippet: cited,
          });
        }
      }
    }
    request.signal?.throwIfAborted();
    const results = [...byUrl.values()].slice(0, count);
    if (results.length === 0) throw new Error("Gemini Search returned no cited web results");
    return results;
  }
}
