import { expect, test } from "vitest";
import { assertNoFixtureLabels, DEMO_BADGE, isDemo, isLive } from "../src/verify/mode.js";
import { runAudit } from "../src/verify/pipeline.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW } from "../src/verify/fixtures/demo.js";

test("mode predicates and the demo badge", () => {
  expect(isDemo("demo")).toBe(true);
  expect(isDemo("live")).toBe(false);
  expect(isLive("live")).toBe(true);
  expect(DEMO_BADGE).toMatch(/demo/i);
});

test("assertNoFixtureLabels rejects fixture-labeled evidence in live mode", () => {
  expect(() => assertNoFixtureLabels([{ url: "https://example.com", content: "x" }])).not.toThrow();
  expect(() => assertNoFixtureLabels([{ stance: "supports" }])).toThrow(/fixture-labeled/i);
  expect(() => assertNoFixtureLabels([{ relatesTo: ["c1"] }])).toThrow(/fixture-labeled/i);
  expect(() => assertNoFixtureLabels([{ relevance: "strong" }])).toThrow(/fixture-labeled/i);
});

test("runAudit tags results demo by default and honors an explicit mode", () => {
  const demo = runAudit({ auditId: "a", document: DEMO_DOCUMENT, claims: DEMO_CLAIMS, corpus: DEMO_CORPUS, now: DEMO_NOW });
  expect(demo.mode).toBe("demo");
  const tagged = runAudit({ auditId: "a", document: DEMO_DOCUMENT, claims: DEMO_CLAIMS, corpus: DEMO_CORPUS, now: DEMO_NOW, mode: "live" });
  expect(tagged.mode).toBe("live");
});
