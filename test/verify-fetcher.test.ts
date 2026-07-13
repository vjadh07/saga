import { expect, test } from "vitest";
import { LivePageFetcher, type RawResponse, type Transport } from "../src/verify/net/fetcher.js";

const html = (body: string, title = "T") => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
function transport(fn: (url: URL) => RawResponse): Transport {
  return async (url) => fn(url);
}

test("fetches a normal page and extracts readable text with a content hash", async () => {
  const f = new LivePageFetcher({
    transport: transport(() => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: html("<p>Hello world</p><p>Second line</p>") })),
  });
  const page = await f.fetch("https://example.com/a");
  expect(page.title).toBe("T");
  expect(page.text).toContain("Hello world");
  expect(page.text).toContain("Second line");
  expect(page.contentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(page.finalUrl).toBe("https://example.com/a");
});

test("rejects an unsupported content type", async () => {
  const f = new LivePageFetcher({
    transport: transport(() => ({ status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF" })),
  });
  await expect(f.fetch("https://example.com/a")).rejects.toThrow(/content type/i);
});

test("rejects a response larger than the byte cap", async () => {
  const f = new LivePageFetcher({
    maxBytes: 50,
    transport: transport(() => ({ status: 200, headers: { "content-type": "text/html" }, body: html("x".repeat(500)) })),
  });
  await expect(f.fetch("https://example.com/a")).rejects.toThrow(/too large/i);
});

test("blocks a redirect to a private or metadata address", async () => {
  const f = new LivePageFetcher({
    transport: transport(() => ({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" }, body: "" })),
  });
  await expect(f.fetch("https://example.com/a")).rejects.toThrow();
});

test("detects a redirect loop", async () => {
  const f = new LivePageFetcher({
    transport: transport((url) => ({ status: 302, headers: { location: url.href }, body: "" })),
  });
  await expect(f.fetch("https://example.com/a")).rejects.toThrow(/loop/i);
});

test("stops after too many redirects", async () => {
  let n = 0;
  const f = new LivePageFetcher({
    maxRedirects: 2,
    transport: transport(() => ({ status: 302, headers: { location: `https://example.com/r${n++}` }, body: "" })),
  });
  await expect(f.fetch("https://example.com/a")).rejects.toThrow(/too many redirects/i);
});

test("follows a redirect to a public URL and records the final URL", async () => {
  const f = new LivePageFetcher({
    transport: transport((url) =>
      url.href === "https://example.com/a"
        ? { status: 301, headers: { location: "https://example.com/final" }, body: "" }
        : { status: 200, headers: { "content-type": "text/html" }, body: html("<p>Arrived</p>") },
    ),
  });
  const page = await f.fetch("https://example.com/a");
  expect(page.finalUrl).toBe("https://example.com/final");
  expect(page.text).toContain("Arrived");
});
