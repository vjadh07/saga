import { expect, test } from "vitest";
import { buildReceipt, canonicalJson, verifyReceipt, type BuildReceiptInput } from "../src/verify/receipt.js";
import { hashId, sha256hex } from "../src/verify/text.js";

const RAW_SOURCE = "raw source";
const SOURCE_URL = "https://a/1";
const SOURCE_ID = hashId("src", SOURCE_URL, sha256hex(RAW_SOURCE));

const ASSESSMENT = {
  relation: "direct_support" as const, explanation: "validated", exactMatchVerified: true,
  sameEntity: true, sameMetric: true, samePeriod: true, samePopulation: true,
  claimStrongerThanSource: false, qualifiersOmitted: false,
};

function input(): BuildReceiptInput {
  return {
    auditId: "aud1",
    mode: "live",
    modelProvider: "mock",
    modelId: "mock-1",
    searchProvider: "fixture-search",
    document: "The claim under audit.",
    finalDraft: "The corrected claim.",
    searches: [
      { sequence: 1, claimId: "c1", agent: "investigator", query: "q1" },
      { sequence: 2, claimId: "c1", agent: "skeptic", query: "q2" },
    ],
    sources: [{
      sourceId: SOURCE_ID,
      sanitizedContentHash: sha256hex("sanitized source"),
      retrievals: [{ claimId: "c1", agent: "investigator", query: "q1", originalUrl: SOURCE_URL, finalUrl: SOURCE_URL, accessedAt: "2026-07-13T00:00:00.000Z", contentHash: sha256hex(RAW_SOURCE) }],
    }],
    evidence: [{ id: "e1", claimId: "c1", sourceId: SOURCE_ID, stance: "supports", excerpt: "an excerpt", citationAssessment: ASSESSMENT }],
    numericChecks: [{ claimId: "c1", kind: "percent_change", expression: "(100 - 80) / 80 * 100 = 25", inputs: { from: 80, to: 100 }, computedResult: 25, claimedResult: 40, matches: false, explanation: "revenue growth", grounded: true, groundingIssues: [], sourceEvidenceIds: ["e1"] }],
    contractEvaluations: [{
      claimId: "c1", supportingCriteriaMet: true, contradictingCriteriaMet: false,
      primaryRequirementMet: true, preferredSourceRequirementMet: true,
      independentOriginRequirementMet: true, temporalRequirementMet: true,
      triggeredAbstentionConditions: [], explanation: "contract satisfied",
    }],
    verdicts: [{ claimId: "c1", verdict: "supported", confidence: "high", supportingEvidenceIds: ["e1"], contradictingEvidenceIds: [] }],
    revisions: [{ claimId: "c1", kind: "update", original: "old claim", replacement: "an excerpt", citationEvidenceIds: ["e1"], source: "revision_agent", numericCheckClaimId: "c1" }],
    safetyEvents: [],
    failures: [],
    approvedChangeIds: [],
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:01:00.000Z",
  };
}

test("canonicalJson is stable regardless of key order", () => {
  expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  expect(canonicalJson({ a: [{ y: 1, x: 2 }] })).toBe(canonicalJson({ a: [{ x: 2, y: 1 }] }));
});

test("canonicalJson rejects values that JSON would silently change", () => {
  expect(() => canonicalJson({ value: Number.NaN })).toThrow(/non-finite/i);
  expect(() => canonicalJson({ value: undefined })).toThrow(/undefined/i);
  expect(() => canonicalJson(new Date("2026-07-13T00:00:00.000Z"))).toThrow(/plain object/i);
});

test("buildReceipt hashes the document, draft, and evidence excerpts", () => {
  const r = buildReceipt(input());
  expect(r.documentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(r.finalDraftHash).toMatch(/^[0-9a-f]{64}$/);
  expect(r.evidence[0]!.excerptHash).toMatch(/^[0-9a-f]{64}$/);
  expect(r.sources[0]!.sanitizedContentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(r.sources[0]!.retrievals[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(r.revisions[0]!.originalHash).toBe(sha256hex("old claim"));
  expect(r.revisions[0]!.replacementHash).toBe(sha256hex("an excerpt"));
  expect(r.searches.map((search) => search.query)).toEqual(["q1", "q2"]);
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

  const tampered3 = structuredClone(r);
  tampered3.numericChecks[0]!.computedResult = 40;
  expect(verifyReceipt(tampered3).valid).toBe(false);

  const tampered4 = structuredClone(r);
  tampered4.sources[0]!.retrievals[0]!.contentHash = sha256hex("different source");
  expect(verifyReceipt(tampered4).valid).toBe(false);

  const tampered5 = structuredClone(r);
  tampered5.revisions[0]!.citationEvidenceIds = [];
  expect(verifyReceipt(tampered5).valid).toBe(false);
});

test("verification checks internal hashes and references even if the outer hash is recomputed", () => {
  const r = buildReceipt(input());
  r.evidence[0]!.excerpt = "altered excerpt";
  const { finalAuditHash: _old, ...body } = r;
  r.finalAuditHash = sha256hex(canonicalJson(body));
  const result = verifyReceipt(r);
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/excerpt|hash/i);

  const changedRetrieval = buildReceipt(input());
  changedRetrieval.sources[0]!.retrievals[0]!.contentHash = sha256hex("altered raw source");
  const { finalAuditHash: _previous, ...changedBody } = changedRetrieval;
  changedRetrieval.finalAuditHash = sha256hex(canonicalJson(changedBody));
  const changedResult = verifyReceipt(changedRetrieval);
  expect(changedResult.valid).toBe(false);
  expect(changedResult.reason).toMatch(/source id|provenance|content/i);

  const changedNumeric = buildReceipt(input());
  changedNumeric.numericChecks[0]!.computedResult = 40;
  const { finalAuditHash: _numericHash, ...numericBody } = changedNumeric;
  changedNumeric.finalAuditHash = sha256hex(canonicalJson(numericBody));
  const numericResult = verifyReceipt(changedNumeric);
  expect(numericResult.valid).toBe(false);
  expect(numericResult.reason).toMatch(/numeric|calculation/i);
});

test("buildReceipt rejects missing provenance and broken grounding references", () => {
  const missingHash = input();
  missingHash.sources[0]!.retrievals[0]!.contentHash = "";
  expect(() => buildReceipt(missingHash)).toThrow(/content hash|provenance/i);

  const unknownSource = input();
  unknownSource.evidence[0]!.sourceId = "missing";
  expect(() => buildReceipt(unknownSource)).toThrow(/source/i);

  const unknownRevisionEvidence = input();
  unknownRevisionEvidence.revisions[0]!.citationEvidenceIds = ["missing"];
  expect(() => buildReceipt(unknownRevisionEvidence)).toThrow(/revision|evidence|citation/i);

  const missingContract = input();
  missingContract.contractEvaluations = [];
  expect(() => buildReceipt(missingContract)).toThrow(/contract/i);

  const unknownVerdictEvidence = input();
  unknownVerdictEvidence.verdicts[0]!.supportingEvidenceIds = ["missing"];
  expect(() => buildReceipt(unknownVerdictEvidence)).toThrow(/verdict|evidence/i);
});

test("the same inputs produce the same final hash", () => {
  expect(buildReceipt(input()).finalAuditHash).toBe(buildReceipt(input()).finalAuditHash);
});
