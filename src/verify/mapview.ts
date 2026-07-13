// The input-screen analysis: the pre-retrieval half of an audit that runs on arbitrary
// pasted text. It extracts and classifies claims (the live LLM stage), writes an Evidence
// Contract for each, and scans the input itself for instruction-like text. This is what
// the studio shows before any evidence exists. The extract function is injected so the
// assembly is testable without a live model.
import { defaultContract } from "./contract.js";
import { sanitizeSource } from "./safety.js";
import type { Claim, EvidenceContract, SafetyEvent } from "./types.js";

export type AuditMode = "quick" | "deep" | "high_stakes";

export interface ClaimMap {
  document: string;
  mode: AuditMode;
  claims: Claim[];
  contracts: EvidenceContract[];
  safety: SafetyEvent[];
}

export async function analyzeInput(
  document: string,
  extract: (doc: string) => Promise<Claim[]>,
  mode: AuditMode = "deep",
): Promise<ClaimMap> {
  const claims = await extract(document);

  // scan the pasted document itself for instruction-like text (an adversarial input),
  // reporting events without altering the user's words
  const safety = sanitizeSource({ id: "input", content: document }).events;

  // quick mode is fast triage: claims only. deep and high-stakes add the contracts;
  // high-stakes additionally demands a primary source for every claim.
  const contracts =
    mode === "quick"
      ? []
      : claims.map((c) => {
          const base = defaultContract(c);
          return mode === "high_stakes" ? { ...base, primaryRequired: true } : base;
        });

  return { document, mode, claims, contracts, safety };
}
