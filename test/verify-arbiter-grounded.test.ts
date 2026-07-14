import { expect, test } from "vitest";
import { groundedArbitrate } from "../src/verify/research/arbiter-grounded.js";
import type { ConflictAnalysis, ContractEvaluation, Evidence, NumericCheck, TemporalAssessment } from "../src/verify/types.js";

const claim = { id: "c1", verifiable: true, timeSensitive: false };
const noTemporal: TemporalAssessment = { scope: "undated", claimAsOf: null, latestEvidenceAt: null, superseded: false, note: "" };
const noConflict: ConflictAnalysis = { claimId: "c1", hasConflict: false, cause: "none", reconciled: false, explanation: "" };
function contractEval(over: Partial<ContractEvaluation> = {}): ContractEvaluation {
  return { claimId: "c1", supportingCriteriaMet: true, contradictingCriteriaMet: false, primaryRequirementMet: true, preferredSourceRequirementMet: true, independentOriginRequirementMet: true, temporalRequirementMet: true, triggeredAbstentionConditions: [], explanation: "", ...over };
}
let n = 0;
function ev(stance: Evidence["stance"], relevance: Evidence["relevance"] = "strong"): Evidence {
  n++;
  const relation = stance === "supports" ? (relevance === "strong" ? "direct_support" : "partial_support") : stance === "contradicts" ? "direct_contradiction" : "qualification";
  return { id: `e${n}`, claimId: "c1", sourceId: `s${n}`, stance, excerpt: "x", relevance, capturedBy: stance === "supports" ? "investigator" : "skeptic", citationAssessment: { relation, explanation: "validated", exactMatchVerified: true, sameEntity: true, sameMetric: true, samePeriod: true, samePopulation: true, claimStrongerThanSource: relevance === "weak", qualifiersOmitted: false } };
}
const base = { claim, contractEvaluation: contractEval(), temporal: noTemporal, numeric: null as NumericCheck | null, conflict: noConflict, supportOrigins: 2, contraOrigins: 0 };

test("a deterministic numeric mismatch contradicts with high confidence", () => {
  const numeric: NumericCheck = { claimId: "c1", kind: "percent_change", expression: "", inputs: {}, computedResult: 25, claimedResult: 40, matches: false, explanation: "", grounded: true, groundingIssues: [], sourceEvidenceIds: [] };
  const v = groundedArbitrate({ ...base, evidence: [ev("supports")], numeric });
  expect(v.verdict).toBe("contradicted");
  expect(v.confidence).toBe("high");
});

test("an ungrounded numeric mismatch cannot contradict a claim", () => {
  const numeric: NumericCheck = { claimId: "c1", kind: "percent_change", expression: "", inputs: {}, computedResult: 25, claimedResult: 40, matches: null, explanation: "", grounded: false, groundingIssues: ["claimed result absent"], sourceEvidenceIds: [] };
  const v = groundedArbitrate({ ...base, evidence: [ev("supports")], numeric });
  expect(v.verdict).toBe("supported");
});

test("failed research yields a failed verdict, not a contradiction", () => {
  const v = groundedArbitrate({ ...base, evidence: [], researchFailed: true });
  expect(v.verdict).toBe("failed");
});

test("clean support with a satisfied contract is supported", () => {
  const v = groundedArbitrate({ ...base, evidence: [ev("supports"), ev("supports")] });
  expect(v.verdict).toBe("supported");
  expect(v.supporting.length).toBe(2);
});

test("a contract abstention condition with support downgrades to qualified", () => {
  const v = groundedArbitrate({ ...base, evidence: [ev("supports")], contractEvaluation: contractEval({ primaryRequirementMet: false, triggeredAbstentionConditions: ["a primary source is required but none was accepted"] }) });
  expect(v.verdict).toBe("supported_with_qualifications");
  expect(v.requiredCorrection).toMatch(/primary/i);
});

test("no evidence abstains as insufficient", () => {
  const v = groundedArbitrate({ ...base, evidence: [], supportOrigins: 0, contractEvaluation: contractEval({ supportingCriteriaMet: false, triggeredAbstentionConditions: ["no supporting evidence"] }) });
  expect(v.verdict).toBe("insufficient_evidence");
});

test("bare or relation-inconsistent evidence cannot reach an Arbiter verdict", () => {
  const bare = ev("supports");
  delete bare.citationAssessment;
  const bareVerdict = groundedArbitrate({ ...base, evidence: [bare] });
  expect(bareVerdict.verdict).toBe("insufficient_evidence");
  expect(bareVerdict.supporting).toEqual([]);

  const inconsistent = ev("supports");
  inconsistent.citationAssessment = { relation: "direct_contradiction", explanation: "mismatch", exactMatchVerified: true, sameEntity: true, sameMetric: true, samePeriod: true, samePopulation: true, claimStrongerThanSource: false, qualifiersOmitted: false };
  const inconsistentVerdict = groundedArbitrate({ ...base, evidence: [inconsistent] });
  expect(inconsistentVerdict.verdict).toBe("insufficient_evidence");
});

test("contract result flags gate otherwise validated evidence", () => {
  const support = groundedArbitrate({ ...base, evidence: [ev("supports")], contractEvaluation: contractEval({ supportingCriteriaMet: false }) });
  expect(support.verdict).toBe("insufficient_evidence");
  const contra = groundedArbitrate({ ...base, evidence: [ev("contradicts")], contractEvaluation: contractEval({ contradictingCriteriaMet: false }) });
  expect(contra.verdict).toBe("insufficient_evidence");
});

test("primary and independent-origin contract failures qualify support even if the explanation list is inconsistent", () => {
  const primary = groundedArbitrate({ ...base, evidence: [ev("supports")], contractEvaluation: contractEval({ primaryRequirementMet: false }) });
  expect(primary.verdict).toBe("supported_with_qualifications");
  const origins = groundedArbitrate({ ...base, evidence: [ev("supports")], contractEvaluation: contractEval({ independentOriginRequirementMet: false }) });
  expect(origins.verdict).toBe("supported_with_qualifications");
});

test("contract-ineligible support cannot turn a supported contradiction into a dispute", () => {
  const contractEvaluation = contractEval({
    contradictingCriteriaMet: true,
    primaryRequirementMet: false,
    triggeredAbstentionConditions: ["a primary source is required but none was accepted"],
  });
  const v = groundedArbitrate({
    ...base,
    contractEvaluation,
    evidence: [ev("supports"), ev("contradicts")],
    contraOrigins: 1,
    conflict: { claimId: "c1", hasConflict: true, cause: "genuine_dispute", reconciled: false, explanation: "same question" },
  });
  expect(v.verdict).toBe("contradicted");
});

test("weak partial support cannot outweigh a strong direct contradiction", () => {
  const v = groundedArbitrate({
    ...base,
    contractEvaluation: contractEval({ contradictingCriteriaMet: true }),
    evidence: [ev("supports", "weak"), ev("contradicts")],
    supportOrigins: 1,
    contraOrigins: 1,
  });
  expect(v.verdict).toBe("contradicted");
});

test("weak partial support alone is qualified rather than clean support", () => {
  const v = groundedArbitrate({ ...base, evidence: [ev("supports", "weak")], supportOrigins: 1 });
  expect(v.verdict).toBe("supported_with_qualifications");
});

test("conflict metadata must belong to this claim and describe a real conflict", () => {
  const contractEvaluation = contractEval({ contradictingCriteriaMet: true });
  const evidence = [ev("supports"), ev("contradicts")];
  const foreign = groundedArbitrate({ ...base, contractEvaluation, evidence, contraOrigins: 1, conflict: { claimId: "other", hasConflict: true, cause: "different_region", reconciled: true, explanation: "other claim" } });
  expect(foreign.verdict).toBe("disputed");
  const absent = groundedArbitrate({ ...base, contractEvaluation, evidence, contraOrigins: 1, conflict: { claimId: "c1", hasConflict: false, cause: "different_region", reconciled: true, explanation: "not analyzed" } });
  expect(absent.verdict).toBe("disputed");
});

test("evidence and numeric checks from another claim are ignored", () => {
  const foreignEvidence = ev("supports");
  foreignEvidence.claimId = "other";
  expect(groundedArbitrate({ ...base, evidence: [foreignEvidence] }).verdict).toBe("insufficient_evidence");

  const numeric: NumericCheck = { claimId: "other", kind: "percent_change", expression: "", inputs: {}, computedResult: 25, claimedResult: 40, matches: false, explanation: "", grounded: true, groundingIssues: [], sourceEvidenceIds: [] };
  expect(groundedArbitrate({ ...base, evidence: [], numeric }).verdict).toBe("insufficient_evidence");
});

test("a genuine dispute is disputed; a reconciled conflict is qualified", () => {
  const contractEvaluation = contractEval({ contradictingCriteriaMet: true });
  const disputed = groundedArbitrate({ ...base, contractEvaluation, evidence: [ev("supports"), ev("contradicts")], contraOrigins: 1, conflict: { claimId: "c1", hasConflict: true, cause: "genuine_dispute", reconciled: false, explanation: "" } });
  expect(disputed.verdict).toBe("disputed");
  const reconciled = groundedArbitrate({ ...base, contractEvaluation, evidence: [ev("supports"), ev("contradicts")], contraOrigins: 1, conflict: { claimId: "c1", hasConflict: true, cause: "different_region", reconciled: true, explanation: "" } });
  expect(reconciled.verdict).toBe("supported_with_qualifications");
});

test("a superseded current claim is outdated", () => {
  const temporal: TemporalAssessment = { scope: "current", claimAsOf: null, latestEvidenceAt: null, superseded: true, note: "no longer current" };
  const v = groundedArbitrate({ ...base, contractEvaluation: contractEval({ contradictingCriteriaMet: true, temporalRequirementMet: false }), evidence: [ev("supports"), ev("contradicts")], contraOrigins: 1, temporal });
  expect(v.verdict).toBe("outdated");
});

test("a stale-evidence contract result preserves valid historical support for an outdated verdict", () => {
  const temporal: TemporalAssessment = { scope: "current", claimAsOf: null, latestEvidenceAt: null, superseded: true, note: "newer evidence supersedes the claim" };
  const v = groundedArbitrate({
    ...base,
    contractEvaluation: contractEval({
      contradictingCriteriaMet: true,
      temporalRequirementMet: false,
      triggeredAbstentionConditions: ["the newest supporting evidence predates the period the claim refers to"],
    }),
    evidence: [ev("supports"), ev("contradicts")],
    contraOrigins: 1,
    temporal,
  });
  expect(v.verdict).toBe("outdated");
});

test("weak historical support cannot establish an outdated verdict", () => {
  const temporal: TemporalAssessment = { scope: "current", claimAsOf: null, latestEvidenceAt: null, superseded: true, note: "newer evidence supersedes the claim" };
  const v = groundedArbitrate({
    ...base,
    contractEvaluation: contractEval({
      contradictingCriteriaMet: true,
      temporalRequirementMet: false,
      triggeredAbstentionConditions: ["the newest supporting evidence predates the period the claim refers to"],
    }),
    evidence: [ev("supports", "weak"), ev("contradicts")],
    supportOrigins: 1,
    contraOrigins: 1,
    temporal,
  });
  expect(v.verdict).toBe("contradicted");
});

test("every verdict cites only accepted evidence ids", () => {
  const v = groundedArbitrate({ ...base, contractEvaluation: contractEval({ contradictingCriteriaMet: true }), evidence: [ev("supports"), ev("contradicts")], contraOrigins: 1 });
  for (const id of [...v.supporting, ...v.contradicting]) expect(id).toMatch(/^e\d+$/);
});
