// Retrieval orchestration: turn a plan's queries into sanitized sources with full
// provenance. Search, canonicalize, dedup, fetch securely, then pass every page through
// the Safety Sentinel BEFORE any reasoning agent sees it. A single fetch failure is
// recorded and skipped; it never fails the whole retrieval.
import { sanitizeSource } from "../safety.js";
import { extractQuotes, hashId, sha256hex } from "../text.js";
import { canonicalizeUrl } from "../net/url.js";
import type { PageFetcher, FetchedPage } from "../providers/fetch.js";
import type { SearchProvider, SearchResult } from "../providers/search.js";
import type { SafetyEvent, Source } from "../types.js";

export interface RetrievedSource {
  source: Source; // content is the sanitized page text
  fetched: FetchedPage; // urls, access time, content hash
  safety: SafetyEvent[]; // injection quarantined out of this page
  snippet: string; // the search snippet that led here
  query: string;
}

export interface RetrievalError {
  operation: "search" | "search_result" | "fetch";
  query: string;
  url: string | null;
  error: string;
}

function errorMessage(error: unknown, fallback: string): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  return message || fallback;
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export interface RetrieveInput {
  queries: string[];
  search: SearchProvider;
  fetcher: PageFetcher;
  maxSources: number;
  perQueryLimit?: number;
  claimId?: string;
  agent?: "investigator" | "skeptic";
  onSearch?: (query: string) => void;
  onRetrieved?: (source: RetrievedSource) => void;
  onError?: (error: RetrievalError) => void;
}

export interface RetrieveOutput {
  sources: RetrievedSource[];
  errors: RetrievalError[];
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
  const sources: RetrievedSource[] = [];
  const errors: RetrieveOutput["errors"] = [];

  // gather and dedup candidate results across all queries
  const candidates: Array<{ result: SearchResult; query: string }> = [];
  const seenCanonical = new Set<string>();
  for (const q of queries) {
    let pending: Promise<SearchResult[]>;
    try {
      pending = search.search({ query: q, limit });
    } catch (error) {
      input.onSearch?.(q);
      input.onError?.({ operation: "search", query: q, url: null, error: errorMessage(error, "search provider failed without an error message") });
      throw error;
    }
    input.onSearch?.(q);
    let found: SearchResult[];
    try {
      found = await pending;
    } catch (error) {
      input.onError?.({ operation: "search", query: q, url: null, error: errorMessage(error, "search provider failed without an error message") });
      throw error;
    }
    for (const result of found) {
      if (!isHttpUrl(result.url)) {
        const failure: RetrievalError = {
          operation: "search_result",
          query: q,
          url: typeof result.url === "string" && result.url.trim() ? result.url : null,
          error: "search provider returned a missing or non-HTTP URL",
        };
        errors.push(failure);
        input.onError?.(failure);
        continue;
      }
      const canonical = canonicalizeUrl(result.url);
      if (seenCanonical.has(canonical)) continue;
      seenCanonical.add(canonical);
      candidates.push({ result, query: q });
    }
  }
  for (const { result, query } of candidates.slice(0, maxSources)) {
    let fetched: FetchedPage;
    try {
      fetched = await fetcher.fetch(result.url);
    } catch (err) {
      const failure: RetrievalError = { operation: "fetch", query, url: result.url, error: errorMessage(err, "page fetcher failed without an error message") };
      errors.push(failure);
      input.onError?.(failure);
      continue;
    }

    if (sha256hex(fetched.text) !== fetched.contentHash) {
      const failure: RetrievalError = { operation: "fetch", query, url: result.url, error: "page fetcher returned a content hash that does not match the fetched text" };
      errors.push(failure);
      input.onError?.(failure);
      continue;
    }

    const sourceId = hashId("src", fetched.finalUrl, fetched.contentHash);
    const clean = sanitizeSource({ id: sourceId, content: fetched.text });
    const source: Source = {
      id: sourceId,
      url: fetched.originalUrl,
      canonicalUrl: canonicalizeUrl(fetched.finalUrl),
      title: fetched.title || result.title,
      publisher: publisherOf(result, fetched.finalUrl),
      publishedAt: result.publishedAt ?? "",
      sourceType: "unknown", // assessed later by source-quality analysis
      content: clean.clean,
      quotes: extractQuotes(clean.clean),
      outboundCitations: [...new Set(fetched.links.map(canonicalizeUrl))],
      retrievals: [{
        originalUrl: fetched.originalUrl,
        finalUrl: fetched.finalUrl,
        fetchedAt: fetched.fetchedAt,
        contentHash: fetched.contentHash,
        ...(input.claimId && input.agent ? { claimId: input.claimId, agent: input.agent, query } : {}),
      }],
    };
    const retrieved = { source, fetched, safety: clean.events, snippet: result.snippet, query };
    sources.push(retrieved);
    input.onRetrieved?.(retrieved);
  }

  return { sources, errors };
}
