// Operational Evidence Contract enforcement. The contract stops being a display artifact
// and becomes a gate: before arbitration this deterministically checks whether the accepted
// evidence actually satisfies the contract, and lists any abstention condition that became
// true. The Arbiter receives this object and must respect it.
import type { Claim, ContractEvaluation, Evidence, EvidenceContract, Source } from "../types.js";
import type { ResearchPlan } from "./plan.js";

export interface EvaluateContractInput {
  claim: Claim;
  contract: EvidenceContract;
  plan: ResearchPlan;
  supporting: Evidence[];
  contradicting: Evidence[];
  sourceById: Map<string, Source>;
  independentOrigins: number; // independent origins behind the supporting evidence
  evidenceCurrent?: boolean; // false when the newest evidence predates a time-sensitive claim's period
}

export function evaluateContract(input: EvaluateContractInput): ContractEvaluation {
  const { claim, contract, plan, supporting, contradicting, sourceById, independentOrigins } = input;
  const evidenceCurrent = input.evidenceCurrent ?? true;

  const supportingCriteriaMet = supporting.length > 0;
  const contradictingCriteriaMet = contradicting.length > 0;

  const primaryFound = supporting.some((e) => sourceById.get(e.sourceId)?.sourceType === "primary");
  const primaryRequirementMet = !contract.primaryRequired || primaryFound;

  const independentOriginRequirementMet = independentOrigins >= plan.minimumIndependentOrigins;

  const triggered: string[] = [];
  if (!supportingCriteriaMet && !contradictingCriteriaMet) {
    triggered.push("no supporting or contradicting evidence was accepted");
  } else if (!supportingCriteriaMet) {
    triggered.push("no supporting evidence met the contract");
  }
  if (contract.primaryRequired && !primaryFound && supportingCriteriaMet) {
    triggered.push("a primary source is required but none was accepted");
  }
  if (supportingCriteriaMet && !independentOriginRequirementMet) {
    triggered.push(`fewer than ${plan.minimumIndependentOrigins} independent supporting origins`);
  }
  if (claim.timeSensitive && supportingCriteriaMet && !evidenceCurrent) {
    triggered.push("the newest supporting evidence predates the period the claim refers to");
  }

  const explanation =
    triggered.length === 0
      ? "The accepted evidence satisfies the contract."
      : `Contract not fully satisfied: ${triggered.join("; ")}.`;

  return {
    claimId: claim.id,
    supportingCriteriaMet,
    contradictingCriteriaMet,
    primaryRequirementMet,
    independentOriginRequirementMet,
    triggeredAbstentionConditions: triggered,
    explanation,
  };
}
