import { expect, test } from "vitest";
import { ClaimSchema } from "../src/verify/types.js";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { assembleClaims, mapClaimsWithModel, type RawClaim } from "../src/verify/agent/mapper.js";

const DOC = "The bridge opened in 1998. It is the longest in the region. We think it is beautiful.";

test("assembleClaims locates offsets, assigns ids, and validates against the schema", () => {
  const raw: RawClaim[] = [
    { originalText: "The bridge opened in 1998.", normalized: "the bridge opened in 1998", claimType: "event", verifiable: true, timeSensitive: false, risk: "medium" },
    { originalText: "It is the longest in the region.", normalized: "the bridge is the longest in the region", claimType: "comparison", verifiable: true, timeSensitive: true, risk: "high" },
  ];
  const claims = assembleClaims(DOC, raw);
  expect(claims).toHaveLength(2);
  for (const c of claims) expect(() => ClaimSchema.parse(c)).not.toThrow();
  expect(DOC.slice(claims[0]!.location.start, claims[0]!.location.end)).toBe("The bridge opened in 1998.");
  expect(claims[0]!.id).not.toBe(claims[1]!.id);
});

test("claims are returned in document order", () => {
  const raw: RawClaim[] = [
    { originalText: "It is the longest in the region.", normalized: "longest", claimType: "comparison", verifiable: true, timeSensitive: false, risk: "low" },
    { originalText: "The bridge opened in 1998.", normalized: "opened 1998", claimType: "event", verifiable: true, timeSensitive: false, risk: "low" },
  ];
  const claims = assembleClaims(DOC, raw);
  expect(claims.map((c) => c.location.start)).toEqual([...claims.map((c) => c.location.start)].sort((a, b) => a - b));
  expect(claims[0]!.originalText).toBe("The bridge opened in 1998.");
});

test("a claim whose text is not found verbatim is dropped", () => {
  const raw: RawClaim[] = [
    { originalText: "The bridge cost ten billion dollars.", normalized: "cost", claimType: "numeric", verifiable: true, timeSensitive: false, risk: "medium" },
  ];
  expect(assembleClaims(DOC, raw)).toHaveLength(0);
});

test("an invalid claim type falls back to general and still validates", () => {
  const raw = [
    { originalText: "The bridge opened in 1998.", normalized: "x", claimType: "nonsense", verifiable: true, timeSensitive: false, risk: "weird" },
  ] as unknown as RawClaim[];
  const claims = assembleClaims(DOC, raw);
  expect(claims).toHaveLength(1);
  expect(claims[0]!.claimType).toBe("general");
  expect(claims[0]!.risk).toBe("medium");
  expect(() => ClaimSchema.parse(claims[0])).not.toThrow();
});

test("duplicate extractions collapse to one claim", () => {
  const raw: RawClaim[] = [
    { originalText: "The bridge opened in 1998.", normalized: "the bridge opened in 1998", claimType: "event", verifiable: true, timeSensitive: false, risk: "low" },
    { originalText: "The bridge opened in 1998.", normalized: "the bridge opened in 1998", claimType: "event", verifiable: true, timeSensitive: false, risk: "low" },
  ];
  expect(assembleClaims(DOC, raw)).toHaveLength(1);
});

test("different model normalizations cannot create overlapping claim spans", () => {
  const raw: RawClaim[] = [
    { originalText: "The bridge opened in 1998.", normalized: "bridge opened 1998", claimType: "event", verifiable: true, timeSensitive: false, risk: "low" },
    { originalText: "The bridge opened in 1998.", normalized: "opening date of bridge", claimType: "event", verifiable: true, timeSensitive: false, risk: "low" },
  ];

  const claims = assembleClaims(DOC, raw);
  expect(claims).toHaveLength(1);
  expect(claims[0]!.normalized).toBe("bridge opened 1998");
});

test("mapClaimsWithModel validates structured output then assembles exact document spans", async () => {
  const model = new MockModelProvider({
    claim_mapper: [{ claims: [
      { originalText: "The bridge opened in 1998.", normalized: "the bridge opened in 1998", claimType: "event", verifiable: true, timeSensitive: false, risk: "medium", asOf: null },
      { originalText: "A sentence the document never contained.", normalized: "invented", claimType: "general", verifiable: true, timeSensitive: false, risk: "low", asOf: null },
    ] }],
  });
  const claims = await mapClaimsWithModel(DOC, model);
  expect(claims).toHaveLength(1);
  expect(claims[0]!.originalText).toBe("The bridge opened in 1998.");
  expect(DOC.slice(claims[0]!.location.start, claims[0]!.location.end)).toBe(claims[0]!.originalText);
});

test("mapClaimsWithModel rejects invalid model fields at the schema boundary", async () => {
  const model = new MockModelProvider({
    claim_mapper: [{ claims: [{ originalText: "The bridge opened in 1998.", normalized: "opened", claimType: "made_up", verifiable: true, timeSensitive: false, risk: "low" }] }],
  });
  await expect(mapClaimsWithModel(DOC, model)).rejects.toThrow();
});
