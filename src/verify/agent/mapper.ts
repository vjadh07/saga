// The Claim Mapper: the one stage where an LLM genuinely earns its place, turning
// arbitrary prose into atomic, typed, verifiable claims. The model proposes claims via a
// structured tool; assembleClaims (pure, tested) then locates each claim's exact offsets,
// validates it, drops anything not present verbatim, and dedups. The model interprets; the
// deterministic half keeps the output honest.
import {
  CLAIM_TYPES,
  RISK_LEVELS,
  type Claim,
  type ClaimType,
  type RiskLevel,
} from "../types.js";
import { hashId } from "../text.js";
import { z } from "zod";
import type { ModelProvider } from "../providers/model.js";

const RawClaimSchema = z.object({
  originalText: z.string().min(1),
  normalized: z.string(),
  claimType: z.enum(CLAIM_TYPES),
  verifiable: z.boolean(),
  timeSensitive: z.boolean(),
  risk: z.enum(RISK_LEVELS),
  asOf: z.string().nullable().optional(),
}).strict();

const ClaimMapOutputSchema = z.object({
  claims: z.array(RawClaimSchema).max(50),
}).strict();

export interface RawClaim {
  originalText: string; // verbatim span from the document
  normalized: string;
  claimType: ClaimType;
  verifiable: boolean;
  timeSensitive: boolean;
  risk: RiskLevel;
  asOf?: string | null;
}

function coerceType(t: unknown): ClaimType {
  return (CLAIM_TYPES as readonly string[]).includes(t as string) ? (t as ClaimType) : "general";
}
function coerceRisk(r: unknown): RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(r as string) ? (r as RiskLevel) : "medium";
}

// Deterministic assembly of raw extractions into validated, located, deduped claims.
export function assembleClaims(document: string, raw: RawClaim[]): Claim[] {
  const byId = new Map<string, Claim>();
  const occupied: Array<{ start: number; end: number }> = [];
  for (const r of raw) {
    const start = document.indexOf(r.originalText);
    if (start < 0) continue; // not present verbatim: cannot be located or corrected, drop it
    const end = start + r.originalText.length;
    if (occupied.some((span) => start < span.end && end > span.start)) continue;
    const id = hashId("claim", r.normalized || r.originalText);
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      originalText: r.originalText,
      normalized: r.normalized || r.originalText.toLowerCase(),
      claimType: coerceType(r.claimType),
      location: { start, end },
      verifiable: Boolean(r.verifiable),
      timeSensitive: Boolean(r.timeSensitive),
      risk: coerceRisk(r.risk),
      status: "contracted",
      asOf: r.asOf ?? null,
    });
    occupied.push({ start, end });
  }
  return [...byId.values()].sort((a, b) => a.location.start - b.location.start);
}

export async function mapClaimsWithModel(document: string, model: ModelProvider): Promise<Claim[]> {
  const output = await model.generateStructured({
    purpose: "claim_mapper",
    system: MAPPER_PROMPT,
    prompt: `Document to map exactly as provided:\n\n${document}`,
    schema: ClaimMapOutputSchema,
  });
  return assembleClaims(document, output.claims);
}

export const MAPPER_PROMPT = `You are the Claim Mapper for Saga, an evidence-auditing agent. Break the user's document into atomic, independently verifiable claims.

Rules:
- One factual assertion per claim. Never combine two assertions.
- originalText MUST be an exact verbatim substring of the document (copy it, do not paraphrase).
- claimType is the single most specific of: numeric (a figure or statistic), event (something happened), causal (X causes Y), definitional (what a term means), quote (an exact quotation), prediction (about the future), existence (a thing exists or has a property), comparison (a ranking or superlative like "largest"), or general when none fits.
- Mark verifiable=false for opinions, value judgments, and predictions that cannot be checked against evidence today.
- timeSensitive=true if the claim could change over time (rankings, "current", "largest", counts for a given year). Set asOf to the date the claim refers to if it states one, else null.
- risk reflects how much harm a wrong answer does if published: high for medical, legal, financial, or safety claims.
Do not evaluate whether the claims are true. Only extract and classify them. When done, stop.`;
