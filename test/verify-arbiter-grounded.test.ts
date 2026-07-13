import { expect, test } from "vitest";
import { groundedArbitrate } from "../src/verify/research/arbiter-grounded.js";
import type { ConflictAnalysis, ContractEvaluation, Evidence, NumericCheck, TemporalAssessment } from "../src/verify/types.js";

const claim = { id: "c1", verifiable: true, timeSensitive: false };
const noTemporal: TemporalAssessment = { scope: "undated", claimAsOf: null, latestEvidenceAt: null, superseded: false, note: "" };
const noConflict: ConflictAnalysis = { claimId: "c1", hasConflict: false, cause: "none", reconciled: false, explanation: "" };
function contractEval(over: Partial<ContractEvaluation> = {}): ContractEvaluation {
  return { claimId: "c1", supportingCriteriaMet: true, contradictingCriteriaMet: false, primaryRequirementMet: true, independentOriginRequirementMet: true, triggeredAbstentionConditions: [], explanation: "", ...over };
}
let n = 0;
function ev(stance: Evidence["stance"]): Evidence {
  n++;
  return { id: `e${n}`, claimId: "c1", sourceId: `s${n}`, stance, excerpt: "x", relevance: "strong", capturedBy: stance === "supports" ? "investigator" : "skeptic" };
}
const base = { claim, contractEvaluation: contractEval(), temporal: noTemporal, numeric: null as NumericCheck | null, conflict: noConflict, supportOrigins: 2, contraOrigins: 0 };

test("a deterministic numeric mismatch contradicts with high confidence", () => {
  const numeric: NumericCheck = { claimId: "c1", kind: "percent_change", expression: "", inputs: {}, computedResult: 25, claimedResult: 40, matches: false, explanation: "" };
  const v = groundedArbitrate({ ...base, evidence: [ev("supports")], numeric });
  expect(v.verdict).toBe("contradicted");
  expect(v.confidence).toBe("high");
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

test("a genuine dispute is disputed; a reconciled conflict is qualified", () => {
  const disputed = groundedArbitrate({ ...base, evidence: [ev("supports"), ev("contradicts")], contraOrigins: 1, conflict: { claimId: "c1", hasConflict: true, cause: "genuine_dispute", reconciled: false, explanation: "" } });
  expect(disputed.verdict).toBe("disputed");
  const reconciled = groundedArbitrate({ ...base, evidence: [ev("supports"), ev("contradicts")], contraOrigins: 1, conflict: { claimId: "c1", hasConflict: true, cause: "different_region", reconciled: true, explanation: "" } });
  expect(reconciled.verdict).toBe("supported_with_qualifications");
});

test("a superseded current claim is outdated", () => {
  const temporal: TemporalAssessment = { scope: "current", claimAsOf: null, latestEvidenceAt: null, superseded: true, note: "no longer current" };
  const v = groundedArbitrate({ ...base, evidence: [ev("supports"), ev("contradicts")], contraOrigins: 1, temporal });
  expect(v.verdict).toBe("outdated");
});

test("every verdict cites only accepted evidence ids", () => {
  const v = groundedArbitrate({ ...base, evidence: [ev("supports"), ev("contradicts")], contraOrigins: 1 });
  for (const id of [...v.supporting, ...v.contradicting]) expect(id).toMatch(/^e\d+$/);
});
