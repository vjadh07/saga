// Claim dependencies. The model identifies how claims relate (one is calculated from
// another, assumes another, qualifies or contradicts another). Deterministic code then
// propagates: when a foundational claim fails, its dependents are flagged for
// re-evaluation, never automatically marked false.
import { z } from "zod";
import type { Claim, ClaimDependency, DependencyKind } from "../types.js";
import type { ModelProvider } from "../providers/model.js";

const DepSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["depends_on", "derived_from", "assumes", "calculated_from", "qualifies", "contradicts"]),
});
const DependenciesSchema = z.object({ dependencies: z.array(DepSchema) });

// relationships where the "from" claim rests on the "to" claim being true
const FOUNDATIONAL: ReadonlySet<DependencyKind> = new Set(["depends_on", "derived_from", "assumes", "calculated_from"]);

const PROMPT = `You are the Dependency analyst for Saga. Given a numbered list of claims, identify relationships BETWEEN them. Use only the claim ids provided.
kind is one of: depends_on, derived_from, assumes, calculated_from (the "from" claim rests on the "to" claim), qualifies, or contradicts.
Only report real relationships. If claims are independent, return an empty list.`;

export async function detectDependencies(input: { claims: Claim[]; model: ModelProvider }): Promise<ClaimDependency[]> {
  const { claims, model } = input;
  if (claims.length < 2) return [];
  const ids = new Set(claims.map((c) => c.id));

  const out = await model.generateStructured({
    purpose: "claim_dependencies",
    system: PROMPT,
    prompt: claims.map((c) => `${c.id}: "${c.originalText}"`).join("\n"),
    schema: DependenciesSchema,
  });

  // keep only edges between known, distinct claims
  return out.dependencies.filter((d) => d.from !== d.to && ids.has(d.from) && ids.has(d.to));
}

// Pure propagation: from a set of failed claim ids, follow foundational edges backward to
// find every dependent claim whose conclusion may be weakened.
export function propagateReevaluation(
  dependencies: ClaimDependency[],
  failedIds: Set<string>,
): Array<{ claimId: string; reason: string }> {
  const affected = new Map<string, string>();
  const queue = [...failedIds];

  while (queue.length > 0) {
    const failed = queue.shift()!;
    for (const dep of dependencies) {
      if (dep.to !== failed || !FOUNDATIONAL.has(dep.kind)) continue;
      if (failedIds.has(dep.from) || affected.has(dep.from)) continue;
      affected.set(dep.from, `may be weakened: ${dep.kind.replace(/_/g, " ")} ${failed}, which did not hold; re-evaluation recommended`);
      queue.push(dep.from);
    }
  }

  return [...affected.entries()].map(([claimId, reason]) => ({ claimId, reason }));
}
