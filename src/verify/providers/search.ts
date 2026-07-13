// Search provider abstraction. The live adapter (phase 5) calls a real search API; the
// fixture adapter returns canned results for tests and Demo mode. Results are plain data:
// title, url, snippet, and optional provenance.
export interface SearchRequest {
  query: string;
  limit?: number;
  claimId?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publisher?: string;
  publishedAt?: string; // ISO date when the provider reports one
}

export interface SearchProvider {
  readonly id: string;
  search(request: SearchRequest): Promise<SearchResult[]>;
}

// Deterministic search for tests and Demo mode: an exact-query map to canned results.
export class FixtureSearchProvider implements SearchProvider {
  readonly id = "fixture-search";
  private byQuery: Record<string, SearchResult[]>;

  constructor(byQuery: Record<string, SearchResult[]> = {}) {
    this.byQuery = byQuery;
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    const hits = this.byQuery[request.query] ?? [];
    return request.limit ? hits.slice(0, request.limit) : hits;
  }
}
