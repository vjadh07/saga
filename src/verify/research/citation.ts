// Citation entailment verification. Finding a related page is not enough. For every
// proposed excerpt this stage classifies the relation to the claim (does it directly
// support, only partially support, qualify, contradict, or is it merely context), and
// re-checks deterministically that the excerpt appears verbatim in the sanitized source.
// It downgrades overreaching citations: if the claim is stronger than the source, direct
// support becomes partial; if qualifiers were omitted, support becomes a qualification.
// Only validated evidence leaves this file.
import { z } from "zod";
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
  const normalizeVerbatim = (value: string): string => value
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  const e = normalizeVerbatim(excerpt);
  const tokens = e.match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.length >= 4 && normalizeVerbatim(content).includes(e);
}

// deterministic downgrades applied on top of the model's relation
function adjustRelation(relation: CitationRelation, a: z.infer<typeof AssessSchema>): CitationRelation {
  let r = relation;
  if (!a.sameEntity || !a.sameMetric) return "irrelevant";
  if (!a.samePeriod || !a.samePopulation) {
    if (r === "direct_support" || r === "partial_support") return "qualification";
    if (r === "direct_contradiction") return "context_only";
  }
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

export function isCitationValidatedEvidence(evidence: Evidence): boolean {
  const assessment = evidence.citationAssessment;
  if (!assessment?.exactMatchVerified) return false;
  if (!assessment.sameEntity || !assessment.sameMetric) return false;
  if (["direct_support", "partial_support", "direct_contradiction"].includes(assessment.relation)
      && (!assessment.samePeriod || !assessment.samePopulation)) return false;
  if (assessment.relation === "direct_support" && (assessment.claimStrongerThanSource || assessment.qualifiersOmitted)) return false;
  if (assessment.relation === "partial_support" && assessment.qualifiersOmitted) return false;
  const mapped = relationToStance(assessment.relation);
  return mapped !== null && mapped.stance === evidence.stance && mapped.relevance === evidence.relevance;
}

export async function validateEvidence(input: { claim: Claim; candidates: EvidenceCandidate[]; model: ModelProvider }): Promise<ValidateResult> {
  const { claim, candidates, model } = input;
  const result: ValidateResult = { validated: [], rejected: [] };

  for (const { evidence, source } of candidates) {
    if (evidence.claimId !== claim.id) {
      result.rejected.push({ evidence, reason: "evidence belongs to a different claim" });
      continue;
    }
    if (evidence.sourceId !== source.id) {
      result.rejected.push({ evidence, reason: "evidence source id does not match the source being validated" });
      continue;
    }
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
    const citationAssessment = {
      relation,
      explanation: a.explanation,
      exactMatchVerified: true,
      sameEntity: a.sameEntity,
      sameMetric: a.sameMetric,
      samePeriod: a.samePeriod,
      samePopulation: a.samePopulation,
      claimStrongerThanSource: a.claimStrongerThanSource,
      qualifiersOmitted: a.qualifiersOmitted,
    };

    if (!mapped) {
      result.rejected.push({ evidence: { ...evidence, citationAssessment }, reason: `relation ${relation}: not usable as evidence` });
      continue;
    }
    result.validated.push({ ...evidence, stance: mapped.stance, relevance: mapped.relevance, citationAssessment });
  }

  return result;
}
