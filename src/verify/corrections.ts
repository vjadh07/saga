// Corrected-draft assembly. For every claim that needs revision, produce a tracked
// change and a proposed draft with the change applied at the claim's exact character
// offsets. The original is never mutated; both are returned so the user can review the
// diff and approve or reject before anything is applied. Accepted evidence-grounded
// prose may be supplied by the Revision Agent; otherwise a safe verdict-only sentence
// is used. The set and placement of changes remains deterministic.
import type { ChangeKind, Claim, CorrectedDraft, DraftChange, Verdict } from "./types.js";

export interface CorrectionItem {
  claim: Pick<Claim, "id" | "originalText" | "location">;
  verdict: Verdict;
  change?: DraftChange | null;
}

export function changeKind(verdict: Verdict["verdict"]): ChangeKind {
  switch (verdict) {
    case "contradicted":
      return "remove";
    case "outdated":
      return "update";
    case "supported_with_qualifications":
      return "qualify";
    default:
      return "flag"; // disputed, insufficient_evidence
  }
}

// Safe editorial fallback for deterministic callers that do not have an accepted
// evidence sentence. It states only the validated verdict and never inserts a marker.
export function replacementText(original: string, v: Verdict): string {
  switch (v.verdict) {
    case "contradicted":
      return "The original claim was contradicted by validated evidence.";
    case "outdated":
      return "The original statement is no longer current.";
    case "supported_with_qualifications":
      return "The available evidence supports a narrower claim, but the original wording omits important context.";
    case "disputed":
      return "Reliable sources disagree about this claim.";
    case "insufficient_evidence":
      return "This claim could not be verified with sufficient reliable evidence.";
    default:
      return original;
  }
}

export function buildCorrectedDraft(original: string, items: CorrectionItem[]): CorrectedDraft {
  const changes: DraftChange[] = [];
  // apply from the end of the document backward so earlier offsets stay valid
  const ordered = [...items]
    .filter((it) => it.verdict.requiredCorrection !== null)
    .sort((a, b) => b.claim.location.start - a.claim.location.start);

  let draft = original;
  for (const it of ordered) {
    const { start, end } = it.claim.location;
    const accepted = it.change?.claimId === it.claim.id
      ? it.change
      : null;
    const replacement = accepted?.replacement ?? replacementText(it.claim.originalText, it.verdict);
    draft = draft.slice(0, start) + replacement + draft.slice(end);
    changes.push({
      claimId: it.claim.id,
      kind: changeKind(it.verdict.verdict),
      original: it.claim.originalText,
      replacement,
      note: accepted?.note ?? it.verdict.requiredCorrection!,
      citations: accepted?.citations ?? [],
      source: accepted?.source ?? "deterministic_revision",
      ...(accepted?.numericCheckClaimId ? { numericCheckClaimId: accepted.numericCheckClaimId } : {}),
    });
  }
  // report changes in document order
  changes.reverse();
  return { original, changes, draft };
}
