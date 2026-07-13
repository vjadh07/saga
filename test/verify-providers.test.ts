import { expect, test } from "vitest";
import { z } from "zod";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { FixtureSearchProvider } from "../src/verify/providers/search.js";
import { FixturePageFetcher } from "../src/verify/providers/fetch.js";
import { InMemoryAuditStore } from "../src/verify/providers/store.js";
import { InProcessQueue } from "../src/verify/providers/queue.js";

test("MockModelProvider returns scripted responses in order and validates them", async () => {
  const schema = z.object({ x: z.number() });
  const p = new MockModelProvider({ plan: [{ x: 1 }, { x: 2 }] });
  expect(await p.generateStructured({ purpose: "plan", system: "", prompt: "", schema })).toEqual({ x: 1 });
  expect(await p.generateStructured({ purpose: "plan", system: "", prompt: "", schema })).toEqual({ x: 2 });
});

test("MockModelProvider rejects a response that fails the schema", async () => {
  const schema = z.object({ x: z.number() });
  const p = new MockModelProvider({ plan: [{ x: "nope" }] });
  await expect(p.generateStructured({ purpose: "plan", system: "", prompt: "", schema })).rejects.toThrow();
});

test("MockModelProvider throws when a purpose has no scripted response left", async () => {
  const schema = z.object({ x: z.number() });
  const p = new MockModelProvider({});
  await expect(p.generateStructured({ purpose: "plan", system: "", prompt: "", schema })).rejects.toThrow(/no scripted/i);
});

test("FixtureSearchProvider returns canned results and respects the limit", async () => {
  const p = new FixtureSearchProvider({
    "solar germany": [
      { title: "A", url: "https://a.example/1", snippet: "s" },
      { title: "B", url: "https://b.example/2", snippet: "s" },
    ],
  });
  const r = await p.search({ query: "solar germany", limit: 1 });
  expect(r).toHaveLength(1);
  expect(r[0]!.title).toBe("A");
  expect(await p.search({ query: "unknown" })).toEqual([]);
});

test("FixturePageFetcher returns canned pages and hashes content deterministically", async () => {
  const p = new FixturePageFetcher({
    "https://a.example/1": { title: "A", text: "hello world", contentType: "text/html" },
  });
  const page = await p.fetch("https://a.example/1");
  expect(page.text).toBe("hello world");
  expect(page.finalUrl).toBe("https://a.example/1");
  expect(page.contentHash).toMatch(/^[0-9a-f]{64}$/);
  const again = await p.fetch("https://a.example/1");
  expect(again.contentHash).toBe(page.contentHash);
  await expect(p.fetch("https://missing.example")).rejects.toThrow();
});

test("InMemoryAuditStore persists and loads an audit graph", async () => {
  const store = new InMemoryAuditStore();
  const rec = await store.createAudit({ mode: "live", document: "doc", workspaceId: "ws1" });
  expect(rec.status).toBe("created");
  await store.updateAudit(rec.id, { status: "mapping_claims" });
  await store.appendEvent({ seq: 1, auditId: rec.id, claimId: "", type: "CLAIMS_EXTRACTED", detail: {}, at: "t" });
  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("mapping_claims");
  expect(loaded.record.workspaceId).toBe("ws1");
  expect(loaded.events).toHaveLength(1);
});

test("InMemoryAuditStore isolates audits by id", async () => {
  const store = new InMemoryAuditStore();
  const a = await store.createAudit({ mode: "live", document: "a", workspaceId: "ws1" });
  const b = await store.createAudit({ mode: "live", document: "b", workspaceId: "ws2" });
  expect(a.id).not.toBe(b.id);
  await expect(store.loadAudit("nope")).rejects.toThrow(/not found/i);
});

test("InProcessQueue runs the worker and supports cancellation", async () => {
  const ran: string[] = [];
  const q = new InProcessQueue(async (id, isCancelled) => {
    if (isCancelled()) return;
    ran.push(id);
  });
  await q.enqueue("a1");
  expect(ran).toEqual(["a1"]);
  await q.cancel("a2");
  await q.enqueue("a2");
  expect(ran).toEqual(["a1"]);
});
