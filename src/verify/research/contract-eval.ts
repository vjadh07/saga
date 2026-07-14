// Operational Evidence Contract enforcement. The contract stops being a display artifact
// and becomes a gate: before arbitration this deterministically checks whether the accepted
// evidence actually satisfies the contract, and lists any abstention condition that became
// true. The Arbiter receives this object and must respect it.
import type { Claim, ContractEvaluation, Evidence, EvidenceContract, Source } from "../types.js";
import type { ResearchPlan } from "./plan.js";
import { isCitationValidatedEvidence } from "./citation.js";

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
  const { claim, contract, plan, sourceById, independentOrigins } = input;
  const evidenceCurrent = input.evidenceCurrent ?? true;
  const contractMatches = contract.claimId === claim.id;
  const planMatches = plan.claimId === claim.id;
  const inputsMatch = contractMatches && planMatches;
  const belongsToClaim = (evidence: Evidence): boolean =>
    evidence.claimId === claim.id
    && sourceById.get(evidence.sourceId)?.id === evidence.sourceId
    && isCitationValidatedEvidence(evidence);
  const supporting = inputsMatch
    ? input.supporting.filter((evidence) => evidence.stance === "supports" && belongsToClaim(evidence))
    : [];
  const contradicting = inputsMatch
    ? input.contradicting.filter((evidence) => ["contradicts", "qualifies"].includes(evidence.stance) && belongsToClaim(evidence))
    : [];

  const supportingCriteriaMet = supporting.length > 0;
  const contradictingCriteriaMet = contradicting.length > 0;

  const primaryFound = supporting.some((e) => sourceById.get(e.sourceId)?.sourceType === "primary");
  const primaryRequired = contract.primaryRequired || plan.primaryRequired;
  const primaryRequirementMet = !primaryRequired || primaryFound;
  const contractPreferredFound = supporting.some((e) => contract.preferredSourceTypes.includes(sourceById.get(e.sourceId)!.sourceType));
  const planPreferredFound = supporting.some((e) => plan.preferredSourceTypes.includes(sourceById.get(e.sourceId)!.sourceType));
  const preferredSourceRequirementMet = supportingCriteriaMet && contractPreferredFound && planPreferredFound;

  const independentOriginRequirementMet = supportingCriteriaMet && independentOrigins >= plan.minimumIndependentOrigins;
  const temporalRequirementMet = !claim.timeSensitive || !supportingCriteriaMet || evidenceCurrent;

  const triggered: string[] = [];
  if (!contractMatches) triggered.push("the evidence contract belongs to a different claim");
  if (!planMatches) triggered.push("the research plan belongs to a different claim");
  if (!supportingCriteriaMet && !contradictingCriteriaMet) {
    triggered.push("no supporting or contradicting evidence was accepted");
  } else if (!supportingCriteriaMet) {
    triggered.push("no supporting evidence met the contract");
  }
  if (primaryRequired && !primaryFound && supportingCriteriaMet) {
    triggered.push("a primary source is required but none was accepted");
  }
  if (supportingCriteriaMet && !preferredSourceRequirementMet) {
    triggered.push("no supporting evidence came from the preferred source set");
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
    preferredSourceRequirementMet,
    independentOriginRequirementMet,
    temporalRequirementMet,
    triggeredAbstentionConditions: triggered,
    explanation,
  };
}
