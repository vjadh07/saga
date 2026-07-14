import { expect, test } from "vitest";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { isCitationValidatedEvidence, validateEvidence } from "../src/verify/research/citation.js";
import type { Claim, Evidence, Source } from "../src/verify/types.js";

const claim: Claim = {
  id: "c1",
  originalText: "The batteries last 40 years.",
  normalized: "the batteries last 40 years",
  claimType: "numeric",
  location: { start: 0, end: 10 },
  verifiable: true,
  timeSensitive: false,
  risk: "high",
  status: "contracted",
  asOf: null,
};
function source(id: string, content: string): Source {
  return { id, url: `https://e/${id}`, canonicalUrl: null, title: id, publisher: id, publishedAt: "2026-05-01T00:00:00.000Z", sourceType: "unknown", content, quotes: [], outboundCitations: [] };
}
function ev(sourceId: string, excerpt: string, stance: Evidence["stance"] = "supports"): Evidence {
  return { id: `ev_${sourceId}`, claimId: "c1", sourceId, stance, excerpt, relevance: "strong", capturedBy: "investigator" };
}
const checks = (over: Partial<Record<string, unknown>> = {}) => ({
  sameEntity: true, sameMetric: true, samePeriod: true, samePopulation: true,
  claimStrongerThanSource: false, qualifiersOmitted: false, ...over,
});

test("direct support with all facets matching is validated as strong support", async () => {
  const s = source("s1", "Testing confirms the batteries last 40 years with no capacity loss.");
  const model = new MockModelProvider({ citation_assessment: [{ ...checks(), relation: "direct_support", explanation: "matches" }] });
  const r = await validateEvidence({ claim, candidates: [{ evidence: ev("s1", "the batteries last 40 years"), source: s }], model });
  expect(r.validated).toHaveLength(1);
  expect(r.validated[0]!.stance).toBe("supports");
  expect(r.validated[0]!.relevance).toBe("strong");
  expect(r.validated[0]!.citationAssessment!.relation).toBe("direct_support");
  expect(r.validated[0]!.citationAssessment!.exactMatchVerified).toBe(true);
  expect(r.validated[0]!.citationAssessment).toMatchObject({
    sameEntity: true,
    sameMetric: true,
    samePeriod: true,
    samePopulation: true,
  });
  expect(isCitationValidatedEvidence(r.validated[0]!)).toBe(true);
});

test("an entity or metric mismatch cannot be accepted as evidence", async () => {
  const s = source("s1", "Testing confirms a different product lasts 40 years.");
  const entityModel = new MockModelProvider({ citation_assessment: [{ ...checks({ sameEntity: false }), relation: "direct_support", explanation: "wrong product" }] });
  const entity = await validateEvidence({ claim, candidates: [{ evidence: ev("s1", "a different product lasts 40 years"), source: s }], model: entityModel });
  expect(entity.validated).toHaveLength(0);

  const metricModel = new MockModelProvider({ citation_assessment: [{ ...checks({ sameMetric: false }), relation: "direct_support", explanation: "wrong measure" }] });
  const metric = await validateEvidence({ claim, candidates: [{ evidence: ev("s1", "a different product lasts 40 years"), source: s }], model: metricModel });
  expect(metric.validated).toHaveLength(0);
});

test("period or population mismatch cannot remain direct support or contradiction", async () => {
  const s = source("s1", "Testing confirms the batteries last 40 years in one laboratory population.");
  const periodModel = new MockModelProvider({ citation_assessment: [{ ...checks({ samePeriod: false }), relation: "direct_support", explanation: "different period" }] });
  const period = await validateEvidence({ claim, candidates: [{ evidence: ev("s1", "the batteries last 40 years in one laboratory population"), source: s }], model: periodModel });
  expect(period.validated[0]!.stance).toBe("qualifies");
  expect(period.validated[0]!.citationAssessment!.relation).toBe("qualification");

  const populationModel = new MockModelProvider({ citation_assessment: [{ ...checks({ samePopulation: false }), relation: "direct_contradiction", explanation: "different population" }] });
  const population = await validateEvidence({ claim, candidates: [{ evidence: ev("s1", "the batteries last 40 years in one laboratory population", "contradicts"), source: s }], model: populationModel });
  expect(population.validated).toHaveLength(0);
});

test("bare evidence without citation validation is not citation-validated", () => {
  expect(isCitationValidatedEvidence(ev("s1", "the batteries last 40 years"))).toBe(false);
});

test("a candidate must be bound to the claim and source being validated", async () => {
  const s = source("s1", "the batteries last 40 years in testing");
  const wrongClaim = ev("s1", "the batteries last 40 years");
  wrongClaim.claimId = "other";
  const wrongSource = ev("other", "the batteries last 40 years");
  const r = await validateEvidence({ claim, candidates: [{ evidence: wrongClaim, source: s }, { evidence: wrongSource, source: s }], model: new MockModelProvider({}) });
  expect(r.validated).toHaveLength(0);
  expect(r.rejected).toHaveLength(2);
});

test("a claim stronger than the source is downgraded to partial support", async () => {
  const s = source("s1", "In ideal lab conditions the batteries last 40 years.");
  const model = new MockModelProvider({ citation_assessment: [{ ...checks({ claimStrongerThanSource: true }), relation: "direct_support", explanation: "source is narrower" }] });
  const r = await validateEvidence({ claim, candidates: [{ evidence: ev("s1", "the batteries last 40 years"), source: s }], model });
  expect(r.validated[0]!.citationAssessment!.relation).toBe("partial_support");
  expect(r.validated[0]!.relevance).toBe("weak");
});

test("omitted qualifiers turn support into a qualification", async () => {
  const s = source("s1", "the batteries last 40 years only with annual servicing.");
  const model = new MockModelProvider({ citation_assessment: [{ ...checks({ qualifiersOmitted: true }), relation: "direct_support", explanation: "caveat omitted" }] });
  const r = await validateEvidence({ claim, candidates: [{ evidence: ev("s1", "the batteries last 40 years"), source: s }], model });
  expect(r.validated[0]!.stance).toBe("qualifies");
});

test("context-only and irrelevant citations are rejected", async () => {
  const s = source("s1", "The batteries are made in a factory that opened last year.");
  const model = new MockModelProvider({ citation_assessment: [{ ...checks(), relation: "context_only", explanation: "background only" }] });
  const r = await validateEvidence({ claim, candidates: [{ evidence: ev("s1", "made in a factory that opened"), source: s }], model });
  expect(r.validated).toHaveLength(0);
  expect(r.rejected).toHaveLength(1);
});

test("an excerpt that is not verbatim in the source is rejected regardless of the model", async () => {
  const s = source("s1", "The batteries are durable.");
  const model = new MockModelProvider({ citation_assessment: [{ ...checks(), relation: "direct_support", explanation: "claims to match" }] });
  const r = await validateEvidence({ claim, candidates: [{ evidence: ev("s1", "the batteries last 40 years"), source: s }], model });
  expect(r.validated).toHaveLength(0);
  expect(r.rejected[0]!.reason).toMatch(/verbatim|not found|exact/i);
});

test("verbatim matching preserves numeric signs", async () => {
  const s = source("s1", "The measured change was -40 percent in 2025.");
  const r = await validateEvidence({
    claim,
    candidates: [{ evidence: ev("s1", "the measured change was 40 percent in 2025"), source: s }],
    model: new MockModelProvider({}),
  });
  expect(r.validated).toHaveLength(0);
  expect(r.rejected[0]!.reason).toMatch(/verbatim|exact/i);
});

test("direct contradiction is validated as a contradiction", async () => {
  const s = source("s1", "Independent testing found the batteries last about 15 years, not 40.");
  const model = new MockModelProvider({ citation_assessment: [{ ...checks(), relation: "direct_contradiction", explanation: "refutes" }] });
  const r = await validateEvidence({ claim, candidates: [{ evidence: ev("s1", "the batteries last about 15 years", "contradicts"), source: s }], model });
  expect(r.validated[0]!.stance).toBe("contradicts");
});
