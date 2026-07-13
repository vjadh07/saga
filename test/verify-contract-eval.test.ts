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
  return { id: `ev_${sourceId}`, claimId: "c1", sourceId, stance, excerpt: "x", relevance: "strong", capturedBy: "investigator" };
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
});
