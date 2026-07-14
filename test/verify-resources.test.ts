import { expect, test } from "vitest";
import { z } from "zod";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { FixtureSearchProvider } from "../src/verify/providers/search.js";
import { FixturePageFetcher } from "../src/verify/providers/fetch.js";
import { AuditResources, MODE_LIMITS } from "../src/verify/live/resources.js";

test("resource limits are explicit and increase by audit mode", () => {
  expect(MODE_LIMITS.quick.maxClaims).toBeLessThan(MODE_LIMITS.deep.maxClaims);
  expect(MODE_LIMITS.deep.maxClaims).toBeLessThan(MODE_LIMITS.high_stakes.maxClaims);
  for (const mode of ["quick", "deep", "high_stakes"] as const) {
    expect(MODE_LIMITS[mode]).toMatchObject({
      maxClaims: expect.any(Number),
      maxSearches: expect.any(Number),
      maxModelCalls: expect.any(Number),
      maxPageFetches: expect.any(Number),
      maxAttempts: expect.any(Number),
      callTimeoutMs: expect.any(Number),
    });
  }
});

test("guarded providers count actual calls and produce deterministic cost estimates", async () => {
  let time = 100;
  const resources = new AuditResources("quick", {
    clock: () => time,
    costRates: { modelCallUsd: 0.02, searchUsd: 0.01, pageFetchUsd: 0.005 },
  });
  resources.checkClaimCount(1);
  const { model, search, fetcher } = resources.guard({
    model: new MockModelProvider({ p: [{ ok: true }] }),
    search: new FixtureSearchProvider({ q: [{ title: "A", url: "https://a.example", snippet: "s" }] }),
    fetcher: new FixturePageFetcher({ "https://a.example": { title: "A", text: "evidence" } }),
  });
  await model.generateStructured({ purpose: "p", system: "", prompt: "", schema: z.object({ ok: z.boolean() }) });
  await search.search({ query: "q" });
  await fetcher.fetch("https://a.example");
  time = 145;
  expect(resources.snapshot()).toEqual({
    durationMs: 45,
    claims: 1,
    modelCalls: 1,
    searches: 1,
    pageFetches: 1,
    retries: 0,
    estimatedCostUsd: 0.035,
    costBasis: "configured per-call rates",
  });
});

test("transient provider failures retry only within the configured bound", async () => {
  let calls = 0;
  const resources = new AuditResources("quick", { retryDelayMs: 0 });
  const { search } = resources.guard({
    model: new MockModelProvider(),
    search: {
      id: "flaky",
      async search() {
        calls += 1;
        if (calls === 1) throw new Error("temporary outage");
        return [];
      },
    },
    fetcher: new FixturePageFetcher(),
  });
  await expect(search.search({ query: "q" })).resolves.toEqual([]);
  expect(calls).toBe(2);
  expect(resources.snapshot().retries).toBe(1);
  expect(resources.snapshot().searches).toBe(2);
});

test("schema failures are not retried", async () => {
  const resources = new AuditResources("quick", { retryDelayMs: 0 });
  const { model } = resources.guard({
    model: new MockModelProvider({ p: [{ ok: "no" }, { ok: true }] }),
    search: new FixtureSearchProvider(),
    fetcher: new FixturePageFetcher(),
  });
  await expect(model.generateStructured({ purpose: "p", system: "", prompt: "", schema: z.object({ ok: z.boolean() }) })).rejects.toThrow();
  expect(resources.snapshot().modelCalls).toBe(1);
  expect(resources.snapshot().retries).toBe(0);
});

test("claim and provider budgets fail closed", async () => {
  const resources = new AuditResources("quick", {
    limits: { ...MODE_LIMITS.quick, maxClaims: 1, maxSearches: 1 },
    retryDelayMs: 0,
  });
  expect(() => resources.checkClaimCount(2)).toThrow(/claim limit/i);
  resources.checkClaimCount(1);
  const { search } = resources.guard({
    model: new MockModelProvider(),
    search: new FixtureSearchProvider(),
    fetcher: new FixturePageFetcher(),
  });
  await search.search({ query: "one" });
  await expect(search.search({ query: "two" })).rejects.toThrow(/search limit/i);
});

test("a provider call times out and respects cancellation", async () => {
  const timeoutResources = new AuditResources("quick", {
    limits: { ...MODE_LIMITS.quick, maxAttempts: 1, callTimeoutMs: 5 },
  });
  const never = timeoutResources.guard({
    model: new MockModelProvider(),
    search: { id: "never", search: async () => new Promise<never>(() => {}) },
    fetcher: new FixturePageFetcher(),
  });
  await expect(never.search.search({ query: "q" })).rejects.toThrow(/timed out/i);

  const controller = new AbortController();
  controller.abort(new Error("cancelled by user"));
  const cancelled = new AuditResources("quick", { signal: controller.signal }).guard({
    model: new MockModelProvider(),
    search: new FixtureSearchProvider(),
    fetcher: new FixturePageFetcher(),
  });
  await expect(cancelled.search.search({ query: "q" })).rejects.toThrow(/cancelled by user/i);
});

test("timeouts abort the underlying provider and never overlap it with a retry", async () => {
  let calls = 0;
  let providerAborted = false;
  const resources = new AuditResources("quick", {
    limits: { ...MODE_LIMITS.quick, maxAttempts: 2, callTimeoutMs: 5 },
    retryDelayMs: 0,
  });
  const guarded = resources.guard({
    model: new MockModelProvider(),
    search: {
      id: "abort-aware",
      async search(request) {
        calls += 1;
        return new Promise<never>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => {
            providerAborted = true;
            reject(request.signal?.reason);
          }, { once: true });
        });
      },
    },
    fetcher: new FixturePageFetcher(),
  });

  await expect(guarded.search.search({ query: "q" })).rejects.toThrow(/timed out/i);
  expect(providerAborted).toBe(true);
  expect(calls).toBe(1);
  expect(resources.snapshot()).toMatchObject({ searches: 1, retries: 0 });
});

test("external cancellation is forwarded into an in-flight provider", async () => {
  const controller = new AbortController();
  let providerSignal: AbortSignal | undefined;
  const guarded = new AuditResources("quick", { signal: controller.signal }).guard({
    model: new MockModelProvider(),
    search: {
      id: "abort-aware",
      async search(request) {
        providerSignal = request.signal;
        return new Promise<never>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
        });
      },
    },
    fetcher: new FixturePageFetcher(),
  });

  const pending = guarded.search.search({ query: "q" });
  controller.abort(new Error("cancelled outside provider"));
  await expect(pending).rejects.toThrow(/cancelled outside provider/i);
  expect(providerSignal?.aborted).toBe(true);
});

test("cost remains unavailable when provider pricing is not configured", () => {
  const resources = new AuditResources("quick", { initialUsage: { modelCalls: 1 } });
  resources.checkClaimCount(1);
  expect(resources.snapshot().modelCalls).toBe(1);
  expect(resources.snapshot().estimatedCostUsd).toBeNull();
  expect(resources.snapshot().costBasis).toMatch(/not configured/i);
});
