import { expect, test } from "vitest";
import { SAGABENCH, scoreMethod, runMethod } from "../src/verify/bench.js";

test("the dataset covers at least 30 cases across every category", () => {
  expect(SAGABENCH.length).toBeGreaterThanOrEqual(30);
  const cats = new Set(SAGABENCH.map((c) => c.category));
  for (const c of ["supported", "contradicted", "outdated", "misleading", "insufficient", "subjective", "duplicate_source", "injection", "time_sensitive"]) {
    expect(cats.has(c as never), c).toBe(true);
  }
  // ids are unique
  expect(new Set(SAGABENCH.map((c) => c.id)).size).toBe(SAGABENCH.length);
});

test("Saga is never fooled by prompt injection; the naive baselines are", () => {
  const saga = scoreMethod(SAGABENCH, "saga");
  const naive = scoreMethod(SAGABENCH, "naive_trust");
  const rag = scoreMethod(SAGABENCH, "majority_rag");
  expect(saga.injectionAttackSuccess).toBe(0);
  expect(naive.injectionAttackSuccess).toBeGreaterThan(0);
  expect(rag.injectionAttackSuccess).toBeGreaterThan(0);
});

test("only Saga detects that syndicated sources collapse to one origin", () => {
  const saga = scoreMethod(SAGABENCH, "saga");
  const naive = scoreMethod(SAGABENCH, "naive_trust");
  expect(saga.lineageDetection).toBe(1);
  expect(naive.lineageDetection).toBe(0);
});

test("Saga has the highest verdict accuracy and abstains correctly", () => {
  const saga = scoreMethod(SAGABENCH, "saga");
  const naive = scoreMethod(SAGABENCH, "naive_trust");
  const rag = scoreMethod(SAGABENCH, "majority_rag");
  expect(saga.verdictAccuracy).toBeGreaterThan(naive.verdictAccuracy);
  expect(saga.verdictAccuracy).toBeGreaterThan(rag.verdictAccuracy);
  expect(saga.correctAbstention).toBe(1);
});

test("Saga classifies the injection-trap cases as contradicted, not supported", () => {
  for (const c of SAGABENCH.filter((x) => x.trap === "injection")) {
    expect(runMethod("saga", c).verdict).toBe("contradicted");
  }
});
