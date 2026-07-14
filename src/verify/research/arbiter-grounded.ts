// The grounded Arbiter for live audits. It receives only validated inputs and decides
// deterministically. It never browses, never invents evidence, and cites only accepted
// evidence ids. Lack of evidence is not evidence of falsehood; a failed search is not a
// contradiction; contract failure produces abstention or qualification, not a verdict of
// false. The deterministic demo keeps using the simpler arbiter in arbiter.ts.
import { isGenuineDispute } from "./conflict.js";
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
  const { claim, contractEvaluation, temporal, numeric, conflict, evidence, supportOrigins, contraOrigins } = input;
  const supports = evidence.filter((e) => e.stance === "supports");
  const contradicts = evidence.filter((e) => e.stance === "contradicts");
  const qualifies = evidence.filter((e) => e.stance === "qualifies");
  const strongSupport = supports.some((e) => e.relevance === "strong");
  const strongContra = contradicts.some((e) => e.relevance === "strong");
  const relevant = supports.length + contradicts.length + qualifies.length;
  const contractFails = contractEvaluation.triggeredAbstentionConditions.length > 0;

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
  if (numeric?.grounded && numeric.matches === false) {
    return make("contradicted", "high", `The stated figure does not match the underlying numbers (computed ${numeric.computedResult}, claimed ${numeric.claimedResult}).`);
  }

  // 2. nothing to go on
  if (relevant === 0) {
    return make("insufficient_evidence", "low", "Add a citation to an independent source or remove the claim: no evidence was accepted.");
  }

  // 3. once true, now superseded
  if (temporal.superseded) {
    return make("outdated", band(strongContra, contraOrigins), `Update the claim. ${temporal.note}`);
  }

  // 4. both sides strong: is it a real dispute or an artifact
  if (strongSupport && strongContra) {
    if (isGenuineDispute(conflict)) {
      return make("disputed", "medium", "Present both sides: credible evidence genuinely disagrees on the same question.");
    }
    if (conflict.reconciled) {
      return make("supported_with_qualifications", "medium", `Add the qualification: ${conflict.explanation || "the contradiction reflects a different scope"}.`);
    }
    return make("disputed", "medium", "Present both sides: the evidence conflicts.");
  }

  // 5. contradiction only
  if (contradicts.length > 0 && supports.length === 0) {
    return make("contradicted", band(strongContra, contraOrigins), `Remove or rewrite: contradicted by ${contradicts.length} source(s).`);
  }

  // 6. support exists but the contract is not satisfied: qualify or abstain
  if (contractFails) {
    if (!contractEvaluation.supportingCriteriaMet) {
      return make("insufficient_evidence", "low", `Insufficient evidence: ${contractEvaluation.triggeredAbstentionConditions.join("; ")}.`);
    }
    return make("supported_with_qualifications", "low", `Qualify: ${contractEvaluation.triggeredAbstentionConditions.join("; ")}.`);
  }

  // 7. support with a qualification
  if (supports.length > 0 && qualifies.length > 0) {
    return make("supported_with_qualifications", band(strongSupport, supportOrigins), "Add the qualification identified in the evidence.");
  }

  // 8. clean support
  if (supports.length > 0) {
    return make("supported", band(strongSupport, supportOrigins), null);
  }

  return make("insufficient_evidence", "low", "No supporting evidence was accepted.");
}
