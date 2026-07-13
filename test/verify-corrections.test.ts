import { expect, test } from "vitest";
import type { Claim, Verdict, VerdictKind } from "../src/verify/types.js";
import { buildCorrectedDraft, type CorrectionItem } from "../src/verify/corrections.js";

function verdict(kind: VerdictKind, correction: string | null): Verdict {
  return {
    claimId: "c",
    verdict: kind,
    confidence: "medium",
    rationale: "",
    supporting: [],
    contradicting: [],
    independentOrigins: 1,
    temporal: null,
    requiredCorrection: correction,
  };
}
function item(original: string, start: number, kind: VerdictKind, correction: string | null): CorrectionItem {
  const claim: Pick<Claim, "id" | "originalText" | "location"> = {
    id: `c_${start}`,
    originalText: original,
    location: { start, end: start + original.length },
  };
  return { claim, verdict: verdict(kind, correction) };
}

test("a fully supported claim produces no change and leaves the draft identical", () => {
  const original = "The sky is blue.";
  const r = buildCorrectedDraft(original, [item("The sky is blue.", 0, "supported", null)]);
  expect(r.changes).toHaveLength(0);
  expect(r.draft).toBe(original);
  expect(r.original).toBe(original);
});

test("a contradicted claim is marked for removal in the draft, original untouched", () => {
  const original = "Solar is now the cheapest power. The moon is made of cheese. Grids expanded.";
  const start = original.indexOf("The moon is made of cheese.");
  const r = buildCorrectedDraft(original, [
    item("The moon is made of cheese.", start, "contradicted", "Remove or rewrite: contradicted by 2 source(s)."),
  ]);
  expect(r.changes).toHaveLength(1);
  expect(r.changes[0]!.kind).toBe("remove");
  expect(r.draft).not.toContain("The moon is made of cheese.");
  expect(r.draft).toMatch(/contradicted/i);
  // the original input is preserved verbatim
  expect(r.original).toBe(original);
  expect(r.draft).toContain("Solar is now the cheapest power.");
  expect(r.draft).toContain("Grids expanded.");
});

test("an outdated claim keeps its text and appends the temporal update", () => {
  const original = "Coal was the top source in 2019.";
  const r = buildCorrectedDraft(original, [
    item("Coal was the top source in 2019.", 0, "outdated", "Update the claim. Historically accurate as of January 2019, but outdated as of June 2026."),
  ]);
  expect(r.changes[0]!.kind).toBe("update");
  expect(r.draft).toContain("Coal was the top source in 2019.");
  expect(r.draft).toMatch(/outdated as of June 2026/);
});

test("multiple changes apply at the right offsets regardless of order", () => {
  const original = "AAA claim one here. BBB middle text. CCC claim two here.";
  const s1 = original.indexOf("AAA claim one here.");
  const s2 = original.indexOf("CCC claim two here.");
  const r = buildCorrectedDraft(original, [
    item("CCC claim two here.", s2, "contradicted", "contradicted by evidence"),
    item("AAA claim one here.", s1, "supported_with_qualifications", "add a qualification"),
  ]);
  expect(r.changes).toHaveLength(2);
  expect(r.draft).toContain("BBB middle text.");
  expect(r.draft).toMatch(/qualify/i);
  expect(r.draft).toMatch(/contradicted/i);
});
