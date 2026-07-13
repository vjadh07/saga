import { expect, test } from "vitest";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { computeNumeric, verifyNumericClaim } from "../src/verify/research/numeric.js";
import type { Claim } from "../src/verify/types.js";

test("percent change is recomputed and a wrong claimed value is flagged", () => {
  const c = computeNumeric({ kind: "percent_change", inputs: { from: 80, to: 100 }, claimedResult: 40, explanation: "" });
  expect(c.computedResult).toBe(25);
  expect(c.matches).toBe(false);
  expect(c.expression).toMatch(/80|from/);
});

test("a correct percent change matches within tolerance", () => {
  const c = computeNumeric({ kind: "percent_change", inputs: { from: 80, to: 100 }, claimedResult: 25, explanation: "" });
  expect(c.matches).toBe(true);
});

test("market share, ratio, average, and date interval compute deterministically", () => {
  expect(computeNumeric({ kind: "market_share", inputs: { part: 30, whole: 120 }, claimedResult: 25, explanation: "" }).computedResult).toBe(25);
  expect(computeNumeric({ kind: "ratio", inputs: { numerator: 3, denominator: 4 }, claimedResult: 0.75, explanation: "" }).matches).toBe(true);
  expect(computeNumeric({ kind: "average", inputs: { a: 2, b: 4, c: 6 }, claimedResult: 4, explanation: "" }).computedResult).toBe(4);
  expect(computeNumeric({ kind: "date_interval", inputs: { start: 2019, end: 2025 }, claimedResult: 6, explanation: "" }).matches).toBe(true);
});

test("division by zero and missing inputs yield null, not a crash", () => {
  expect(computeNumeric({ kind: "percent_change", inputs: { from: 0, to: 100 }, claimedResult: 5, explanation: "" }).computedResult).toBeNull();
  expect(computeNumeric({ kind: "ratio", inputs: { numerator: 3 }, claimedResult: 1, explanation: "" }).computedResult).toBeNull();
});

test("kind none has nothing to check", () => {
  const c = computeNumeric({ kind: "none", inputs: {}, claimedResult: null, explanation: "no numeric relation" });
  expect(c.computedResult).toBeNull();
  expect(c.matches).toBeNull();
});

test("verifyNumericClaim extracts values via the model and computes deterministically", async () => {
  const claim: Claim = {
    id: "c1", originalText: "Revenue rose from $80M to $100M, a 40% increase.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "percent_change", inputs: { from: 80, to: 100 }, claimedResult: 40, explanation: "revenue growth" }],
  });
  const check = await verifyNumericClaim({ claim, model });
  expect(check).not.toBeNull();
  expect(check!.claimId).toBe("c1");
  expect(check!.computedResult).toBe(25);
  expect(check!.claimedResult).toBe(40);
  expect(check!.matches).toBe(false);
});

test("verifyNumericClaim returns null when there is no numeric relation", async () => {
  const claim: Claim = {
    id: "c1", originalText: "The company is well managed.", normalized: "x", claimType: "general",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "low", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({ numeric_extract: [{ kind: "none", inputs: {}, claimedResult: null, explanation: "no numbers" }] });
  expect(await verifyNumericClaim({ claim, model })).toBeNull();
});
