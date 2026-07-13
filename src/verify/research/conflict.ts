// Contradiction resolution. When strong evidence appears on both sides, the disagreement is
// often not a real dispute: the two sources measure different periods, regions, populations,
// or definitions, or one corrects or supersedes the other. This asks the model to diagnose
// the cause so the Arbiter does not force a false binary. Only a genuine, unreconciled
// conflict should produce a "disputed" verdict.
import { z } from "zod";
import type { Claim, ConflictAnalysis, Evidence } from "../types.js";
import type { ModelProvider } from "../providers/model.js";

const AnalysisSchema = z.object({
  cause: z.enum([
    "different_period", "different_definition", "different_population", "different_region",
    "preliminary_vs_final", "global_vs_segment", "correction", "superseding",
    "different_methodology", "genuine_dispute", "none",
  ]),
  reconciled: z.boolean(),
  explanation: z.string(),
});

const PROMPT = `You are the Conflict analyst for Saga. A claim has both supporting and contradicting evidence. Diagnose WHY they disagree.
cause is one of: different_period, different_definition, different_population, different_region, preliminary_vs_final, global_vs_segment, correction, superseding, different_methodology, or genuine_dispute.
reconciled is true when the apparent conflict is explained away (the sources are not really about the same thing, or one corrects or supersedes the other) and false when credible evidence genuinely disagrees on the same question.`;

// A standing dispute the Arbiter should surface as "disputed": a real disagreement on the
// same question, not an artifact of scope or an outdated figure.
export function isGenuineDispute(a: ConflictAnalysis): boolean {
  return a.hasConflict && !a.reconciled && (a.cause === "genuine_dispute" || a.cause === "different_methodology" || a.cause === "preliminary_vs_final");
}

export async function resolveContradiction(input: { claim: Claim; supporting: Evidence[]; contradicting: Evidence[]; model: ModelProvider }): Promise<ConflictAnalysis> {
  const { claim, supporting, contradicting, model } = input;
  if (supporting.length === 0 || contradicting.length === 0) {
    return { claimId: claim.id, hasConflict: false, cause: "none", reconciled: false, explanation: "evidence on only one side; no conflict to resolve" };
  }

  const a = await model.generateStructured({
    purpose: "conflict_analysis",
    system: PROMPT,
    prompt: `Claim: "${claim.originalText}"\n\nSupporting excerpts:\n${supporting.map((e) => `- ${e.excerpt}`).join("\n")}\n\nContradicting excerpts:\n${contradicting.map((e) => `- ${e.excerpt}`).join("\n")}`,
    schema: AnalysisSchema,
  });

  return { claimId: claim.id, hasConflict: true, cause: a.cause, reconciled: a.reconciled, explanation: a.explanation };
}
