import { expect, test } from "vitest";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { resolveContradiction, isGenuineDispute } from "../src/verify/research/conflict.js";
import type { Claim, Evidence } from "../src/verify/types.js";

const claim: Claim = {
  id: "c1", originalText: "The drug reduces symptoms by 30%.", normalized: "x", claimType: "numeric",
  location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
};
function ev(id: string, stance: Evidence["stance"]): Evidence {
  return { id, claimId: "c1", sourceId: `s_${id}`, stance, excerpt: "x", relevance: "strong", capturedBy: stance === "supports" ? "investigator" : "skeptic" };
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

test("a conflict caused by different regions is reconciled, not a dispute", async () => {
  const model = new MockModelProvider({ conflict_analysis: [{ cause: "different_region", reconciled: true, explanation: "one is EU-only, the other global" }] });
  const a = await resolveContradiction({ claim, supporting: [ev("a", "supports")], contradicting: [ev("b", "contradicts")], model });
  expect(a.reconciled).toBe(true);
  expect(isGenuineDispute(a)).toBe(false);
});

test("a correction or superseding result is a conflict but not a standing dispute", async () => {
  const model = new MockModelProvider({ conflict_analysis: [{ cause: "correction", reconciled: true, explanation: "the earlier figure was corrected" }] });
  const a = await resolveContradiction({ claim, supporting: [ev("a", "supports")], contradicting: [ev("b", "contradicts")], model });
  expect(isGenuineDispute(a)).toBe(false);
});
