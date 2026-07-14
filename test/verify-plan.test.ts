import { expect, test } from "vitest";
import { defaultContract } from "../src/verify/contract.js";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { planResearch, ResearchPlanSchema } from "../src/verify/research/plan.js";
import type { Claim } from "../src/verify/types.js";

function claim(p: Partial<Claim> = {}): Claim {
  return {
    id: "c1",
    originalText: "Northwind shipped 50,000 units in 2025.",
    normalized: "northwind shipped 50000 units in 2025",
    claimType: "numeric",
    location: { start: 0, end: 10 },
    verifiable: true,
    timeSensitive: false,
    risk: "high",
    status: "contracted",
    asOf: null,
    ...p,
  };
}
const queries = { supportingQueries: ["northwind 2025 shipments filing"], skepticQueries: ["northwind overstated shipments"] };

test("planResearch uses model queries and deterministic budgets, validating the plan", async () => {
  const c = claim();
  const model = new MockModelProvider({ research_plan: [queries] });
  const plan = await planResearch({ claim: c, contract: defaultContract(c), mode: "deep", model });
  expect(() => ResearchPlanSchema.parse(plan)).not.toThrow();
  expect(plan.claimId).toBe("c1");
  expect(plan.supportingQueries).toEqual(queries.supportingQueries);
  expect(plan.skepticQueries).toEqual(queries.skepticQueries);
  expect(plan.maximumIterations).toBe(2);
  expect(plan.maximumSources).toBe(8);
  expect(plan.minimumIndependentOrigins).toBe(2);
  expect(plan.stopWhen.length).toBeGreaterThan(0);
  expect(plan.abstainWhen.length).toBeGreaterThan(0);
});

test("quick mode is a smaller budget than deep", async () => {
  const c = claim();
  const model = new MockModelProvider({ research_plan: [queries] });
  const plan = await planResearch({ claim: c, contract: defaultContract(c), mode: "quick", model });
  expect(plan.maximumIterations).toBe(1);
  expect(plan.minimumIndependentOrigins).toBe(1);
  expect(plan.maximumSources).toBeLessThan(8);
});

test("high-stakes forces a primary source and more independent origins", async () => {
  const c = claim({ claimType: "general", risk: "low" });
  const model = new MockModelProvider({ research_plan: [queries] });
  const plan = await planResearch({ claim: c, contract: defaultContract(c), mode: "high_stakes", model });
  expect(plan.primaryRequired).toBe(true);
  expect(plan.minimumIndependentOrigins).toBe(3);
});

test("a model response with no queries is rejected at the boundary", async () => {
  const c = claim();
  const model = new MockModelProvider({ research_plan: [{ supportingQueries: [], skepticQueries: [] }] });
  await expect(planResearch({ claim: c, contract: defaultContract(c), mode: "deep", model })).rejects.toThrow();
});

test("whitespace-only model queries are rejected at the boundary", async () => {
  const c = claim();
  const model = new MockModelProvider({ research_plan: [{ supportingQueries: ["   "], skepticQueries: ["valid skeptic query"] }] });
  await expect(planResearch({ claim: c, contract: defaultContract(c), mode: "deep", model })).rejects.toThrow();
});
