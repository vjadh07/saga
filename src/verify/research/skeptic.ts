// The Skeptic: independently tries to disprove or qualify a claim. It runs its own
// counter-queries from the plan, never sees the Investigator's evidence or verdict, and may
// legitimately find nothing. It looks for contradictions, missing qualifications, newer
// superseding evidence, and mismatched definitions or populations. Every excerpt is checked
// verbatim, exactly like the Investigator.
import { z } from "zod";
import { hashId, normalizeText } from "../text.js";
import { retrieveSources } from "./retrieve.js";
import type { ResearchPlan } from "./plan.js";
import type { ModelProvider } from "../providers/model.js";
import type { PageFetcher } from "../providers/fetch.js";
import type { SearchProvider } from "../providers/search.js";
import type { Claim, Evidence, SafetyEvent, Source } from "../types.js";

const AssessSchema = z.object({
  relevant: z.boolean(),
  stance: z.enum(["contradicts", "qualifies", "none"]),
  excerpt: z.string(),
  relevance: z.enum(["strong", "weak"]),
  reasoning: z.string(),
});

const ReviseSchema = z.object({ queries: z.array(z.string().min(3)).min(1).max(4) });

const SKEPTIC_PROMPT = `You are the Skeptic for Saga, an evidence-auditing agent. Your job is to challenge one claim, not confirm it. Given the claim and the sanitized text of one source, decide using only the provided text:
- relevant: does this source address the exact claim (same entity, metric, period, place)?
- stance: "contradicts" if it provides evidence AGAINST the claim, "qualifies" if it shows the claim is true only with an important caveat or for a subset, or "none" if it neither contradicts nor qualifies.
- excerpt: if it contradicts or qualifies, copy the exact sentence verbatim. Otherwise empty.
- relevance: strong or weak.
Look for newer superseding evidence, missing qualifications, mismatched definitions, populations, or regions, preliminary versus final results, and corrections. Never invent text.`;

function isVerbatim(excerpt: string, content: string): boolean {
  const e = normalizeText(excerpt);
  return e.split(" ").length >= 4 && normalizeText(content).includes(e);
}

export interface SkepticInput {
  claim: Claim;
  plan: ResearchPlan;
  search: SearchProvider;
  fetcher: PageFetcher;
  model: ModelProvider;
}

export interface SkepticResult {
  evidence: Evidence[];
  rejected: Array<{ sourceId: string; reason: string }>;
  safety: SafetyEvent[];
  sourcesExamined: Source[];
  queriesUsed: string[];
  errors: Array<{ url: string; error: string }>;
}

export async function skepticResearch(input: SkepticInput): Promise<SkepticResult> {
  const { claim, plan, search, fetcher, model } = input;
  const result: SkepticResult = {
    evidence: [],
    rejected: [],
    safety: [],
    sourcesExamined: [],
    queriesUsed: [],
    errors: [],
  };
  const seen = new Set<string>();
  let queries = plan.skepticQueries;

  for (let iter = 0; iter < plan.maximumIterations; iter++) {
    result.queriesUsed.push(...queries);
    const { sources, errors } = await retrieveSources({ queries, search, fetcher, maxSources: plan.maximumSources });
    result.errors.push(...errors);

    for (const rs of sources) {
      if (seen.has(rs.source.id)) continue;
      seen.add(rs.source.id);
      result.sourcesExamined.push(rs.source);
      result.safety.push(...rs.safety);

      const a = await model.generateStructured({
        purpose: "skeptic_assess",
        system: SKEPTIC_PROMPT,
        prompt: `Claim: "${claim.originalText}"\n\nSource: ${rs.source.title}\n\nSanitized text:\n${rs.source.content}`,
        schema: AssessSchema,
      });

      if (!a.relevant || a.stance === "none") {
        result.rejected.push({ sourceId: rs.source.id, reason: a.relevant ? "no contradiction or qualification" : "not relevant to the claim" });
        continue;
      }
      if (!isVerbatim(a.excerpt, rs.source.content)) {
        result.rejected.push({ sourceId: rs.source.id, reason: "excerpt not found verbatim in the sanitized source" });
        continue;
      }
      result.evidence.push({
        id: hashId("ev", claim.id, rs.source.id, a.stance),
        claimId: claim.id,
        sourceId: rs.source.id,
        stance: a.stance,
        excerpt: a.excerpt,
        relevance: a.relevance,
        capturedBy: "skeptic",
      });
    }

    // the Skeptic surfaces counterevidence as soon as it finds any; otherwise it revises
    if (result.evidence.length > 0) break;
    if (iter + 1 < plan.maximumIterations) {
      const revised = await model.generateStructured({
        purpose: "skeptic_revise",
        system: SKEPTIC_PROMPT,
        prompt: `No counterevidence found for "${claim.originalText}" after queries: ${queries.join(", ")}. Propose sharper counter-queries.`,
        schema: ReviseSchema,
      });
      queries = revised.queries;
    }
  }

  return result;
}
