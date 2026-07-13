// The Research Planner. For each verifiable claim it produces a structured plan BEFORE any
// retrieval, so Saga cannot move the goalposts after seeing evidence. The model proposes
// only the search queries (genuinely interpretive); deterministic code sets every budget
// and stopping rule from the audit mode and the Evidence Contract. The final plan is
// zod-validated.
import { z } from "zod";
import { SOURCE_TYPES, type Claim, type EvidenceContract } from "../types.js";
import type { AuditMode } from "../mapview.js";
import type { ModelProvider } from "../providers/model.js";

export const ResearchPlanSchema = z.object({
  claimId: z.string(),
  supportingQueries: z.array(z.string()).min(1),
  skepticQueries: z.array(z.string()).min(1),
  preferredSourceTypes: z.array(z.enum(SOURCE_TYPES)).min(1),
  primaryRequired: z.boolean(),
  minimumIndependentOrigins: z.number().int().min(1),
  maximumIterations: z.number().int().min(1).max(5),
  maximumSources: z.number().int().min(1).max(20),
  stopWhen: z.array(z.string()).min(1),
  abstainWhen: z.array(z.string()).min(1),
});
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

// only the queries come from the model; everything else is deterministic
const QueriesSchema = z.object({
  supportingQueries: z.array(z.string().min(3)).min(1).max(6),
  skepticQueries: z.array(z.string().min(3)).min(1).max(6),
});

const BUDGETS: Record<AuditMode, { minOrigins: number; maxIterations: number; maxSources: number }> = {
  quick: { minOrigins: 1, maxIterations: 1, maxSources: 4 },
  deep: { minOrigins: 2, maxIterations: 2, maxSources: 8 },
  high_stakes: { minOrigins: 3, maxIterations: 3, maxSources: 12 },
};

const PLANNER_PROMPT = `You are the Research Planner for Saga, an evidence-auditing agent. Given one claim and its evidence contract, propose the web search queries a researcher would run.

Return two query sets:
- supportingQueries: queries most likely to surface primary or authoritative evidence FOR the claim.
- skepticQueries: queries most likely to surface contradictions, newer or superseding evidence, missing qualifications, or signs the claim is overstated.

Make queries specific: include entities, metrics, years, and source types where useful. Do not answer the claim. Do not judge it. Only produce queries.`;

export interface PlanInput {
  claim: Claim;
  contract: EvidenceContract;
  mode: AuditMode;
  model: ModelProvider;
}

export async function planResearch(input: PlanInput): Promise<ResearchPlan> {
  const { claim, contract, mode, model } = input;

  const queries = await model.generateStructured({
    purpose: "research_plan",
    system: PLANNER_PROMPT,
    prompt: `Claim: "${claim.originalText}"\nType: ${claim.claimType}\nTime-sensitive: ${claim.timeSensitive}\nEvidence contract:\n- supporting: ${contract.supportingCriteria.join("; ")}\n- contradicting: ${contract.contradictingCriteria.join("; ")}\n- preferred source types: ${contract.preferredSourceTypes.join(", ")}\n- primary required: ${contract.primaryRequired}`,
    schema: QueriesSchema,
  });

  const budget = BUDGETS[mode];
  const primaryRequired = contract.primaryRequired || mode === "high_stakes";
  const minOrigins = Math.max(budget.minOrigins, primaryRequired ? 1 : 1);

  const plan: ResearchPlan = {
    claimId: claim.id,
    supportingQueries: queries.supportingQueries,
    skepticQueries: queries.skepticQueries,
    preferredSourceTypes: contract.preferredSourceTypes,
    primaryRequired,
    minimumIndependentOrigins: minOrigins,
    maximumIterations: budget.maxIterations,
    maximumSources: budget.maxSources,
    stopWhen: [
      `${minOrigins} independent supporting origin(s) satisfy the contract`,
      `${budget.maxSources} sources examined`,
      `${budget.maxIterations} search iteration(s) completed`,
    ],
    abstainWhen: contract.abstentionConditions,
  };

  return ResearchPlanSchema.parse(plan);
}
