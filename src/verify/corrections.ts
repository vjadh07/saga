// Corrected-draft assembly. For every claim that needs revision, produce a tracked
// change and a proposed draft with the change applied at the claim's exact character
// offsets. The original is never mutated; both are returned so the user can review the
// diff and approve or reject before anything is applied. Deterministic; an LLM can later
// refine the prose of each replacement, but the set and placement of changes is fixed
// here.
import type { ChangeKind, Claim, CorrectedDraft, DraftChange, Verdict } from "./types.js";

export interface CorrectionItem {
  claim: Pick<Claim, "id" | "originalText" | "location">;
  verdict: Verdict;
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

// The text that replaces the original span in the proposed draft. Editorial markers
// make the tracked change visible; the LLM correction pass can replace these with
// finished prose later.
export function replacementText(original: string, v: Verdict): string {
  switch (v.verdict) {
    case "contradicted":
      return `[removed - contradicted by evidence: ${v.contradicting.length} source(s)]`;
    case "outdated": {
      const fromCorrection = (v.requiredCorrection ?? "").replace(/^Update the claim\.\s*/, "");
      const note = v.temporal?.note ?? (fromCorrection || "superseded by newer evidence");
      return `${original} [update - ${note}]`;
    }
    case "supported_with_qualifications":
      return `${original} [qualify - ${v.requiredCorrection ?? "add the missing qualification"}]`;
    case "disputed":
      return `${original} [disputed - present both sides; evidence conflicts]`;
    case "insufficient_evidence":
      return `${original} [unverified - no independent source found]`;
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
    const replacement = replacementText(it.claim.originalText, it.verdict);
    draft = draft.slice(0, start) + replacement + draft.slice(end);
    changes.push({
      claimId: it.claim.id,
      kind: changeKind(it.verdict.verdict),
      original: it.claim.originalText,
      replacement,
      note: it.verdict.requiredCorrection!,
    });
  }
  // report changes in document order
  changes.reverse();
  return { original, changes, draft };
}
