import { expect, test } from "vitest";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { validateRevision, reviseChange } from "../src/verify/research/revision.js";
import type { Claim, Evidence, NumericCheck, Verdict } from "../src/verify/types.js";

const claim: Claim = {
  id: "c1", originalText: "Northwind is the largest home battery maker in North America.", normalized: "x", claimType: "comparison",
  location: { start: 0, end: 1 }, verifiable: true, timeSensitive: true, risk: "high", status: "contracted", asOf: null,
};
function verdict(v: Verdict["verdict"], correction: string | null): Verdict {
  return { claimId: "c1", verdict: v, confidence: "medium", rationale: "", supporting: [], contradicting: ["e1"], independentOrigins: 1, temporal: null, requiredCorrection: correction };
}
const evidence: Evidence[] = [
  {
    id: "e1", claimId: "c1", sourceId: "s1", stance: "contradicts", excerpt: "a rival overtook Northwind in 2025", relevance: "strong", capturedBy: "skeptic",
    citationAssessment: { relation: "direct_contradiction", explanation: "validated", exactMatchVerified: true, sameEntity: true, sameMetric: true, samePeriod: true, samePopulation: true, claimStrongerThanSource: false, qualifiersOmitted: false },
  },
];

test("validateRevision passes clean grounded prose", () => {
  const v = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "A rival overtook Northwind in 2025.", verdictKind: "outdated", citationIds: ["e1"], evidence });
  expect(v.ok).toBe(true);
  expect(v.citations).toEqual(["e1"]);
});

test("validateRevision rejects an unsupported number", () => {
  const v = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "Northwind held 73% of the market.", verdictKind: "outdated", citationIds: ["e1"], evidence });
  expect(v.ok).toBe(false);
  expect(v.reason).toMatch(/number/i);
});

test("validateRevision rejects unknown citations instead of dropping them", () => {
  const v = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "A rival overtook Northwind in 2025.", verdictKind: "outdated", citationIds: ["e1", "eZ"], evidence });
  expect(v.ok).toBe(false);
  expect(v.reason).toMatch(/citation/i);
});

test("validateRevision rejects prose that restates a contradicted claim", () => {
  const v = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: claim.originalText, verdictKind: "contradicted", citationIds: ["e1"], evidence });
  expect(v.ok).toBe(false);
});

test("validateRevision requires citations and uses only cited evidence", () => {
  const missing = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "A rival overtook Northwind in 2025.", verdictKind: "outdated", citationIds: [], evidence });
  expect(missing.ok).toBe(false);
  expect(missing.reason).toMatch(/citation/i);

  const uncited: Evidence = {
    ...evidence[0]!, id: "e2", sourceId: "s2", excerpt: "Northwind caused nationwide battery fires",
  };
  const borrowed = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "Northwind caused nationwide battery fires.", verdictKind: "outdated", citationIds: ["e1"], evidence: [...evidence, uncited] });
  expect(borrowed.ok).toBe(false);
  expect(borrowed.reason).toMatch(/ground|unsupported/i);
});

test("validateRevision rejects nonnumeric hallucinations and semantic role reversal", () => {
  const hallucination = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "A rival overtook Northwind in 2025 after nationwide battery fires.", verdictKind: "outdated", citationIds: ["e1"], evidence });
  expect(hallucination.ok).toBe(false);
  const reversed = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "Northwind overtook a rival in 2025.", verdictKind: "outdated", citationIds: ["e1"], evidence });
  expect(reversed.ok).toBe(false);
  expect(reversed.reason).toMatch(/order|ground|unsupported/i);

  const historical = { ...evidence[0]!, id: "historical", excerpt: "A rival was ahead of Northwind in 2025" };
  const tenseShift = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "A rival is ahead of Northwind in 2025.", verdictKind: "outdated", citationIds: ["historical"], evidence: [historical] });
  expect(tenseShift.ok).toBe(false);
});

test("validateRevision rejects foreign, unvalidated, duplicate, and placeholder grounding", () => {
  const foreign = { ...evidence[0]!, id: "foreign", claimId: "other" };
  const bare = { ...evidence[0]!, id: "bare", citationAssessment: undefined };
  for (const [citationIds, supplied] of [[['foreign'], [foreign]], [['bare'], [bare]]] as Array<[string[], Evidence[]]>) {
    const v = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "A rival overtook Northwind in 2025.", verdictKind: "outdated", citationIds, evidence: supplied });
    expect(v.ok).toBe(false);
  }
  const duplicate = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "A rival overtook Northwind in 2025.", verdictKind: "outdated", citationIds: ["e1", "e1"], evidence });
  expect(duplicate.ok).toBe(false);
  const placeholder = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "[update: insert the current leader]", verdictKind: "outdated", citationIds: ["e1"], evidence });
  expect(placeholder.ok).toBe(false);
});

test("validateRevision enforces verdict-specific evidence sides", () => {
  const supporting: Evidence = {
    ...evidence[0]!, id: "support", sourceId: "support-source", stance: "supports", excerpt: "Northwind remains the largest maker",
    capturedBy: "investigator", citationAssessment: { ...evidence[0]!.citationAssessment!, relation: "direct_support" },
  };
  const v = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "Northwind remains the largest maker.", verdictKind: "contradicted", citationIds: ["support"], evidence: [supporting] });
  expect(v.ok).toBe(false);
  expect(v.reason).toMatch(/contradict|verdict|side/i);
});

test("validateRevision cannot splice entities and predicates across source clauses", () => {
  const clauses: Evidence = { ...evidence[0]!, id: "clauses", excerpt: "Alice won an award. Bob committed fraud." };
  const v = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "Alice committed fraud.", verdictKind: "contradicted", citationIds: ["clauses"], evidence: [clauses] });
  expect(v.ok).toBe(false);
  for (const excerpt of ["Alice won an award: Bob committed fraud.", "Alice won an award because Bob committed fraud.", "Alice said Bob committed fraud."]) {
    const item: Evidence = { ...clauses, excerpt };
    expect(validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "Alice committed fraud.", verdictKind: "contradicted", citationIds: ["clauses"], evidence: [item] }).ok).toBe(false);
  }
});

test("validateRevision preserves spaced signs and modal qualifiers", () => {
  const signed: Evidence = { ...evidence[0]!, id: "signed", excerpt: "A 5% increase was reported" };
  const sign = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "A - 5% increase was reported.", verdictKind: "contradicted", citationIds: ["signed"], evidence: [signed] });
  expect(sign.ok).toBe(false);
  for (const replacement of ["A (5%) increase was reported.", "A – 5% increase was reported."]) {
    expect(validateRevision({ claimId: claim.id, original: claim.originalText, replacement, verdictKind: "contradicted", citationIds: ["signed"], evidence: [signed] }).ok).toBe(false);
  }

  const modal: Evidence = { ...evidence[0]!, id: "modal", excerpt: "Alice may commit fraud" };
  const qualifier = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "Alice commits fraud.", verdictKind: "contradicted", citationIds: ["modal"], evidence: [modal] });
  expect(qualifier.ok).toBe(false);
});

test("a qualification cannot omit its structural geographic scope", () => {
  const scoped: Evidence = {
    ...evidence[0]!, id: "scoped", stance: "qualifies", relevance: "weak", excerpt: "Revenue grew in Europe", capturedBy: "skeptic",
    citationAssessment: { ...evidence[0]!.citationAssessment!, relation: "qualification", samePopulation: false },
  };
  const v = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "Revenue grew.", verdictKind: "supported_with_qualifications", citationIds: ["scoped"], evidence: [scoped] });
  expect(v.ok).toBe(false);
});

test("a revision cannot drop attribution when citation validation found omitted qualifiers", () => {
  const attributed: Evidence = {
    ...evidence[0]!, id: "attributed", excerpt: "Bob said Alice did not commit fraud",
    citationAssessment: { ...evidence[0]!.citationAssessment!, qualifiersOmitted: true },
  };
  const v = validateRevision({ claimId: claim.id, original: "Alice committed fraud.", replacement: "Alice did not commit fraud.", verdictKind: "contradicted", citationIds: ["attributed"], evidence: [attributed] });
  expect(v.ok).toBe(false);
});

test("validateRevision ignores arbitrary extra numeric input keys", () => {
  const numeric: NumericCheck = {
    claimId: "c1", kind: "percent_change", expression: "(100 - 80) / 80 * 100 = 25", inputs: { from: 80, to: 100, fabricated: 999 }, computedResult: 25, claimedResult: 40,
    matches: false, explanation: "verified arithmetic", grounded: true, groundingIssues: [], sourceEvidenceIds: [],
  };
  const v = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "Fabricated 999.", verdictKind: "contradicted", citationIds: [], evidence: [], numeric });
  expect(v.ok).toBe(false);
});

test("a numeric mismatch cannot retain the disproven claimed result from cited prose", () => {
  const numeric: NumericCheck = {
    claimId: "c1", kind: "percent_change", expression: "(100 - 80) / 80 * 100 = 25", inputs: { from: 80, to: 100 }, computedResult: 25, claimedResult: 40,
    matches: false, explanation: "verified arithmetic", grounded: true, groundingIssues: [], sourceEvidenceIds: [],
  };
  const falseResult: Evidence = { ...evidence[0]!, id: "false-result", excerpt: "Revenue grew 40% according to the release" };
  const v = validateRevision({ claimId: claim.id, original: claim.originalText, replacement: "Revenue grew 40% according to the release.", verdictKind: "contradicted", citationIds: ["false-result"], evidence: [falseResult], numeric });
  expect(v.ok).toBe(false);
  expect(v.reason).toMatch(/number|numeric|result/i);
});

test("reviseChange uses validated model prose when it passes", async () => {
  const model = new MockModelProvider({ revision: [{ replacement: "A rival overtook Northwind in 2025.", citationEvidenceIds: ["e1"] }] });
  const change = await reviseChange({ claim, verdict: verdict("outdated", "Update the claim."), evidence, model });
  expect(change).not.toBeNull();
  expect(change!.source).toBe("revision_agent");
  expect(change!.replacement).toMatch(/rival overtook/);
  expect(change!.citations).toEqual(["e1"]);
});

test("reviseChange falls back to polished evidence prose when model prose is invalid", async () => {
  const model = new MockModelProvider({ revision: [{ replacement: "Northwind held 99% of the market forever.", citationEvidenceIds: ["e1"] }] });
  const change = await reviseChange({ claim, verdict: verdict("outdated", "Update the claim."), evidence, model });
  expect(change!.source).toBe("deterministic_revision");
  expect(change!.replacement).toBe("A rival overtook Northwind in 2025.");
  expect(change!.replacement).not.toMatch(/\[(?:update|removed|qualify|unverified)/i);
  expect(change!.citations).toEqual(["e1"]);
});

test("reviseChange bypasses the model and removes an insufficient ungrounded claim", async () => {
  const model = new MockModelProvider({ revision: [{ replacement: "Northwind is secretly dominant.", citationEvidenceIds: [] }] });
  const change = await reviseChange({ claim, verdict: { ...verdict("insufficient_evidence", "Remove the unverified claim."), contradicting: [] }, evidence: [], model });
  expect(change!.source).toBe("deterministic_revision");
  expect(change!.replacement).toBe("");
});

test("a matching grounded numeric trace can ground a citation-free correction", async () => {
  const numeric: NumericCheck = {
    claimId: "c1", kind: "percent_change", expression: "((100 - 80) / 80) * 100 = 25", inputs: { from: 80, to: 100 }, computedResult: 25, claimedResult: 40,
    matches: false, explanation: "verified arithmetic", grounded: true, groundingIssues: [], sourceEvidenceIds: [],
  };
  const numericClaim: Claim = { ...claim, originalText: "Revenue grew from 80 to 100, a 40% increase.", claimType: "numeric" };
  const model = new MockModelProvider({ revision: [{ replacement: "The verified percent change is 25%.", citationEvidenceIds: [] }] });
  const change = await reviseChange({ claim: numericClaim, verdict: { ...verdict("contradicted", "Correct the percentage."), supporting: [], contradicting: [] }, evidence: [], numeric, model });
  expect(change!.source).toBe("revision_agent");
  expect(change!.replacement).toBe("The verified percent change is 25%.");
  expect(change!.citations).toEqual([]);
});

test("deterministic numeric fallback preserves a decimal computed result", async () => {
  const numeric: NumericCheck = {
    claimId: "c1", kind: "percent_change", expression: "verified expression = 25.5", inputs: { from: 200, to: 251 }, computedResult: 25.5, claimedResult: 40,
    matches: false, explanation: "verified arithmetic", grounded: true, groundingIssues: [], sourceEvidenceIds: [],
  };
  const model = new MockModelProvider({ revision: [{ replacement: "The verified percent change is 99%.", citationEvidenceIds: [] }] });
  const change = await reviseChange({ claim, verdict: { ...verdict("contradicted", "Correct the percentage."), supporting: [], contradicting: [] }, evidence: [], numeric, model });
  expect(change!.source).toBe("deterministic_revision");
  expect(change!.replacement).toBe("The verified percent change is 25.5%.");
});

test("deterministic disputed fallback presents both evidence sides", async () => {
  const supporting: Evidence = {
    ...evidence[0]!, id: "support", sourceId: "support-source", stance: "supports", excerpt: "Northwind led the market in one survey", capturedBy: "investigator",
    citationAssessment: { ...evidence[0]!.citationAssessment!, relation: "direct_support" },
  };
  const disputed = { ...verdict("disputed", "Present both sides."), supporting: ["support"], contradicting: ["e1"] };
  const change = await reviseChange({ claim, verdict: disputed, evidence: [supporting, ...evidence], model: new MockModelProvider({}) });
  expect(change!.source).toBe("deterministic_revision");
  expect(change!.replacement).toContain("Northwind led the market in one survey.");
  expect(change!.replacement).toContain("A rival overtook Northwind in 2025.");
  expect(change!.citations).toEqual(["support", "e1"]);
});

test("reviseChange returns null for a claim that needs no correction", async () => {
  const model = new MockModelProvider({});
  const change = await reviseChange({ claim, verdict: verdict("supported", null), evidence, model });
  expect(change).toBeNull();
});
