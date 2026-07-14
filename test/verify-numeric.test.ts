import { expect, test } from "vitest";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { computeNumeric, verifyNumericClaim } from "../src/verify/research/numeric.js";
import type { Claim, Evidence } from "../src/verify/types.js";

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

test("ratio tolerance does not treat materially different small values as equal", () => {
  const c = computeNumeric({ kind: "ratio", inputs: { numerator: 1, denominator: 10 }, claimedResult: 0.4, explanation: "" });
  expect(c.computedResult).toBe(0.1);
  expect(c.matches).toBe(false);
});

test("small exact ratios are compared before display rounding", () => {
  const c = computeNumeric({ kind: "ratio", inputs: { numerator: 49, denominator: 100_000_000 }, claimedResult: 0.00000049, explanation: "" });
  expect(c.computedResult).toBe(0.00000049);
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

test("totals are independent of model object key order", () => {
  const first = computeNumeric({ kind: "total", inputs: { a: 1e16, b: -1e16, c: 1 }, claimedResult: 1, explanation: "" });
  const reordered = computeNumeric({ kind: "total", inputs: { c: 1, b: -1e16, a: 1e16 }, claimedResult: 1, explanation: "" });
  expect(first.computedResult).toBe(reordered.computedResult);
  expect(first.matches).toBe(reordered.matches);
});

test("non-finite arithmetic abstains instead of reporting a mismatch", () => {
  const c = computeNumeric({ kind: "unit_conversion", inputs: { value: 1e308, factor: 1e308 }, claimedResult: 1, explanation: "" });
  expect(c.computedResult).toBeNull();
  expect(c.matches).toBeNull();
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
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check).not.toBeNull();
  expect(check!.claimId).toBe("c1");
  expect(check!.computedResult).toBe(25);
  expect(check!.claimedResult).toBe(40);
  expect(check!.matches).toBe(false);
  expect(check!.grounded).toBe(true);
  expect(check!.expression).toContain("100");
});

test("an extracted claimed result absent from the claim cannot drive a verdict", async () => {
  const claim: Claim = {
    id: "c1", originalText: "Revenue rose from $80M to $100M, a 25% increase.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "percent_change", inputs: { from: 80, to: 100 }, claimedResult: 40, explanation: "revenue growth" }],
  });
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check).not.toBeNull();
  expect(check!.grounded).toBe(false);
  expect(check!.groundingIssues).toContain("claimed result 40 was not found in the claim");
  expect(check!.matches).toBeNull();
});

test("swapped percent-change roles are not grounded by token presence alone", async () => {
  const claim: Claim = {
    id: "c1", originalText: "Revenue fell from 100 to 80, a 20% decrease.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "percent_change", inputs: { from: 80, to: 100 }, claimedResult: 20, explanation: "revenue decline" }],
  });
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check!.grounded).toBe(false);
  expect(check!.groundingIssues).toContain("the from and to roles were not verified in the claim or validated evidence");
  expect(check!.matches).toBeNull();
});

test("a contextual number before the nearest from value cannot take its role", async () => {
  const claim: Claim = {
    id: "c1", originalText: "From 2024, revenue rose from 80 to 100, a 25% increase.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "percent_change", inputs: { from: 2024, to: 100 }, claimedResult: 25, explanation: "bad role assignment" }],
  });
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check!.grounded).toBe(false);
  expect(check!.matches).toBeNull();
});

test("from and to roles cannot be joined across sentence boundaries", async () => {
  const claim: Claim = {
    id: "c1", originalText: "Revenue started from 80. It later moved to 100, with a claimed 25% increase.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "percent_change", inputs: { from: 80, to: 100 }, claimedResult: 25, explanation: "crossed sentences" }],
  });
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check!.grounded).toBe(false);
  expect(check!.matches).toBeNull();
});

test("the claimed result must occupy the asserted result role", async () => {
  const claim: Claim = {
    id: "c1", originalText: "Revenue rose from 80 to 100, a 25% increase.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "percent_change", inputs: { from: 80, to: 100 }, claimedResult: 80, explanation: "used an operand as the result" }],
  });
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check!.grounded).toBe(false);
  expect(check!.groundingIssues).toContain("claimed result 80 was not verified as the asserted percent result");
  expect(check!.matches).toBeNull();
});

test("a model-selected relationship kind must be supported by the text", async () => {
  const claim: Claim = {
    id: "c1", originalText: "Revenue rose from 80 to 100, a 25% increase.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "total", inputs: { a: 80, b: 100 }, claimedResult: 25, explanation: "wrong relationship" }],
  });
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check!.grounded).toBe(false);
  expect(check!.groundingIssues).toContain("the total relationship was not verified in the claim or validated evidence");
  expect(check!.matches).toBeNull();
});

test("average verification requires the complete explicit operand list", async () => {
  const claim: Claim = {
    id: "c1", originalText: "The average of 2, 4, and 6 is 4.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const incomplete = new MockModelProvider({
    numeric_extract: [{ kind: "average", inputs: { a: 2, b: 4 }, claimedResult: 4, explanation: "omitted an operand" }],
  });
  const bad = await verifyNumericClaim({ claim, evidence: [], model: incomplete });
  expect(bad!.grounded).toBe(false);
  expect(bad!.matches).toBeNull();

  const complete = new MockModelProvider({
    numeric_extract: [{ kind: "average", inputs: { a: 2, b: 4, c: 6 }, claimedResult: 4, explanation: "all operands" }],
  });
  const good = await verifyNumericClaim({ claim, evidence: [], model: complete });
  expect(good!.grounded).toBe(true);
  expect(good!.matches).toBe(true);
});

test("unit conversion verification requires explicit operand and result roles", async () => {
  const claim: Claim = {
    id: "c1", originalText: "Using the stated factor, 10 * 1.60934 = 16.0934.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const valid = new MockModelProvider({
    numeric_extract: [{ kind: "unit_conversion", inputs: { value: 10, factor: 1.60934 }, claimedResult: 16.0934, explanation: "conversion" }],
  });
  const good = await verifyNumericClaim({ claim, evidence: [], model: valid });
  expect(good!.groundingIssues).toEqual([]);
  expect(good!.grounded).toBe(true);
  expect(good!.matches).toBe(true);

  const swapped = new MockModelProvider({
    numeric_extract: [{ kind: "unit_conversion", inputs: { value: 10, factor: 16.0934 }, claimedResult: 1.60934, explanation: "swapped result and factor" }],
  });
  const bad = await verifyNumericClaim({ claim, evidence: [], model: swapped });
  expect(bad!.grounded).toBe(false);
  expect(bad!.matches).toBeNull();
});

test("unit conversion ignores unrelated numbers before the actual multiplicands", async () => {
  const claim: Claim = {
    id: "c1", originalText: "In 2024, 10 * 1.60934 = 16.0934.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "unit_conversion", inputs: { value: 2024, factor: 1.60934 }, claimedResult: 16.0934, explanation: "used a contextual year" }],
  });
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check!.grounded).toBe(false);
  expect(check!.matches).toBeNull();
});

test("unit conversion cannot omit a multiplicand from a compound equation", async () => {
  const claim: Claim = {
    id: "c1", originalText: "Converting hours to seconds: 2 * 60 * 60 = 7200.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "unit_conversion", inputs: { value: 60, factor: 60 }, claimedResult: 7200, explanation: "omitted the first multiplicand" }],
  });
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check!.grounded).toBe(false);
  expect(check!.matches).toBeNull();
});

test("date intervals require date-like start and end operands", async () => {
  const claim: Claim = {
    id: "c1", originalText: "Revenue moved from 80 to 100 over 6 years.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "date_interval", inputs: { start: 80, end: 100 }, claimedResult: 6, explanation: "treated revenue values as dates" }],
  });
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check!.grounded).toBe(false);
  expect(check!.matches).toBeNull();
});

test("reverse date intervals match a positive stated duration", async () => {
  const claim: Claim = {
    id: "c1", originalText: "The record runs from 2025 back to 2019, a 6-year interval.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "date_interval", inputs: { start: 2025, end: 2019 }, claimedResult: 6, explanation: "duration" }],
  });
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check!.grounded).toBe(true);
  expect(check!.computedResult).toBe(-6);
  expect(check!.matches).toBe(true);
});

test("a correctly extracted percentage decrease matches its positive stated magnitude", async () => {
  const claim: Claim = {
    id: "c1", originalText: "Revenue fell from 100 to 80, a 20% decrease.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "percent_change", inputs: { from: 100, to: 80 }, claimedResult: 20, explanation: "revenue decline" }],
  });
  const check = await verifyNumericClaim({ claim, evidence: [], model });
  expect(check!.computedResult).toBe(-20);
  expect(check!.grounded).toBe(true);
  expect(check!.matches).toBe(true);
});

test("numeric inputs may be grounded in validated evidence", async () => {
  const claim: Claim = {
    id: "c1", originalText: "Revenue increased by 25%.", normalized: "x", claimType: "numeric",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
  };
  const evidence: Evidence[] = [{
    id: "e1", claimId: "c1", sourceId: "s1", stance: "supports", excerpt: "Revenue rose from 80 million dollars to 100 million dollars.", relevance: "strong", capturedBy: "investigator",
    citationAssessment: { relation: "direct_support", explanation: "same figures", exactMatchVerified: true, sameEntity: true, sameMetric: true, samePeriod: true, samePopulation: true, claimStrongerThanSource: false, qualifiersOmitted: false },
  }];
  const model = new MockModelProvider({
    numeric_extract: [{ kind: "percent_change", inputs: { from: 80, to: 100 }, claimedResult: 25, explanation: "revenue growth" }],
  });
  const check = await verifyNumericClaim({ claim, evidence, model });
  expect(check!.grounded).toBe(true);
  expect(check!.sourceEvidenceIds).toEqual(["e1"]);
  expect(check!.matches).toBe(true);
});

test("verifyNumericClaim returns null when there is no numeric relation", async () => {
  const claim: Claim = {
    id: "c1", originalText: "The company is well managed.", normalized: "x", claimType: "general",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "low", status: "contracted", asOf: null,
  };
  const model = new MockModelProvider({ numeric_extract: [{ kind: "none", inputs: {}, claimedResult: null, explanation: "no numbers" }] });
  expect(await verifyNumericClaim({ claim, evidence: [], model })).toBeNull();
});
