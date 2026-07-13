// The Arbiter: one grounded verdict per claim, decided deterministically from the
// evidence the Investigator and Skeptic actually retrieved, the number of independent
// origins behind it (from lineage), and the temporal assessment. It never browses and
// never invents a source. Confidence is low / medium / high, never a fabricated
// percentage. An LLM later narrates the rationale, but cannot change the verdict.
import type { Confidence, Evidence, TemporalAssessment, Verdict, VerdictKind } from "./types.js";

export interface ArbiterInput {
  claim: { id: string; verifiable: boolean; timeSensitive: boolean };
  evidence: Evidence[];
  independentOrigins: number; // independent origins behind the SUPPORTING evidence
  temporal: TemporalAssessment;
}

function ids(list: Evidence[]): string[] {
  return list.map((e) => e.id);
}

// high requires strong evidence corroborated by at least two independent origins;
// a single origin, however strong, is capped at medium; weak-only evidence is low.
function band(hasStrong: boolean, independentOrigins: number): Confidence {
  if (!hasStrong) return "low";
  if (independentOrigins >= 2) return "high";
  return "medium";
}

export function arbitrate(input: ArbiterInput): Verdict {
  const { claim, evidence, independentOrigins, temporal } = input;
  const base = {
    claimId: claim.id,
    independentOrigins,
    temporal,
  };

  if (!claim.verifiable) {
    return {
      ...base,
      verdict: "not_verifiable",
      confidence: "high",
      rationale: "The statement is subjective or a matter of opinion, not an objectively verifiable fact.",
      supporting: [],
      contradicting: [],
      requiredCorrection: null,
    };
  }

  const supports = evidence.filter((e) => e.stance === "supports");
  const contradicts = evidence.filter((e) => e.stance === "contradicts");
  const qualifies = evidence.filter((e) => e.stance === "qualifies");
  const relevant = supports.length + contradicts.length + qualifies.length;

  const strongSupport = supports.some((e) => e.relevance === "strong");
  const strongContra = contradicts.some((e) => e.relevance === "strong");

  const rationale = `${supports.length} supporting and ${contradicts.length} contradicting passage(s) across ${independentOrigins} independent origin(s); ${qualifies.length} qualification(s).`;

  let verdict: VerdictKind;
  let confidence: Confidence;
  let requiredCorrection: string | null = null;

  if (relevant === 0) {
    verdict = "insufficient_evidence";
    confidence = "low";
    requiredCorrection = "Add a citation to an independent source or remove the claim: no supporting evidence was found.";
  } else if (temporal.superseded) {
    verdict = "outdated";
    confidence = band(strongContra, independentOrigins);
    requiredCorrection = `Update the claim. ${temporal.note}`;
  } else if (strongSupport && strongContra) {
    verdict = "disputed";
    confidence = "medium";
    requiredCorrection = "Present both sides: credible evidence both supports and contradicts this claim.";
  } else if (contradicts.length > 0 && supports.length === 0) {
    verdict = "contradicted";
    confidence = band(strongContra, independentOrigins);
    requiredCorrection = `Remove or rewrite: contradicted by ${contradicts.length} source(s).`;
  } else if (supports.length > 0 && qualifies.length > 0) {
    verdict = "supported_with_qualifications";
    confidence = band(strongSupport, independentOrigins);
    requiredCorrection = "Add the qualification identified in the evidence so the claim is not overstated.";
  } else if (supports.length > 0) {
    verdict = "supported";
    confidence = band(strongSupport, independentOrigins);
  } else {
    // qualifies-only: partial, treat as qualified support with low confidence
    verdict = "supported_with_qualifications";
    confidence = "low";
    requiredCorrection = "Add the qualification identified in the evidence.";
  }

  return {
    ...base,
    verdict,
    confidence,
    rationale,
    supporting: ids(supports),
    contradicting: ids(contradicts),
    requiredCorrection,
  };
}
