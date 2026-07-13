// Citation entailment verification. Finding a related page is not enough. For every
// proposed excerpt this stage classifies the relation to the claim (does it directly
// support, only partially support, qualify, contradict, or is it merely context), and
// re-checks deterministically that the excerpt appears verbatim in the sanitized source.
// It downgrades overreaching citations: if the claim is stronger than the source, direct
// support becomes partial; if qualifiers were omitted, support becomes a qualification.
// Only validated evidence leaves this file.
import { z } from "zod";
import { normalizeText } from "../text.js";
import type { ModelProvider } from "../providers/model.js";
import type { CitationRelation, Claim, Evidence, Relevance, Source, Stance } from "../types.js";

export interface EvidenceCandidate {
  evidence: Evidence;
  source: Source;
}

export interface ValidateResult {
  validated: Evidence[];
  rejected: Array<{ evidence: Evidence; reason: string }>;
}

const AssessSchema = z.object({
  sameEntity: z.boolean(),
  sameMetric: z.boolean(),
  samePeriod: z.boolean(),
  samePopulation: z.boolean(),
  claimStrongerThanSource: z.boolean(),
  qualifiersOmitted: z.boolean(),
  relation: z.enum(["direct_support", "partial_support", "qualification", "direct_contradiction", "context_only", "irrelevant"]),
  explanation: z.string(),
});

const PROMPT = `You are the Citation Verifier for Saga. Given a claim and one exact excerpt from a source, judge how the excerpt relates to the claim. Answer only from the excerpt and the claim, not outside knowledge.
Decide each: sameEntity, sameMetric, samePeriod, samePopulation (does the excerpt concern the same thing, measure, time, and group as the claim). claimStrongerThanSource (does the claim assert more than the excerpt establishes). qualifiersOmitted (does the excerpt carry a caveat the claim drops).
Then choose relation: direct_support, partial_support, qualification, direct_contradiction, context_only, or irrelevant.`;

function isVerbatim(excerpt: string, content: string): boolean {
  const e = normalizeText(excerpt);
  return e.split(" ").length >= 4 && normalizeText(content).includes(e);
}

// deterministic downgrades applied on top of the model's relation
function adjustRelation(relation: CitationRelation, a: z.infer<typeof AssessSchema>): CitationRelation {
  let r = relation;
  if (r === "direct_support" && a.claimStrongerThanSource) r = "partial_support";
  if ((r === "direct_support" || r === "partial_support") && a.qualifiersOmitted) r = "qualification";
  return r;
}

function relationToStance(relation: CitationRelation): { stance: Stance; relevance: Relevance } | null {
  switch (relation) {
    case "direct_support":
      return { stance: "supports", relevance: "strong" };
    case "partial_support":
      return { stance: "supports", relevance: "weak" };
    case "qualification":
      return { stance: "qualifies", relevance: "weak" };
    case "direct_contradiction":
      return { stance: "contradicts", relevance: "strong" };
    default:
      return null; // context_only, irrelevant: not usable evidence
  }
}

export async function validateEvidence(input: { claim: Claim; candidates: EvidenceCandidate[]; model: ModelProvider }): Promise<ValidateResult> {
  const { claim, candidates, model } = input;
  const result: ValidateResult = { validated: [], rejected: [] };

  for (const { evidence, source } of candidates) {
    if (!isVerbatim(evidence.excerpt, source.content)) {
      result.rejected.push({ evidence, reason: "excerpt not found verbatim in the sanitized source (exact match failed)" });
      continue;
    }

    const a = await model.generateStructured({
      purpose: "citation_assessment",
      system: PROMPT,
      prompt: `Claim: "${claim.originalText}"\n\nExcerpt: "${evidence.excerpt}"`,
      schema: AssessSchema,
    });

    const relation = adjustRelation(a.relation, a);
    const mapped = relationToStance(relation);
    const citationAssessment = { relation, explanation: a.explanation, exactMatchVerified: true };

    if (!mapped) {
      result.rejected.push({ evidence: { ...evidence, citationAssessment }, reason: `relation ${relation}: not usable as evidence` });
      continue;
    }
    result.validated.push({ ...evidence, stance: mapped.stance, relevance: mapped.relevance, citationAssessment });
  }

  return result;
}
