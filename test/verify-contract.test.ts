import { expect, test } from "vitest";
import type { Claim } from "../src/verify/types.js";
import { EvidenceContractSchema } from "../src/verify/types.js";
import { defaultContract } from "../src/verify/contract.js";

function claim(p: Partial<Claim>): Claim {
  return {
    id: "c1",
    originalText: "x",
    normalized: "x",
    claimType: "general",
    location: { start: 0, end: 1 },
    verifiable: true,
    timeSensitive: false,
    risk: "medium",
    status: "contracted",
    asOf: null,
    ...p,
  };
}

test("a numeric claim requires a primary source and produces a valid contract", () => {
  const c = defaultContract(claim({ claimType: "numeric", risk: "high" }));
  expect(() => EvidenceContractSchema.parse(c)).not.toThrow();
  expect(c.primaryRequired).toBe(true);
  expect(c.preferredSourceTypes).toContain("primary");
  expect(c.supportingCriteria.length).toBeGreaterThan(0);
  expect(c.contradictingCriteria.length).toBeGreaterThan(0);
  expect(c.abstentionConditions.length).toBeGreaterThan(0);
});

test("every claim type yields a schema-valid contract", () => {
  for (const t of ["numeric", "event", "causal", "definitional", "quote", "prediction", "existence", "comparison", "general"] as const) {
    const c = defaultContract(claim({ claimType: t }));
    expect(() => EvidenceContractSchema.parse(c), t).not.toThrow();
    expect(c.claimId).toBe("c1");
  }
});

test("a low-risk general claim does not force a primary source", () => {
  const c = defaultContract(claim({ claimType: "general", risk: "low" }));
  expect(c.primaryRequired).toBe(false);
});
