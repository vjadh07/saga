import { expect, test } from "vitest";
import { buildReceipt, canonicalJson, verifyReceipt, type BuildReceiptInput } from "../src/verify/receipt.js";

function input(): BuildReceiptInput {
  return {
    auditId: "aud1",
    mode: "live",
    modelProvider: "mock",
    modelId: "mock-1",
    searchProvider: "fixture-search",
    document: "The claim under audit.",
    finalDraft: "The corrected claim.",
    searchQueries: ["q1", "q2"],
    sources: [{ originalUrl: "https://a/1", finalUrl: "https://a/1", accessedAt: "2026-07-13T00:00:00.000Z", contentHash: "abc" }],
    evidence: [{ id: "e1", claimId: "c1", sourceId: "s1", stance: "supports", excerpt: "an excerpt", relation: "direct_support" }],
    contractEvaluations: [],
    verdicts: [{ claimId: "c1", verdict: "supported", confidence: "high" }],
    safetyEvents: [],
    approvedChangeIds: [],
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:01:00.000Z",
  };
}

test("canonicalJson is stable regardless of key order", () => {
  expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  expect(canonicalJson({ a: [{ y: 1, x: 2 }] })).toBe(canonicalJson({ a: [{ x: 2, y: 1 }] }));
});

test("buildReceipt hashes the document, draft, and evidence excerpts", () => {
  const r = buildReceipt(input());
  expect(r.documentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(r.finalDraftHash).toMatch(/^[0-9a-f]{64}$/);
  expect(r.evidence[0]!.excerptHash).toMatch(/^[0-9a-f]{64}$/);
  expect(r.finalAuditHash).toMatch(/^[0-9a-f]{64}$/);
  expect(r.workflowVersion).toBeTruthy();
});

test("a freshly built receipt verifies", () => {
  const r = buildReceipt(input());
  expect(verifyReceipt(r).valid).toBe(true);
});

test("tampering with any field breaks verification", () => {
  const r = buildReceipt(input());
  const tampered = structuredClone(r);
  tampered.verdicts[0]!.verdict = "contradicted";
  expect(verifyReceipt(tampered).valid).toBe(false);

  const tampered2 = structuredClone(r);
  tampered2.evidence[0]!.excerpt = "a different excerpt";
  expect(verifyReceipt(tampered2).valid).toBe(false);
});

test("the same inputs produce the same final hash", () => {
  expect(buildReceipt(input()).finalAuditHash).toBe(buildReceipt(input()).finalAuditHash);
});
