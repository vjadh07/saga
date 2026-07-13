import { expect, test } from "vitest";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { detectDependencies, propagateReevaluation } from "../src/verify/research/dependencies.js";
import type { Claim, ClaimDependency } from "../src/verify/types.js";

function claim(id: string, text: string): Claim {
  return { id, originalText: text, normalized: text.toLowerCase(), claimType: "general", location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "medium", status: "contracted", asOf: null };
}

test("detectDependencies validates edges and drops ones referencing unknown claims", async () => {
  const claims = [claim("a", "Revenue was $100M."), claim("b", "Profit margin was 20%, so profit was $20M.")];
  const model = new MockModelProvider({
    claim_dependencies: [{ dependencies: [
      { from: "b", to: "a", kind: "calculated_from" },
      { from: "b", to: "zzz", kind: "depends_on" }, // unknown claim, must be dropped
    ] }],
  });
  const deps = await detectDependencies({ claims, model });
  expect(deps).toHaveLength(1);
  expect(deps[0]!.from).toBe("b");
  expect(deps[0]!.kind).toBe("calculated_from");
});

test("a failed foundational claim marks its dependents for re-evaluation, transitively", () => {
  const deps: ClaimDependency[] = [
    { from: "b", to: "a", kind: "calculated_from" },
    { from: "c", to: "b", kind: "depends_on" },
    { from: "d", to: "a", kind: "qualifies" }, // not foundational, must not propagate
  ];
  const affected = propagateReevaluation(deps, new Set(["a"]));
  const ids = affected.map((x) => x.claimId).sort();
  expect(ids).toEqual(["b", "c"]);
  expect(affected.find((x) => x.claimId === "b")!.reason).toMatch(/a/);
});

test("a non-foundational relationship does not propagate failure", () => {
  const deps: ClaimDependency[] = [{ from: "b", to: "a", kind: "contradicts" }];
  expect(propagateReevaluation(deps, new Set(["a"]))).toHaveLength(0);
});

test("dependents are marked for re-evaluation, never auto-failed", () => {
  const deps: ClaimDependency[] = [{ from: "b", to: "a", kind: "derived_from" }];
  const affected = propagateReevaluation(deps, new Set(["a"]));
  expect(affected[0]!.reason).toMatch(/re-evaluat|weakened|review/i);
});
