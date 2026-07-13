import { expect, test } from "vitest";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { validateRevision, reviseChange } from "../src/verify/research/revision.js";
import type { Claim, Evidence, Verdict } from "../src/verify/types.js";

const claim: Claim = {
  id: "c1", originalText: "Northwind is the largest home battery maker in North America.", normalized: "x", claimType: "comparison",
  location: { start: 0, end: 1 }, verifiable: true, timeSensitive: true, risk: "high", status: "contracted", asOf: null,
};
function verdict(v: Verdict["verdict"], correction: string | null): Verdict {
  return { claimId: "c1", verdict: v, confidence: "medium", rationale: "", supporting: [], contradicting: ["e1"], independentOrigins: 1, temporal: null, requiredCorrection: correction };
}
const evidence: Evidence[] = [
  { id: "e1", claimId: "c1", sourceId: "s1", stance: "contradicts", excerpt: "a rival overtook Northwind in 2025", relevance: "strong", capturedBy: "skeptic" },
];

test("validateRevision passes clean grounded prose", () => {
  const v = validateRevision({ original: claim.originalText, replacement: "Northwind was a leading home battery maker, but a rival overtook it in 2025.", verdictKind: "outdated", citationIds: ["e1"], validEvidenceIds: new Set(["e1"]), evidenceText: "a rival overtook Northwind in 2025" });
  expect(v.ok).toBe(true);
  expect(v.citations).toEqual(["e1"]);
});

test("validateRevision rejects an unsupported number", () => {
  const v = validateRevision({ original: claim.originalText, replacement: "Northwind held 73% of the market.", verdictKind: "outdated", citationIds: [], validEvidenceIds: new Set(["e1"]), evidenceText: "a rival overtook Northwind in 2025" });
  expect(v.ok).toBe(false);
  expect(v.reason).toMatch(/number/i);
});

test("validateRevision drops citations to unknown evidence", () => {
  const v = validateRevision({ original: claim.originalText, replacement: "A rival overtook Northwind in 2025.", verdictKind: "outdated", citationIds: ["e1", "eZ"], validEvidenceIds: new Set(["e1"]), evidenceText: "a rival overtook Northwind in 2025" });
  expect(v.citations).toEqual(["e1"]);
});

test("validateRevision rejects prose that restates a contradicted claim", () => {
  const v = validateRevision({ original: claim.originalText, replacement: claim.originalText, verdictKind: "contradicted", citationIds: [], validEvidenceIds: new Set(["e1"]), evidenceText: "" });
  expect(v.ok).toBe(false);
});

test("reviseChange uses validated model prose when it passes", async () => {
  const model = new MockModelProvider({ revision: [{ replacement: "Northwind was a leading maker, but a rival overtook it in 2025.", citationEvidenceIds: ["e1"], reasoning: "update" }] });
  const change = await reviseChange({ claim, verdict: verdict("outdated", "Update the claim."), evidence, model });
  expect(change).not.toBeNull();
  expect(change!.source).toBe("revision_agent");
  expect(change!.replacement).toMatch(/rival overtook/);
  expect(change!.citations).toEqual(["e1"]);
});

test("reviseChange falls back to the deterministic marker when the model prose is invalid", async () => {
  const model = new MockModelProvider({ revision: [{ replacement: "Northwind held 99% of the market forever.", citationEvidenceIds: [], reasoning: "bad" }] });
  const change = await reviseChange({ claim, verdict: verdict("outdated", "Update the claim."), evidence, model });
  expect(change!.source).toBe("deterministic_marker");
  expect(change!.replacement).toMatch(/\[update/);
});

test("reviseChange returns null for a claim that needs no correction", async () => {
  const model = new MockModelProvider({});
  const change = await reviseChange({ claim, verdict: verdict("supported", null), evidence, model });
  expect(change).toBeNull();
});
