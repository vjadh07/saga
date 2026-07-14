// The Investigator: finds the strongest evidence that SUPPORTS a claim. It drives
// retrieval from the research plan, reads only sanitized content, and decides relevance and
// support itself with no fixture stance label. Every excerpt the model proposes is
// deterministically checked to appear verbatim in the sanitized page, so a hallucinated or
// snippet-only passage can never become evidence. It revises queries and iterates until the
// plan's support target or budget is reached.
import { z } from "zod";
import { hashId, normalizeText } from "../text.js";
import { retrieveSources, type RetrievedSource, type RetrievalError } from "./retrieve.js";
import type { ResearchPlan } from "./plan.js";
import type { ModelProvider } from "../providers/model.js";
import type { PageFetcher } from "../providers/fetch.js";
import type { SearchProvider } from "../providers/search.js";
import type { Claim, Evidence, SafetyEvent, Source } from "../types.js";

const AssessSchema = z.object({
  relevant: z.boolean(),
  supports: z.boolean(),
  excerpt: z.string(),
  relevance: z.enum(["strong", "weak"]),
  reasoning: z.string(),
});

const ReviseSchema = z.object({ queries: z.array(z.string().trim().min(3)).min(1).max(4) });

const INVESTIGATOR_PROMPT = `You are the Investigator for Saga, an evidence-auditing agent. You are given one claim and the sanitized text of one source. Decide, using only the provided text:
- relevant: does this source actually address the exact claim (same entity, metric, period, place)?
- supports: does it provide evidence FOR the claim?
- excerpt: if it supports, copy the exact sentence from the source text that does so, verbatim. Do not paraphrase. If it does not support, return an empty string.
- relevance: strong if the excerpt directly establishes the claim, weak if only suggestive.
Never invent text. Only quote what is present in the source.`;

// verbatim guard: the excerpt must be a real span of the sanitized content and non-trivial
function isVerbatim(excerpt: string, content: string): boolean {
  const e = normalizeText(excerpt);
  return e.split(" ").length >= 4 && normalizeText(content).includes(e);
}

export interface InvestigatorInput {
  claim: Claim;
  plan: ResearchPlan;
  search: SearchProvider;
  fetcher: PageFetcher;
  model: ModelProvider;
  onSearch?: (query: string) => void;
  onRetrieved?: (source: RetrievedSource) => void;
  onError?: (error: RetrievalError) => void;
}

export interface InvestigatorResult {
  evidence: Evidence[];
  rejected: Array<{ sourceId: string; reason: string }>;
  safety: SafetyEvent[];
  sourcesExamined: Source[];
  queriesUsed: string[];
  errors: RetrievalError[];
}

export async function investigateClaim(input: InvestigatorInput): Promise<InvestigatorResult> {
  const { claim, plan, search, fetcher, model } = input;
  const result: InvestigatorResult = {
    evidence: [],
    rejected: [],
    safety: [],
    sourcesExamined: [],
    queriesUsed: [],
    errors: [],
  };
  const seen = new Map<string, Source>();
  let queries = plan.supportingQueries;

  for (let iter = 0; iter < plan.maximumIterations; iter++) {
    result.queriesUsed.push(...queries);
    const { sources, errors } = await retrieveSources({
      queries, search, fetcher, maxSources: plan.maximumSources,
      claimId: claim.id, agent: "investigator",
      onSearch: input.onSearch, onRetrieved: input.onRetrieved, onError: input.onError,
    });
    result.errors.push(...errors);

    for (const rs of sources) {
      result.safety.push(...rs.safety);
      const existing = seen.get(rs.source.id);
      if (existing) {
        if (rs.source.retrievals?.length) existing.retrievals = [...(existing.retrievals ?? []), ...rs.source.retrievals];
        continue;
      }
      seen.set(rs.source.id, rs.source);
      result.sourcesExamined.push(rs.source);

      const assessment = await model.generateStructured({
        purpose: "investigator_assess",
        system: INVESTIGATOR_PROMPT,
        prompt: `Claim: "${claim.originalText}"\n\nSource: ${rs.source.title}\n\nSanitized text:\n${rs.source.content}`,
        schema: AssessSchema,
      });

      if (!assessment.relevant) {
        result.rejected.push({ sourceId: rs.source.id, reason: "not relevant to the claim" });
        continue;
      }
      if (!assessment.supports) {
        result.rejected.push({ sourceId: rs.source.id, reason: "does not support the claim" });
        continue;
      }
      if (!isVerbatim(assessment.excerpt, rs.source.content)) {
        result.rejected.push({ sourceId: rs.source.id, reason: "excerpt not found verbatim in the sanitized source" });
        continue;
      }
      result.evidence.push({
        id: hashId("ev", claim.id, rs.source.id, "supports"),
        claimId: claim.id,
        sourceId: rs.source.id,
        stance: "supports",
        excerpt: assessment.excerpt,
        relevance: assessment.relevance,
        capturedBy: "investigator",
      });
    }

    if (result.evidence.length >= plan.minimumIndependentOrigins) break;
    if (iter + 1 < plan.maximumIterations) {
      const revised = await model.generateStructured({
        purpose: "investigator_revise",
        system: INVESTIGATOR_PROMPT,
        prompt: `The claim "${claim.originalText}" still lacks sufficient support after queries: ${queries.join(", ")}. Propose better supporting search queries.`,
        schema: ReviseSchema,
      });
      queries = revised.queries;
    }
  }

  return result;
}
