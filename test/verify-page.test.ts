import { Script } from "node:vm";
import { expect, test } from "vitest";
import type { LiveAuditResult } from "../src/verify/live/audit.js";
import { runAudit, type AuditResult } from "../src/verify/pipeline.js";
import { renderStudioPage } from "../src/verify/web/page.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW } from "../src/verify/fixtures/demo.js";

const demo = runAudit({ auditId: "demo-aud", document: DEMO_DOCUMENT, claims: DEMO_CLAIMS, corpus: DEMO_CORPUS, now: DEMO_NOW });

function liveResult(base: AuditResult = demo): LiveAuditResult {
  return {
    ...base,
    auditId: "live-aud",
    mode: "live",
    dependencies: [],
    reevaluation: [],
    receipt: {
      auditId: "live-aud",
      mode: "live",
      finalAuditHash: "abc123",
      documentHash: "doc123",
      finalDraftHash: "draft123",
      workflowVersion: "test",
      modelProvider: "mock-model",
      modelId: "mock-model",
      searchProvider: "mock-search",
      startedAt: DEMO_NOW,
      completedAt: DEMO_NOW,
    } as LiveAuditResult["receipt"],
    metrics: { durationMs: 10, modelCalls: 2, searches: 3, pageFetches: 4, estimatedCostUsd: 0 } as LiveAuditResult["metrics"],
  } as unknown as LiveAuditResult;
}

function bootstrap(html: string): { embeddedResult: AuditResult | LiveAuditResult; initialView: string; activeAuditId: string | null } {
  const match = html.match(/<script id="studio-bootstrap" type="application\/json">([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!.replace(/\\u003c/g, "<"));
}

test("the root defaults to Live and keeps the deterministic demo result hidden", () => {
  const html = renderStudioPage(demo);
  const data = bootstrap(html);

  expect(data.initialView).toBe("live");
  expect(data.embeddedResult.mode).toBe("demo");
  expect(html).toContain('id="live-view"');
  expect(html).toMatch(/id="result-view"[^>]*hidden/);
  expect(html).toContain("Live mode ready");
  expect(html).not.toContain("Evidence retrieval is not yet wired");
  expect(html).not.toContain("Worked example: a demo report");
});

test("an explicit Demo initial view reveals only a deterministic demo", () => {
  const html = renderStudioPage(demo, { initialView: "demo" });
  const data = bootstrap(html);

  expect(data.initialView).toBe("demo");
  expect(data.embeddedResult.mode).toBe("demo");
  expect(html).toMatch(/id="live-view"[^>]*hidden/);
  expect(html).not.toMatch(/id="result-view"[^>]*hidden/);
  expect(html).toContain("Deterministic demo audit");
  expect(html).toContain("Demo: fixed fictional example.");
  expect(html).toContain("does not search the live web");
});

test("a live-only result routes the Demo control to the deterministic guest demo", () => {
  const html = renderStudioPage(liveResult(), { activeAuditId: "live-aud" });

  expect(html).toContain('window.location.assign("/demo")');
});

test("a live result is always rendered under Live and carries refresh recovery state", () => {
  const html = renderStudioPage(liveResult(), { initialView: "demo", activeAuditId: "live-aud" });
  const data = bootstrap(html);

  expect(data.initialView).toBe("live");
  expect(data.activeAuditId).toBe("live-aud");
  expect(data.embeddedResult.mode).toBe("live");
  expect(html).not.toMatch(/id="live-view"[^>]*hidden/);
  expect(html).not.toMatch(/id="result-view"[^>]*hidden/);
});

test("the client uses the persisted live audit API with polling, cancel, retry, and URL recovery", () => {
  const html = renderStudioPage(demo);

  expect(html).toContain('apiRequest("/api/audits"');
  expect(html).toContain('apiRequest("/api/audits/"+encodeURIComponent(auditId)');
  expect(html).toContain('apiRequest("/api/audits/"+encodeURIComponent(activeAuditId)+"/cancel"');
  expect(html).toContain('apiRequest("/api/audits/"+encodeURIComponent(activeAuditId)+"/retry"');
  expect(html).toContain('new URLSearchParams(window.location.search).get("audit")');
  expect(html).toContain("window.history.replaceState");
  expect(html).toContain("stored.events");
  expect(html).toContain("stored.result");
  expect(html).not.toContain("/api/map");
});

test("live API data is mode-checked and failures never switch to Demo", () => {
  const html = renderStudioPage(demo);

  expect(html).toContain('stored.record.mode!=="live"');
  expect(html).toContain('stored.result.mode!=="live"');
  expect(html).toContain("Live audit failed. Demo mode was not substituted.");
  expect(html).not.toMatch(/catch\([^)]*\)\s*\{[^}]*setView\("demo"\)/s);
});

test("mode controls, input, live state, and claim selection have accessible semantics", () => {
  const html = renderStudioPage(demo);

  expect(html).toContain('type="button" id="view-live"');
  expect(html).toContain('type="button" id="view-demo"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('<label class="input-label" for="intext">Text to verify</label>');
  expect(html).toContain("<fieldset class=\"modes\"><legend>Audit depth</legend>");
  expect(html).toContain('role="status" aria-live="polite"');
  expect(html).toContain('role="alert" aria-live="assertive"');
  expect(html).toContain(":focus-visible");
  expect(html).toContain("'<button type=\"button\" class=\"claim-mark '");
  expect(html).toContain("@media(max-width:640px)");
  expect(html).toContain("prefers-reduced-motion:reduce");
  expect(html).toContain('<details class="proof"');
});

test("failed claim verdicts have an explicit label and visual class", () => {
  const html = renderStudioPage(demo);

  expect(html).toContain('"failed":"v-fail"');
  expect(html).toContain('"failed":"Audit failed"');
  expect(html).toContain(".verdict-badge.v-fail");
  expect(html).toContain(".claim-mark.v-fail");
});

test("the page leads with plain-language decisions and progressively disclosed proof", () => {
  const html = renderStudioPage(demo);
  const visibleMarkup = html.split('<script id="studio-bootstrap"')[0];
  expect(html).toContain("Audit summary");
  expect(html).toContain("Review the flagged claims");
  expect(html).toContain("What Saga found");
  expect(html).toContain("Corrected draft");
  expect(html).toContain("How Saga checked this");
  expect(html).toContain("Source independence");
  expect(html).toContain("Blocked source instructions");
  expect(html).toContain("Verification receipt");
  expect(visibleMarkup).not.toContain("Agent Flight Recorder");
  expect(visibleMarkup).not.toContain("Safety Sentinel");
  expect(html).toContain("demo-aud");
  expect(html).toContain("nw-release");
  expect(html).toContain("reviewspam");
});

test("the page is fully self-contained: no external resources", () => {
  const html = renderStudioPage(demo);
  expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)[^"']*\.(?:css|js|woff2?|png|jpg|svg)/);
  expect(html).not.toMatch(/<link[^>]+href=["']https?:/);
  expect(html).not.toMatch(/<script[^>]+src=/);
});

test("no em dashes on the page", () => {
  const html = renderStudioPage(demo);
  expect(html.includes("—")).toBe(false);
  expect(html.includes("–")).toBe(false);
});

test("the embedded browser program is valid JavaScript", () => {
  const html = renderStudioPage(demo);
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
  const executable = scripts.at(-1)?.[1];
  expect(executable).toBeTruthy();
  if (!executable) throw new Error("rendered page did not contain an executable script");
  expect(() => new Script(executable)).not.toThrow();
});
