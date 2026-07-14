// Contradiction resolution. When strong evidence appears on both sides, the disagreement is
// often not a real dispute: the two sources measure different periods, regions, populations,
// or definitions, or one corrects or supersedes the other. This asks the model to diagnose
// the cause so the Arbiter does not force a false binary. Only a genuine, unreconciled
// conflict should produce a "disputed" verdict.
import { z } from "zod";
import { isCitationValidatedEvidence } from "./citation.js";
import type { Claim, ConflictAnalysis, Evidence } from "../types.js";
import type { ModelProvider } from "../providers/model.js";

const AnalysisSchema = z.object({
  cause: z.enum([
    "different_period", "different_definition", "different_population", "different_region",
    "preliminary_vs_final", "global_vs_segment", "correction", "superseding",
    "different_methodology", "genuine_dispute", "none",
  ]),
  reconciled: z.boolean(),
  explanation: z.string().min(1),
});

const PROMPT = `You are the Conflict analyst for Saga. A claim has both supporting and contradicting evidence. Diagnose WHY they disagree.
cause is one of: different_period, different_definition, different_population, different_region, preliminary_vs_final, global_vs_segment, correction, superseding, different_methodology, or genuine_dispute.
reconciled is true when the apparent conflict is explained away (the sources are not really about the same thing, or one corrects or supersedes the other) and false when credible evidence genuinely disagrees on the same question.`;

// A standing dispute the Arbiter should surface as "disputed": a real disagreement on the
// same question, not an artifact of scope or an outdated figure.
export function isGenuineDispute(a: ConflictAnalysis): boolean {
  return a.hasConflict && (a.cause === "genuine_dispute" || a.cause === "different_methodology");
}

export function isReconciledConflict(a: ConflictAnalysis): boolean {
  return a.hasConflict && !new Set(["genuine_dispute", "different_methodology", "none"]).has(a.cause);
}

function causeConsistentWithCitationFacets(cause: ConflictAnalysis["cause"], evidence: Evidence[]): boolean {
  const assessments = evidence.map((item) => item.citationAssessment!);
  if (cause === "different_period") return assessments.some((item) => !item.samePeriod);
  if (["different_population", "different_region", "global_vs_segment"].includes(cause)) {
    return assessments.some((item) => !item.samePopulation);
  }
  if (cause === "different_definition") {
    return assessments.some((item) => !item.sameEntity || !item.sameMetric);
  }
  return true;
}

export async function resolveContradiction(input: { claim: Claim; supporting: Evidence[]; contradicting: Evidence[]; model: ModelProvider }): Promise<ConflictAnalysis> {
  const { claim, model } = input;
  const supporting = input.supporting.filter((e) => e.claimId === claim.id && e.stance === "supports" && isCitationValidatedEvidence(e));
  const contradicting = input.contradicting.filter((e) => e.claimId === claim.id && e.stance === "contradicts" && isCitationValidatedEvidence(e));
  if (supporting.length === 0 || contradicting.length === 0) {
    return { claimId: claim.id, hasConflict: false, cause: "none", reconciled: false, explanation: "evidence on only one side; no conflict to resolve" };
  }

  const a = await model.generateStructured({
    purpose: "conflict_analysis",
    system: PROMPT,
    prompt: `Claim: "${claim.originalText}"\n\nSupporting excerpts:\n${supporting.map((e) => `- ${e.excerpt}`).join("\n")}\n\nContradicting excerpts:\n${contradicting.map((e) => `- ${e.excerpt}`).join("\n")}`,
    schema: AnalysisSchema,
  });

  const conflictEvidence = [...supporting, ...contradicting];
  const cause = causeConsistentWithCitationFacets(a.cause, conflictEvidence) ? a.cause : "genuine_dispute";
  const explanation = cause === a.cause
    ? a.explanation
    : `The proposed ${a.cause} reconciliation conflicts with the validated citation facets; treat the disagreement as unresolved.`;
  const analysis: ConflictAnalysis = { claimId: claim.id, hasConflict: true, cause, reconciled: false, explanation };
  analysis.reconciled = isReconciledConflict(analysis);
  return analysis;
}
