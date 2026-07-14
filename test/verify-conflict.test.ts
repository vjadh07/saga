import { expect, test } from "vitest";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { resolveContradiction, isGenuineDispute } from "../src/verify/research/conflict.js";
import type { Claim, Evidence } from "../src/verify/types.js";

const claim: Claim = {
  id: "c1", originalText: "The drug reduces symptoms by 30%.", normalized: "x", claimType: "numeric",
  location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
};
function ev(id: string, stance: Evidence["stance"]): Evidence {
  const relation = stance === "supports" ? "direct_support" : "direct_contradiction";
  return { id, claimId: "c1", sourceId: `s_${id}`, stance, excerpt: "x", relevance: "strong", capturedBy: stance === "supports" ? "investigator" : "skeptic", citationAssessment: { relation, explanation: "validated", exactMatchVerified: true, sameEntity: true, sameMetric: true, samePeriod: true, samePopulation: true, claimStrongerThanSource: false, qualifiersOmitted: false } };
}

test("returns no conflict when only one side has evidence", async () => {
  const model = new MockModelProvider({});
  const a = await resolveContradiction({ claim, supporting: [ev("a", "supports")], contradicting: [], model });
  expect(a.hasConflict).toBe(false);
  expect(a.cause).toBe("none");
});

test("a genuine dispute is not reconciled", async () => {
  const model = new MockModelProvider({ conflict_analysis: [{ cause: "genuine_dispute", reconciled: false, explanation: "two rigorous trials disagree" }] });
  const a = await resolveContradiction({ claim, supporting: [ev("a", "supports")], contradicting: [ev("b", "contradicts")], model });
  expect(a.hasConflict).toBe(true);
  expect(a.reconciled).toBe(false);
  expect(isGenuineDispute(a)).toBe(true);
});

test("a correction is reconciled, not a dispute", async () => {
  const model = new MockModelProvider({ conflict_analysis: [{ cause: "correction", reconciled: true, explanation: "the earlier figure was corrected" }] });
  const a = await resolveContradiction({ claim, supporting: [ev("a", "supports")], contradicting: [ev("b", "contradicts")], model });
  expect(a.reconciled).toBe(true);
  expect(isGenuineDispute(a)).toBe(false);
});

test("a correction or superseding result is a conflict but not a standing dispute", async () => {
  const model = new MockModelProvider({ conflict_analysis: [{ cause: "correction", reconciled: true, explanation: "the earlier figure was corrected" }] });
  const a = await resolveContradiction({ claim, supporting: [ev("a", "supports")], contradicting: [ev("b", "contradicts")], model });
  expect(isGenuineDispute(a)).toBe(false);
});

test("unvalidated evidence cannot trigger conflict analysis", async () => {
  const support = ev("a", "supports");
  const contra = ev("b", "contradicts");
  delete support.citationAssessment;
  delete contra.citationAssessment;
  const a = await resolveContradiction({ claim, supporting: [support], contradicting: [contra], model: new MockModelProvider({}) });
  expect(a.hasConflict).toBe(false);
});

test("evidence from another claim cannot trigger conflict analysis", async () => {
  const support = ev("a", "supports");
  support.claimId = "other";
  const a = await resolveContradiction({ claim, supporting: [support], contradicting: [ev("b", "contradicts")], model: new MockModelProvider({}) });
  expect(a.hasConflict).toBe(false);
});

test("reconciled is derived from the validated cause, not trusted from the model", async () => {
  const genuine = await resolveContradiction({
    claim, supporting: [ev("a", "supports")], contradicting: [ev("b", "contradicts")],
    model: new MockModelProvider({ conflict_analysis: [{ cause: "genuine_dispute", reconciled: true, explanation: "same question" }] }),
  });
  expect(genuine.reconciled).toBe(false);
  const scoped = await resolveContradiction({
    claim, supporting: [ev("c", "supports")], contradicting: [ev("d", "contradicts")],
    model: new MockModelProvider({ conflict_analysis: [{ cause: "correction", reconciled: false, explanation: "the earlier figure was corrected" }] }),
  });
  expect(scoped.reconciled).toBe(true);
});

test("a conflict cause cannot contradict the stored citation facets", async () => {
  const supporting = ev("facet_support", "supports");
  const contradicting = ev("facet_contra", "contradicts");
  for (const evidence of [supporting, contradicting]) {
    Object.assign(evidence.citationAssessment!, {
      sameEntity: true,
      sameMetric: true,
      samePeriod: true,
      samePopulation: true,
      claimStrongerThanSource: false,
      qualifiersOmitted: false,
    });
  }
  const a = await resolveContradiction({
    claim,
    supporting: [supporting],
    contradicting: [contradicting],
    model: new MockModelProvider({ conflict_analysis: [{ cause: "different_period", reconciled: true, explanation: "different dates" }] }),
  });
  expect(a.cause).toBe("genuine_dispute");
  expect(a.reconciled).toBe(false);
});
