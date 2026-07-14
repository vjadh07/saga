import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { runLiveAudit } from "../src/verify/live/audit.js";
import {
  runHiddenLabelEvaluation,
  type HiddenLabelRunner,
} from "../src/verify/evaluation/hidden-label.js";

test("the hidden-label evaluation reports exact case and correct counts", async () => {
  const result = await runHiddenLabelEvaluation();
  expect(result.caseCount).toBe(3);
  expect(result.correctCount).toBe(3);
  expect(result.cases).toEqual([
    { caseId: "case-01", expectedVerdict: "supported", actualVerdict: "supported", correct: true },
    { caseId: "case-02", expectedVerdict: "contradicted", actualVerdict: "contradicted", correct: true },
    { caseId: "case-03", expectedVerdict: "failed", actualVerdict: "failed", correct: true },
  ]);
});

test("gold verdicts and answer-shaped model labels are absent from every Saga runner input", async () => {
  const captured: Parameters<HiddenLabelRunner>[0][] = [];
  const runner: HiddenLabelRunner = async (input) => {
    captured.push(input);
    return runLiveAudit(input);
  };
  const result = await runHiddenLabelEvaluation(runner);

  expect(captured).toHaveLength(result.caseCount);
  for (const input of captured) {
    expect(Object.keys(input).sort()).toEqual([
      "auditId", "claims", "document", "fetcher", "mode", "model", "now", "search",
    ]);
    const keys: string[] = [];
    const strings: string[] = [];
    const seen = new WeakSet<object>();
    const visit = (value: unknown): void => {
      if (typeof value === "string") {
        strings.push(value);
        return;
      }
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        keys.push(key);
        visit(child);
      }
    };
    visit(input);

    const answerKeys = new Set([
      "scripts",
      "gold",
      "label",
      "expectedVerdict",
      "verdict",
      "relevant",
      "supports",
      "stance",
      "relevance",
      "sourceType",
      "directness",
      "independence",
      "methodologyVisible",
      "promotional",
      "sameEntity",
      "sameMetric",
      "samePeriod",
      "samePopulation",
      "claimStrongerThanSource",
      "qualifiersOmitted",
      "relation",
      "citationEvidenceIds",
      "claimedResult",
      "replacement",
    ]);
    expect(keys.filter((key) => answerKeys.has(key))).toEqual([]);
    expect(Object.keys(input.model)).toEqual(["id"]);
    const evaluated = result.cases.find((item) => item.caseId === input.auditId.replace("eval-", "case-"));
    expect(evaluated).toBeDefined();
    expect(strings).not.toContain(evaluated!.expectedVerdict);

    const serializedInput = JSON.stringify(input);
    expect(serializedInput).not.toMatch(/"(?:stance|relevance|relatesTo|gold|expectedVerdict)"/);
    expect(serializedInput).not.toContain("DEMO_");
  }
});

test("case definitions contain provider data, not scripted model answers", () => {
  const source = readFileSync(new URL("../src/verify/evaluation/unlabeled-cases.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/MockModelProvider/);
  expect(source).not.toMatch(/\b(?:investigator_assess|skeptic_assess|source_quality|citation_assessment|numeric_extract|revision)\b/);
});
