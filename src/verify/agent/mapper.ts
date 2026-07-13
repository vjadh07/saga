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
  for (const r of raw) {
    const start = document.indexOf(r.originalText);
    if (start < 0) continue; // not present verbatim: cannot be located or corrected, drop it
    const id = hashId("claim", r.normalized || r.originalText);
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      originalText: r.originalText,
      normalized: r.normalized || r.originalText.toLowerCase(),
      claimType: coerceType(r.claimType),
      location: { start, end: start + r.originalText.length },
      verifiable: Boolean(r.verifiable),
      timeSensitive: Boolean(r.timeSensitive),
      risk: coerceRisk(r.risk),
      status: "contracted",
      asOf: r.asOf ?? null,
    });
  }
  return [...byId.values()].sort((a, b) => a.location.start - b.location.start);
}

export const MAPPER_PROMPT = `You are the Claim Mapper for Saga, an evidence-auditing agent. Break the user's document into atomic, independently verifiable claims. Report each claim by calling record_claim exactly once per claim.

Rules:
- One factual assertion per claim. Never combine two assertions.
- originalText MUST be an exact verbatim substring of the document (copy it, do not paraphrase).
- Mark verifiable=false for opinions, value judgments, and predictions that cannot be checked against evidence today.
- timeSensitive=true if the claim could change over time (rankings, "current", "largest", counts for a given year). Set asOf to the date the claim refers to if it states one, else null.
- risk reflects how much harm a wrong answer does if published: high for medical, legal, financial, or safety claims.
Do not evaluate whether the claims are true. Only extract and classify them. When done, stop.`;
