// The grounded Arbiter for live audits. It receives only validated inputs and decides
// deterministically. It never browses, never invents evidence, and cites only accepted
// evidence ids. Lack of evidence is not evidence of falsehood; a failed search is not a
// contradiction; contract failure produces abstention or qualification, not a verdict of
// false. The deterministic demo keeps using the simpler arbiter in arbiter.ts.
import { isGenuineDispute, isReconciledConflict } from "./conflict.js";
import { isCitationValidatedEvidence } from "./citation.js";
import type {
  Confidence,
  ConflictAnalysis,
  ContractEvaluation,
  Evidence,
  NumericCheck,
  TemporalAssessment,
  Verdict,
  VerdictKind,
} from "../types.js";

export interface GroundedArbiterInput {
  claim: { id: string; verifiable: boolean; timeSensitive: boolean };
  contractEvaluation: ContractEvaluation;
  temporal: TemporalAssessment;
  numeric: NumericCheck | null;
  conflict: ConflictAnalysis;
  evidence: Evidence[]; // validated only
  supportOrigins: number;
  contraOrigins: number;
  researchFailed?: boolean;
}

function band(hasStrong: boolean, origins: number): Confidence {
  if (!hasStrong) return "low";
  if (origins >= 2) return "high";
  return "medium";
}

export function groundedArbitrate(input: GroundedArbiterInput): Verdict {
  const { claim, contractEvaluation, temporal, numeric, conflict, supportOrigins, contraOrigins } = input;
  const seenEvidence = new Set<string>();
  const accepted = input.evidence.filter((e) => {
    if (e.claimId !== claim.id || seenEvidence.has(e.id) || !isCitationValidatedEvidence(e)) return false;
    seenEvidence.add(e.id);
    return true;
  });
  const contractMatches = contractEvaluation.claimId === claim.id;
  const supports = contractMatches && contractEvaluation.supportingCriteriaMet ? accepted.filter((e) => e.stance === "supports") : [];
  const contradicts = contractMatches && contractEvaluation.contradictingCriteriaMet ? accepted.filter((e) => e.stance === "contradicts") : [];
  const qualifies = contractMatches && contractEvaluation.contradictingCriteriaMet ? accepted.filter((e) => e.stance === "qualifies") : [];
  const strongContra = contradicts.some((e) => e.relevance === "strong");
  const relevant = supports.length + contradicts.length + qualifies.length;
  const contractProblems = [...contractEvaluation.triggeredAbstentionConditions];
  if (!contractMatches) contractProblems.push("the contract evaluation belongs to a different claim");
  if (!contractEvaluation.primaryRequirementMet && !contractProblems.some((p) => /primary/i.test(p))) {
    contractProblems.push("the primary-source requirement was not met");
  }
  if (!contractEvaluation.preferredSourceRequirementMet && contractEvaluation.supportingCriteriaMet && !contractProblems.some((p) => /preferred source/i.test(p))) {
    contractProblems.push("the preferred-source requirement was not met");
  }
  if (!contractEvaluation.independentOriginRequirementMet && !contractProblems.some((p) => /independent|origin/i.test(p))) {
    contractProblems.push("the independent-origin requirement was not met");
  }
  if (!contractEvaluation.temporalRequirementMet && !contractProblems.some((p) => /newest|predate|current|stale|period/i.test(p))) {
    contractProblems.push("the temporal evidence requirement was not met");
  }
  const contractFails = contractProblems.length > 0;
  const decisiveSupports = contractFails ? [] : supports;
  const historicalSupports = contractMatches
    && contractEvaluation.supportingCriteriaMet
    && contractEvaluation.primaryRequirementMet
    && contractEvaluation.preferredSourceRequirementMet
    && contractEvaluation.independentOriginRequirementMet
    ? supports
    : [];
  const strongHistoricalSupport = historicalSupports.some((e) => e.relevance === "strong");
  const strongSupport = decisiveSupports.some((e) => e.relevance === "strong");

  const base = {
    claimId: claim.id,
    independentOrigins: supportOrigins,
    temporal,
    supporting: supports.map((e) => e.id),
    contradicting: contradicts.map((e) => e.id),
    rationale: `${supports.length} supporting across ${supportOrigins} origin(s), ${contradicts.length} contradicting across ${contraOrigins}; ${qualifies.length} qualification(s).`,
  };
  const make = (verdict: VerdictKind, confidence: Confidence, requiredCorrection: string | null): Verdict => ({ ...base, verdict, confidence, requiredCorrection });

  if (input.researchFailed) {
    return make("failed", "low", "The audit could not complete for this claim; retry the research.");
  }
  if (!claim.verifiable) {
    return { ...base, verdict: "not_verifiable", confidence: "high", supporting: [], contradicting: [], rationale: "Subjective or a matter of opinion, not objectively verifiable.", requiredCorrection: null };
  }

  // 1. deterministic arithmetic disproof outranks retrieved evidence
  if (numeric?.claimId === claim.id && numeric.grounded && numeric.matches === false) {
    return make("contradicted", "high", `The stated figure does not match the underlying numbers (computed ${numeric.computedResult}, claimed ${numeric.claimedResult}).`);
  }

  // 2. nothing to go on
  if (relevant === 0) {
    return make("insufficient_evidence", "low", "Add a citation to an independent source or remove the claim: no evidence was accepted.");
  }

  // 3. once true, now superseded
  if (temporal.superseded && !contractEvaluation.temporalRequirementMet && strongHistoricalSupport && contradicts.length > 0) {
    return make("outdated", band(strongContra, contraOrigins), `Update the claim. ${temporal.note}`);
  }

  // 4. both sides strong: is it a real dispute or an artifact
  if (strongSupport && strongContra) {
    const usableConflict = conflict.claimId === claim.id && conflict.hasConflict;
    if (usableConflict && isGenuineDispute(conflict)) {
      return make("disputed", "medium", "Present both sides: credible evidence genuinely disagrees on the same question.");
    }
    if (usableConflict && isReconciledConflict(conflict)) {
      return make("supported_with_qualifications", "medium", `Add the qualification: ${conflict.explanation || "the contradiction reflects a different scope"}.`);
    }
    return make("disputed", "medium", "Present both sides: the evidence conflicts.");
  }

  if (strongContra && !strongSupport) {
    return make("contradicted", band(true, contraOrigins), `Remove or rewrite: strong contradictory evidence outweighs only partial support.`);
  }

  // 5. contradiction only
  if (contradicts.length > 0 && decisiveSupports.length === 0) {
    return make("contradicted", band(strongContra, contraOrigins), `Remove or rewrite: contradicted by ${contradicts.length} source(s).`);
  }

  // 6. support exists but the contract is not satisfied: qualify or abstain
  if (contractFails) {
    if (!contractEvaluation.supportingCriteriaMet) {
      return make("insufficient_evidence", "low", `Insufficient evidence: ${contractProblems.join("; ")}.`);
    }
    return make("supported_with_qualifications", "low", `Qualify: ${contractProblems.join("; ")}.`);
  }

  // 7. support with a qualification
  if (decisiveSupports.length > 0 && qualifies.length > 0) {
    return make("supported_with_qualifications", band(strongSupport, supportOrigins), "Add the qualification identified in the evidence.");
  }

  if (decisiveSupports.length > 0 && !strongSupport) {
    return make("supported_with_qualifications", "low", "Qualify the claim: the accepted evidence provides only partial support.");
  }

  // 8. clean support
  if (decisiveSupports.length > 0) {
    return make("supported", band(strongSupport, supportOrigins), null);
  }

  return make("insufficient_evidence", "low", "No supporting evidence was accepted.");
}
