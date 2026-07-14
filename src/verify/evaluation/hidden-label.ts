// A small hidden-label check for the live workflow. The case builders do not import or
// receive this gold map. Expected verdicts are consulted only after Saga returns a result.
import { runLiveAudit, type LiveAuditInput, type LiveAuditResult } from "../live/audit.js";
import type { VerdictKind } from "../types.js";
import { UNLABELED_LIVE_CASES, type HiddenCaseId } from "./unlabeled-cases.js";

const GOLD_VERDICTS: Readonly<Record<HiddenCaseId, VerdictKind>> = Object.freeze({
  "case-01": "supported",
  "case-02": "contradicted",
  "case-03": "failed",
});

export type HiddenLabelRunner = (input: LiveAuditInput) => Promise<LiveAuditResult>;
export type EvaluatedVerdict = VerdictKind | "runner_error";

export interface HiddenLabelCaseResult {
  caseId: HiddenCaseId;
  expectedVerdict: VerdictKind;
  actualVerdict: EvaluatedVerdict;
  correct: boolean;
}

export interface HiddenLabelEvaluationResult {
  caseCount: number;
  correctCount: number;
  cases: HiddenLabelCaseResult[];
}

export async function runHiddenLabelEvaluation(
  runner: HiddenLabelRunner = runLiveAudit,
): Promise<HiddenLabelEvaluationResult> {
  const cases: HiddenLabelCaseResult[] = [];
  for (const definition of UNLABELED_LIVE_CASES) {
    let actualVerdict: EvaluatedVerdict = "runner_error";
    try {
      const result = await runner(definition.createInput());
      if (result.claimAudits.length === 1) actualVerdict = result.claimAudits[0]!.verdict.verdict;
    } catch {
      actualVerdict = "runner_error";
    }
    const expectedVerdict = GOLD_VERDICTS[definition.caseId];
    cases.push({
      caseId: definition.caseId,
      expectedVerdict,
      actualVerdict,
      correct: actualVerdict === expectedVerdict,
    });
  }
  return {
    caseCount: cases.length,
    correctCount: cases.filter((item) => item.correct).length,
    cases,
  };
}
