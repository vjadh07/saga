// The Revision Agent. It writes concise corrected prose grounded in the validated evidence,
// preserving the author's tone, and returns a tracked change. Every revision is checked:
// it must not introduce a number absent from the original or the evidence, must not restate
// a contradicted claim, and may cite only accepted evidence. If the prose fails validation,
// Saga falls back to the deterministic editorial marker rather than shipping an unsupported
// sentence. The original is never overwritten here; this only proposes a change.
import { z } from "zod";
import { normalizeText } from "../text.js";
import { changeKind, replacementText } from "../corrections.js";
import type { Claim, DraftChange, Evidence, Verdict, VerdictKind } from "../types.js";
import type { ModelProvider } from "../providers/model.js";

const RevisionSchema = z.object({
  replacement: z.string(),
  citationEvidenceIds: z.array(z.string()),
  reasoning: z.string(),
});

function extractNumbers(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => x.replace(/,/g, ""));
}

export interface ValidateRevisionInput {
  original: string;
  replacement: string;
  verdictKind: VerdictKind;
  citationIds: string[];
  validEvidenceIds: Set<string>;
  evidenceText: string;
}

export function validateRevision(input: ValidateRevisionInput): { ok: boolean; reason: string; citations: string[] } {
  const citations = input.citationIds.filter((id) => input.validEvidenceIds.has(id));

  if (input.replacement.trim() === "") {
    return { ok: false, reason: "empty replacement", citations };
  }
  // no number may appear in the replacement unless it is in the original or the evidence
  const allowed = new Set(extractNumbers(`${input.original} ${input.evidenceText}`));
  for (const n of extractNumbers(input.replacement)) {
    if (!allowed.has(n)) return { ok: false, reason: `unsupported number ${n} not present in the original or evidence`, citations };
  }
  // a contradicted claim must not be restated verbatim
  if (input.verdictKind === "contradicted" && normalizeText(input.replacement).includes(normalizeText(input.original))) {
    return { ok: false, reason: "replacement restates the contradicted claim", citations };
  }
  return { ok: true, reason: "", citations };
}

const PROMPT = `You are the Revision Agent for Saga. Rewrite one sentence so it is accurate given the verdict and the validated evidence, preserving the author's tone and brevity.
Rules: do not introduce any number that is not in the original sentence or the evidence. Do not restate a claim the evidence contradicts. Cite only the evidence ids provided. If the verdict is contradicted, remove or replace the false assertion. Keep it to one or two sentences.`;

export async function reviseChange(input: { claim: Claim; verdict: Verdict; evidence: Evidence[]; model: ModelProvider }): Promise<DraftChange | null> {
  const { claim, verdict, evidence, model } = input;
  if (verdict.requiredCorrection === null) return null;

  const validIds = new Set(evidence.map((e) => e.id));
  const evidenceText = evidence.map((e) => e.excerpt).join(" ");
  const kind = changeKind(verdict.verdict);

  const fallback = (): DraftChange => ({
    claimId: claim.id,
    kind,
    original: claim.originalText,
    replacement: replacementText(claim.originalText, verdict),
    note: verdict.requiredCorrection!,
    citations: [],
    source: "deterministic_marker",
  });

  let rev: z.infer<typeof RevisionSchema>;
  try {
    rev = await model.generateStructured({
      purpose: "revision",
      system: PROMPT,
      prompt: `Original sentence: "${claim.originalText}"\nVerdict: ${verdict.verdict}\nRequired correction: ${verdict.requiredCorrection}\nValidated evidence:\n${evidence.map((e) => `- [${e.id}] ${e.excerpt}`).join("\n")}`,
      schema: RevisionSchema,
    });
  } catch {
    return fallback();
  }

  const v = validateRevision({
    original: claim.originalText,
    replacement: rev.replacement,
    verdictKind: verdict.verdict,
    citationIds: rev.citationEvidenceIds,
    validEvidenceIds: validIds,
    evidenceText,
  });
  if (!v.ok) return fallback();

  return {
    claimId: claim.id,
    kind,
    original: claim.originalText,
    replacement: rev.replacement,
    note: verdict.requiredCorrection!,
    citations: v.citations,
    source: "revision_agent",
  };
}
