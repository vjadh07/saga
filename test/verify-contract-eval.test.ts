import { expect, test } from "vitest";
import { defaultContract } from "../src/verify/contract.js";
import { evaluateContract } from "../src/verify/research/contract-eval.js";
import type { Claim, Evidence, Source } from "../src/verify/types.js";
import type { ResearchPlan } from "../src/verify/research/plan.js";

const claim: Claim = {
  id: "c1",
  originalText: "Northwind shipped 50,000 units in 2025.",
  normalized: "northwind shipped 50000 units in 2025",
  claimType: "numeric",
  location: { start: 0, end: 10 },
  verifiable: true,
  timeSensitive: false,
  risk: "high",
  status: "contracted",
  asOf: null,
};
const plan: ResearchPlan = {
  claimId: "c1", supportingQueries: ["q"], skepticQueries: ["q"], preferredSourceTypes: ["primary"],
  primaryRequired: true, minimumIndependentOrigins: 2, maximumIterations: 1, maximumSources: 8,
  stopWhen: ["done"], abstainWhen: ["nothing"],
};
function src(id: string, type: Source["sourceType"]): Source {
  return { id, url: `https://e/${id}`, canonicalUrl: null, title: id, publisher: id, publishedAt: "2026-02-01T00:00:00.000Z", sourceType: type, content: "", quotes: [], outboundCitations: [] };
}
function ev(sourceId: string, stance: Evidence["stance"] = "supports"): Evidence {
  const relation = stance === "supports" ? "direct_support" : stance === "contradicts" ? "direct_contradiction" : "qualification";
  return {
    id: `ev_${sourceId}`, claimId: "c1", sourceId, stance, excerpt: "x", relevance: stance === "qualifies" ? "weak" : "strong", capturedBy: "investigator",
    citationAssessment: { relation, explanation: "validated", exactMatchVerified: true, sameEntity: true, sameMetric: true, samePeriod: true, samePopulation: true, claimStrongerThanSource: false, qualifiersOmitted: false },
  };
}

test("all requirements met yields a clean contract evaluation", () => {
  const byId = new Map([["s1", src("s1", "primary")], ["s2", src("s2", "gov")]]);
  const e = evaluateContract({
    claim, contract: defaultContract(claim), plan,
    supporting: [ev("s1"), ev("s2")], contradicting: [], sourceById: byId, independentOrigins: 2,
  });
  expect(e.supportingCriteriaMet).toBe(true);
  expect(e.primaryRequirementMet).toBe(true);
  expect(e.independentOriginRequirementMet).toBe(true);
  expect(e.triggeredAbstentionConditions).toHaveLength(0);
});

test("primary required but none accepted triggers abstention", () => {
  const byId = new Map([["s1", src("s1", "news")], ["s2", src("s2", "blog")]]);
  const e = evaluateContract({
    claim, contract: defaultContract(claim), plan,
    supporting: [ev("s1"), ev("s2")], contradicting: [], sourceById: byId, independentOrigins: 2,
  });
  expect(e.primaryRequirementMet).toBe(false);
  expect(e.triggeredAbstentionConditions.some((c) => /primary/i.test(c))).toBe(true);
});

test("too few independent origins triggers abstention", () => {
  const byId = new Map([["s1", src("s1", "primary")]]);
  const e = evaluateContract({
    claim, contract: defaultContract(claim), plan,
    supporting: [ev("s1")], contradicting: [], sourceById: byId, independentOrigins: 1,
  });
  expect(e.independentOriginRequirementMet).toBe(false);
  expect(e.triggeredAbstentionConditions.some((c) => /independent/i.test(c))).toBe(true);
});

test("no supporting evidence triggers abstention", () => {
  const e = evaluateContract({
    claim, contract: defaultContract(claim), plan,
    supporting: [], contradicting: [], sourceById: new Map(), independentOrigins: 0,
  });
  expect(e.supportingCriteriaMet).toBe(false);
  expect(e.triggeredAbstentionConditions.length).toBeGreaterThan(0);
});

test("time-sensitive claim with stale evidence triggers abstention", () => {
  const tsClaim = { ...claim, timeSensitive: true };
  const byId = new Map([["s1", src("s1", "primary")], ["s2", src("s2", "gov")]]);
  const e = evaluateContract({
    claim: tsClaim, contract: defaultContract(tsClaim), plan,
    supporting: [ev("s1"), ev("s2")], contradicting: [], sourceById: byId, independentOrigins: 2, evidenceCurrent: false,
  });
  expect(e.triggeredAbstentionConditions.some((c) => /current|predate|stale|period/i.test(c))).toBe(true);
  expect(e.temporalRequirementMet).toBe(false);
});

test("a high-stakes plan enforces its primary-source requirement", () => {
  const generalClaim: Claim = { ...claim, claimType: "general", risk: "low" };
  const contract = defaultContract(generalClaim);
  const highStakesPlan: ResearchPlan = {
    ...plan,
    preferredSourceTypes: contract.preferredSourceTypes,
    primaryRequired: true,
    minimumIndependentOrigins: 1,
  };
  const e = evaluateContract({
    claim: generalClaim,
    contract,
    plan: highStakesPlan,
    supporting: [ev("s1")],
    contradicting: [],
    sourceById: new Map([["s1", src("s1", "news")]]),
    independentOrigins: 1,
  });
  expect(e.primaryRequirementMet).toBe(false);
  expect(e.triggeredAbstentionConditions.some((condition) => /primary/i.test(condition))).toBe(true);
});

test("support outside the preferred source set does not satisfy the contract", () => {
  const generalClaim: Claim = { ...claim, claimType: "general", risk: "low" };
  const contract = defaultContract(generalClaim);
  const generalPlan: ResearchPlan = {
    ...plan,
    preferredSourceTypes: contract.preferredSourceTypes,
    primaryRequired: false,
    minimumIndependentOrigins: 1,
  };
  const e = evaluateContract({
    claim: generalClaim,
    contract,
    plan: generalPlan,
    supporting: [ev("s1")],
    contradicting: [],
    sourceById: new Map([["s1", src("s1", "blog")]]),
    independentOrigins: 1,
  });
  expect(e.preferredSourceRequirementMet).toBe(false);
  expect(e.triggeredAbstentionConditions.some((condition) => /preferred source/i.test(condition))).toBe(true);
});

test("contract evaluation rejects foreign contracts, plans, and evidence", () => {
  const byId = new Map([["s1", src("s1", "primary")]]);
  const contract = defaultContract(claim);

  const foreignContract = evaluateContract({
    claim,
    contract: { ...contract, claimId: "other" },
    plan,
    supporting: [ev("s1")],
    contradicting: [],
    sourceById: byId,
    independentOrigins: 2,
  });
  expect(foreignContract.supportingCriteriaMet).toBe(false);
  expect(foreignContract.triggeredAbstentionConditions.some((condition) => /contract.*different claim/i.test(condition))).toBe(true);

  const foreignPlan = evaluateContract({
    claim,
    contract,
    plan: { ...plan, claimId: "other" },
    supporting: [ev("s1")],
    contradicting: [],
    sourceById: byId,
    independentOrigins: 2,
  });
  expect(foreignPlan.supportingCriteriaMet).toBe(false);
  expect(foreignPlan.triggeredAbstentionConditions.some((condition) => /plan.*different claim/i.test(condition))).toBe(true);

  const foreignEvidence = ev("s1");
  foreignEvidence.claimId = "other";
  const evidenceResult = evaluateContract({
    claim,
    contract,
    plan,
    supporting: [foreignEvidence],
    contradicting: [],
    sourceById: byId,
    independentOrigins: 2,
  });
  expect(evidenceResult.supportingCriteriaMet).toBe(false);
});
