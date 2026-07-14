// Page fetcher abstraction. The live adapter (phase 5) is SSRF-hardened and fetches real
// pages; the fixture adapter returns canned pages for tests and Demo mode. Every fetched
// page records both URLs, the access time, and a content hash so the receipt can prove
// exactly what text was read.
import { sha256hex } from "../text.js";

export interface FetchedPage {
  originalUrl: string;
  finalUrl: string; // after redirects
  status: number;
  contentType: string;
  title: string;
  text: string; // extracted readable text
  links: string[]; // outbound http(s) links, for lineage
  fetchedAt: string; // ISO
  contentHash: string; // sha256 of text
}

export interface PageFetcher {
  readonly id: string;
  fetch(url: string, context?: { signal?: AbortSignal }): Promise<FetchedPage>;
}

export interface FixturePage {
  title: string;
  text: string;
  contentType?: string;
  finalUrl?: string;
  status?: number;
  links?: string[];
}

// Deterministic fetcher for tests and Demo mode: a url map to canned page content.
export class FixturePageFetcher implements PageFetcher {
  readonly id = "fixture-fetch";
  private pages: Record<string, FixturePage>;
  private now: () => string;

  constructor(pages: Record<string, FixturePage> = {}, now: () => string = () => "2026-07-13T00:00:00.000Z") {
    this.pages = pages;
    this.now = now;
  }

  async fetch(url: string, context: { signal?: AbortSignal } = {}): Promise<FetchedPage> {
    context.signal?.throwIfAborted();
    const p = this.pages[url];
    if (!p) throw new Error(`no fixture page for ${url}`);
    return {
      originalUrl: url,
      finalUrl: p.finalUrl ?? url,
      status: p.status ?? 200,
      contentType: p.contentType ?? "text/html",
      title: p.title,
      text: p.text,
      links: p.links ?? [],
      fetchedAt: this.now(),
      contentHash: sha256hex(p.text),
    };
  }
}
