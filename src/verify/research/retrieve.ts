// Retrieval orchestration: turn a plan's queries into sanitized sources with full
// provenance. Search, canonicalize, dedup, fetch securely, then pass every page through
// the Safety Sentinel BEFORE any reasoning agent sees it. A single fetch failure is
// recorded and skipped; it never fails the whole retrieval.
import { sanitizeSource } from "../safety.js";
import { extractQuotes, hashId } from "../text.js";
import { canonicalizeUrl, dedupByCanonical } from "../net/url.js";
import type { PageFetcher, FetchedPage } from "../providers/fetch.js";
import type { SearchProvider, SearchResult } from "../providers/search.js";
import type { SafetyEvent, Source } from "../types.js";

export interface RetrievedSource {
  source: Source; // content is the sanitized page text
  fetched: FetchedPage; // urls, access time, content hash
  safety: SafetyEvent[]; // injection quarantined out of this page
  snippet: string; // the search snippet that led here
}

export interface RetrieveInput {
  queries: string[];
  search: SearchProvider;
  fetcher: PageFetcher;
  maxSources: number;
  perQueryLimit?: number;
}

export interface RetrieveOutput {
  sources: RetrievedSource[];
  errors: Array<{ url: string; error: string }>;
}

function publisherOf(result: SearchResult, finalUrl: string): string {
  if (result.publisher) return result.publisher;
  try {
    return new URL(finalUrl).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export async function retrieveSources(input: RetrieveInput): Promise<RetrieveOutput> {
  const { queries, search, fetcher, maxSources } = input;
  const limit = input.perQueryLimit ?? maxSources;

  // gather and dedup candidate results across all queries
  const all: SearchResult[] = [];
  for (const q of queries) {
    all.push(...(await search.search({ query: q, limit })));
  }
  const candidates = dedupByCanonical(all).slice(0, maxSources);

  const sources: RetrievedSource[] = [];
  const errors: RetrieveOutput["errors"] = [];

  for (const result of candidates) {
    let fetched: FetchedPage;
    try {
      fetched = await fetcher.fetch(result.url);
    } catch (err) {
      errors.push({ url: result.url, error: err instanceof Error ? err.message : String(err) });
      continue;
    }

    const clean = sanitizeSource({ id: fetched.finalUrl, content: fetched.text });
    const source: Source = {
      id: hashId("src", fetched.finalUrl),
      url: fetched.originalUrl,
      canonicalUrl: canonicalizeUrl(fetched.finalUrl),
      title: fetched.title || result.title,
      publisher: publisherOf(result, fetched.finalUrl),
      publishedAt: result.publishedAt ?? "",
      sourceType: "unknown", // assessed later by source-quality analysis
      content: clean.clean,
      quotes: extractQuotes(clean.clean),
      outboundCitations: [],
    };
    sources.push({ source, fetched, safety: clean.events, snippet: result.snippet });
  }

  return { sources, errors };
}
