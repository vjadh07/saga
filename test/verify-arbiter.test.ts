import { expect, test } from "vitest";
import type { Evidence, Relevance, Stance, TemporalAssessment } from "../src/verify/types.js";
import { arbitrate } from "../src/verify/arbiter.js";

let n = 0;
function ev(stance: Stance, relevance: Relevance = "strong"): Evidence {
  n++;
  return {
    id: `e${n}`,
    claimId: "c1",
    sourceId: `s${n}`,
    stance,
    excerpt: `passage ${n}`,
    relevance,
    capturedBy: stance === "contradicts" || stance === "qualifies" ? "skeptic" : "investigator",
  };
}
const notSuperseded: TemporalAssessment = {
  scope: "undated",
  claimAsOf: null,
  latestEvidenceAt: null,
  superseded: false,
  note: "No newer evidence supersedes this claim.",
};
const claim = { id: "c1", verifiable: true, timeSensitive: false };

const origins = (support: number, contra: number) => ({ supportOrigins: support, contraOrigins: contra });

test("an opinion is not objectively verifiable", () => {
  const v = arbitrate({ claim: { ...claim, verifiable: false }, evidence: [], ...origins(0, 0), temporal: notSuperseded });
  expect(v.verdict).toBe("not_verifiable");
  expect(v.requiredCorrection).toBeNull();
});

test("strong support from two independent origins is supported with high confidence", () => {
  const evidence = [ev("supports"), ev("supports")];
  const v = arbitrate({ claim, evidence, ...origins(2, 0), temporal: notSuperseded });
  expect(v.verdict).toBe("supported");
  expect(v.confidence).toBe("high");
  expect(v.requiredCorrection).toBeNull();
  expect(v.supporting).toHaveLength(2);
});

test("support from a single origin is capped at medium confidence", () => {
  const v = arbitrate({ claim, evidence: [ev("supports")], ...origins(1, 0), temporal: notSuperseded });
  expect(v.verdict).toBe("supported");
  expect(v.confidence).toBe("medium");
});

test("strong contradiction from two origins is contradicted with high confidence", () => {
  const v = arbitrate({ claim, evidence: [ev("contradicts"), ev("contradicts")], ...origins(0, 2), temporal: notSuperseded });
  expect(v.verdict).toBe("contradicted");
  expect(v.confidence).toBe("high");
  expect(v.requiredCorrection).not.toBeNull();
  expect(v.contradicting).toHaveLength(2);
});

test("strong support and strong contradiction is disputed", () => {
  const v = arbitrate({ claim, evidence: [ev("supports"), ev("contradicts")], ...origins(1, 1), temporal: notSuperseded });
  expect(v.verdict).toBe("disputed");
  expect(v.requiredCorrection).not.toBeNull();
});

test("support plus a qualification is supported with qualifications", () => {
  const v = arbitrate({ claim, evidence: [ev("supports"), ev("qualifies")], ...origins(2, 0), temporal: notSuperseded });
  expect(v.verdict).toBe("supported_with_qualifications");
  expect(v.requiredCorrection).not.toBeNull();
});

test("no relevant evidence abstains as insufficient with low confidence", () => {
  const v = arbitrate({ claim, evidence: [ev("irrelevant")], ...origins(0, 0), temporal: notSuperseded });
  expect(v.verdict).toBe("insufficient_evidence");
  expect(v.confidence).toBe("low");
  expect(v.requiredCorrection).not.toBeNull();
});

test("a superseded claim is outdated and carries the temporal note as its correction", () => {
  const temporal: TemporalAssessment = {
    scope: "current",
    claimAsOf: "2024-01-01T00:00:00.000Z",
    latestEvidenceAt: "2026-06-20T00:00:00.000Z",
    superseded: true,
    note: "Historically accurate as of January 2024, but outdated as of June 2026.",
  };
  const v = arbitrate({ claim: { ...claim, timeSensitive: true }, evidence: [ev("supports"), ev("contradicts")], ...origins(1, 2), temporal });
  expect(v.verdict).toBe("outdated");
  expect(v.requiredCorrection).toContain("outdated as of June 2026");
});
