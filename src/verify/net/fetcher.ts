// Secure page fetcher. Validates the URL, resolves and re-checks every redirect hop
// against the SSRF rules, caps redirects, response size, and content type, and extracts
// readable text. The low-level transport is injectable so the security behavior is fully
// testable without a network. The default transport does a DNS lookup, blocks any resolved
// private address, and streams with a size cap and timeout.
import { isBlockedIp, assertSafeUrl } from "./ssrf.js";
import { sha256hex } from "../text.js";
import type { FetchedPage, PageFetcher } from "../providers/fetch.js";

export interface RawResponse {
  status: number;
  headers: { location?: string; "content-type"?: string };
  body: string;
}
export type Transport = (url: URL) => Promise<RawResponse>;

export interface FetcherOptions {
  transport?: Transport;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
  allowedContentTypes?: string[];
  now?: () => string;
}

const DEFAULT_ALLOWED = ["text/html", "text/plain", "application/xhtml+xml"];

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

// Extract a title and readable text, preserving paragraph and heading breaks.
export function extractReadableText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]!).replace(/\s+/g, " ").trim() : "";
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|ul|ol|table|blockquote)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  t = decodeEntities(t)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text: t };
}

// Default transport: real network fetch with DNS SSRF re-check, timeout, and size cap.
// Not exercised by the default test suite (needs network); tests inject a transport.
async function nodeTransport(url: URL, timeoutMs: number, maxBytes: number): Promise<RawResponse> {
  const dns = await import("node:dns/promises");
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => {
    throw new Error(`dns lookup failed for ${url.hostname}`);
  });
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new Error(`blocked resolved address: ${a.address}`);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "user-agent": "SagaAuditor/0.1 (+evidence audit)", accept: "text/html,text/plain" },
    });
    let body = "";
    if (res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          ctrl.abort();
          throw new Error("response too large");
        }
        body += dec.decode(value, { stream: true });
      }
      body += dec.decode();
    }
    return {
      status: res.status,
      headers: { location: res.headers.get("location") ?? undefined, "content-type": res.headers.get("content-type") ?? undefined },
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

export class LivePageFetcher implements PageFetcher {
  readonly id = "live-fetch";
  private transport: Transport;
  private maxRedirects: number;
  private maxBytes: number;
  private allowed: Set<string>;
  private now: () => string;

  constructor(opts: FetcherOptions = {}) {
    this.maxBytes = opts.maxBytes ?? 2_000_000;
    this.maxRedirects = opts.maxRedirects ?? 5;
    this.allowed = new Set((opts.allowedContentTypes ?? DEFAULT_ALLOWED).map((c) => c.toLowerCase()));
    this.now = opts.now ?? (() => new Date().toISOString());
    const timeoutMs = opts.timeoutMs ?? 10_000;
    this.transport = opts.transport ?? ((url) => nodeTransport(url, timeoutMs, this.maxBytes));
  }

  async fetch(url: string): Promise<FetchedPage> {
    const originalUrl = assertSafeUrl(url).href;
    let current = assertSafeUrl(url);
    const visited = new Set([current.href]);

    let res: RawResponse;
    for (let i = 0; ; i++) {
      res = await this.transport(current);
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        if (i >= this.maxRedirects) throw new Error("too many redirects");
        let next: URL;
        try {
          next = new URL(res.headers.location, current);
        } catch {
          throw new Error("invalid redirect location");
        }
        assertSafeUrl(next.href); // re-check scheme, credentials, and blocked addresses
        if (visited.has(next.href)) throw new Error("redirect loop detected");
        visited.add(next.href);
        current = next;
        continue;
      }
      break;
    }

    const contentType = (res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!this.allowed.has(contentType)) {
      throw new Error(`unsupported content type: ${contentType || "unknown"}`);
    }
    if (res.body.length > this.maxBytes) throw new Error("response too large");

    const { title, text } = extractReadableText(res.body);
    return {
      originalUrl,
      finalUrl: current.href,
      status: res.status,
      contentType,
      title,
      text,
      fetchedAt: this.now(),
      contentHash: sha256hex(text),
    };
  }
}
