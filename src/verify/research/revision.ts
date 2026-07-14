// The Revision Agent produces a proposed correction without overwriting the original.
// Model prose crosses a deterministic acceptance boundary: every factual token, number,
// sign, unit, and qualifier must retain the order found in cited, citation-validated
// evidence or in a matching grounded numeric trace. Unsupported output falls back to a
// finished evidence sentence or a safe removal, never an editorial placeholder.
import { z } from "zod";
import { normalizeText } from "../text.js";
import { changeKind } from "../corrections.js";
import { isCitationValidatedEvidence } from "./citation.js";
import { computeNumeric } from "./numeric.js";
import type { Claim, DraftChange, Evidence, NumericCheck, Verdict, VerdictKind } from "../types.js";
import type { ModelProvider } from "../providers/model.js";

const RevisionSchema = z.object({
  replacement: z.string().trim().min(1).max(600),
  citationEvidenceIds: z.array(z.string().min(1)).max(12),
}).strict();

const PLACEHOLDER = /(?:\bTODO\b|\bTBD\b|\bPLACEHOLDER\b|\bINSERT\b.{0,80}\bHERE\b|\[(?:update|qualify|removed?|remove|citation needed|unverified|disputed)\b)/i;
const CRITICAL_QUALIFIERS = new Set([
  "not", "no", "never", "without", "only", "except", "unless", "more", "less", "least", "most",
  "before", "after", "under", "over", "approximately", "about", "around", "may", "might", "could",
  "can", "would", "should", "must", "possible", "possibly", "likely", "unlikely", "alleged", "allegedly",
  "reported", "reportedly", "estimated", "estimate", "suggest", "suggests", "seem", "seems", "appear",
  "appears", "some", "many", "few", "occasionally", "often", "sometimes", "typically", "generally",
  "roughly", "nearly", "up", "to",
]);

function canonicalToken(token: string): string {
  if (!/[a-z]/.test(token)) return token;
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function factualTokens(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter(Boolean)
    .map(canonicalToken);
}

function isContiguousSequence(needle: string[], haystack: string[]): boolean {
  if (needle.length === 0) return true;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((token, offset) => token === haystack[start + offset])) return true;
  }
  return false;
}

function preservesCriticalQualifiers(replacement: string, grounding: string): boolean {
  const used = new Set(factualTokens(replacement));
  return factualTokens(grounding)
    .filter((token) => CRITICAL_QUALIFIERS.has(token))
    .every((token) => used.has(token));
}

function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/[.!?]+(?:\s+|$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function groundingSegments(text: string): string[] {
  const punctuationSegments: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (!".!?;,".includes(char)) continue;
    if ((char === "." || char === ",") && /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? "")) continue;
    const segment = text.slice(start, index).trim();
    if (segment) punctuationSegments.push(segment);
    start = index + 1;
  }
  const tail = text.slice(start).trim();
  if (tail) punctuationSegments.push(tail);
  return punctuationSegments
    .flatMap((segment) => segment.split(/\b(?:and|but|while|whereas|although|however)\b/gi))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function matchesGrounding(replacement: string, grounding: string): boolean {
  const sequence = factualTokens(replacement);
  return sequence.length > 0 && groundingSegments(grounding).some((segment) =>
    isContiguousSequence(sequence, factualTokens(segment)) && preservesCriticalQualifiers(replacement, segment));
}

function matchesCompleteGrounding(replacement: string, grounding: string): boolean {
  const left = factualTokens(replacement);
  const right = factualTokens(grounding);
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

const NUMERIC_ATOM = /(?:[+\-]?[$€£¥]?|[$€£¥][+\-]?)(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+\-]?\d+)?(?:\s*(?:%|percent(?:age)?|thousand|million|billion|trillion|years?|months?|weeks?|days?|hours?|minutes?|seconds?|ms|kg|km|cm|mm|g|lbs?|mph|kph|usd|eur|gbp|[kmbt]))?/giu;

function numericAtoms(text: string): string[] {
  const compact = text.normalize("NFKC")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/([+\-])\s+(?=(?:[$€£¥]\s*)?\d)/gu, "$1")
    .replace(/([$€£¥])\s+(?=[+\-−]?\s*\d)/gu, "$1")
    .replace(/([$€£¥][+\-−])\s+(?=\d)/gu, "$1");
  return [...compact.matchAll(NUMERIC_ATOM)].map((match) => {
    const index = match.index;
    const before = compact.slice(0, index);
    const after = compact.slice(index + match[0].length);
    const parenthesized = /\(\s*$/.test(before) && /^\s*\)/.test(after);
    const atom = match[0].replace(/[\s,]/g, "").toLocaleLowerCase("en-US");
    return parenthesized ? `(${atom})` : atom;
  });
}

function numericAtomValue(atom: string): number | null {
  const match = atom.replace(/[$€£¥]/g, "").match(/[+\-]?\d+(?:\.\d+)?(?:e[+\-]?\d+)?/i)?.[0];
  if (!match) return null;
  const value = Number(match);
  return Number.isFinite(value) ? value : null;
}

function isDisprovenResultAtom(atom: string, numeric: NumericCheck | null | undefined): boolean {
  if (!numeric || numeric.claimedResult === null || numeric.computedResult === null) return false;
  const value = numericAtomValue(atom);
  if (value === null || Math.abs(value) !== Math.abs(numeric.claimedResult) || Math.abs(numeric.claimedResult) === Math.abs(numeric.computedResult)) return false;
  if (numeric.kind === "percent_change" || numeric.kind === "market_share") return /%|percent/.test(atom);
  if (numeric.kind === "date_interval") return /year|month|week|day/.test(atom);
  return !Object.values(numeric.inputs).some((input) => Math.abs(input) === Math.abs(value));
}

function shown(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
}

function verifiedNumeric(numeric: NumericCheck | null | undefined, claimId: string): ReturnType<typeof computeNumeric> | null {
  if (!numeric || numeric.claimId !== claimId || !numeric.grounded || numeric.matches !== false || numeric.computedResult === null || !Number.isFinite(numeric.computedResult)) return null;
  const recomputed = computeNumeric({ kind: numeric.kind, inputs: numeric.inputs, claimedResult: numeric.claimedResult, explanation: numeric.explanation });
  if (recomputed.computedResult !== numeric.computedResult || recomputed.computedResult === null) return null;
  return recomputed;
}

function numericSummary(numeric: NumericCheck | null | undefined, claimId: string): string | null {
  const verified = verifiedNumeric(numeric, claimId);
  if (!verified || !numeric) return null;
  const result = shown(verified.computedResult!);
  const label = numeric.kind.replaceAll("_", " ");
  const resultWithUnit = numeric.kind === "percent_change" || numeric.kind === "market_share" ? `${result}%` : result;
  return `The verified ${label} is ${resultWithUnit}.`;
}

function numericGrounding(numeric: NumericCheck | null | undefined, claimId: string): string | null {
  const summary = numericSummary(numeric, claimId);
  const verified = verifiedNumeric(numeric, claimId);
  if (!summary || !verified) return null;
  return `${summary} ${verified.expression}.`;
}

function uniqueValidatedEvidence(claimId: string, evidence: Evidence[]): Evidence[] {
  const counts = new Map<string, number>();
  for (const item of evidence) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  return evidence.filter((item) => counts.get(item.id) === 1 && item.claimId === claimId && isCitationValidatedEvidence(item));
}

export interface ValidateRevisionInput {
  claimId: string;
  original: string;
  replacement: string;
  verdictKind: VerdictKind;
  citationIds: string[];
  evidence: Evidence[];
  numeric?: NumericCheck | null;
}

export function validateRevision(input: ValidateRevisionInput): { ok: boolean; reason: string; citations: string[]; numericGroundingUsed?: boolean } {
  const citations = [...input.citationIds];
  if (new Set(citations).size !== citations.length) {
    return { ok: false, reason: "duplicate citation id", citations: [] };
  }

  const evidenceById = new Map(uniqueValidatedEvidence(input.claimId, input.evidence).map((item) => [item.id, item]));
  const unknown = citations.find((id) => !evidenceById.has(id));
  if (unknown) return { ok: false, reason: `unknown or ineligible citation ${unknown}`, citations: [] };

  const numericText = numericGrounding(input.numeric, input.claimId);
  const numericSourceIds = input.numeric?.sourceEvidenceIds ?? [];
  const numericSourcesCited = numericSourceIds.every((id) => citations.includes(id) && evidenceById.has(id));
  const usableNumericText = numericText && numericSourcesCited ? numericText : null;

  if (citations.length === 0 && !usableNumericText) {
    return { ok: false, reason: "at least one eligible citation is required", citations };
  }
  if (input.replacement.trim() === "") return { ok: false, reason: "empty replacement", citations };
  if (PLACEHOLDER.test(input.replacement)) return { ok: false, reason: "editorial placeholder is not finished prose", citations };

  const sentences = splitSentences(input.replacement);
  if (sentences.length === 0 || sentences.length > 2) return { ok: false, reason: "replacement must contain one or two sentences", citations };

  const originalNormalized = normalizeText(input.original);
  const replacementNormalized = normalizeText(input.replacement);
  if (replacementNormalized === originalNormalized) return { ok: false, reason: "replacement leaves the claim unchanged", citations };
  if (input.verdictKind === "contradicted" && replacementNormalized.includes(originalNormalized)) {
    return { ok: false, reason: "replacement restates the contradicted claim", citations };
  }

  const groundingTexts = citations.map((id) => evidenceById.get(id)!.excerpt);
  if (usableNumericText) groundingTexts.push(usableNumericText);
  const allowedNumericAtoms = new Set(groundingTexts.flatMap(numericAtoms));
  for (const atom of numericAtoms(input.replacement)) {
    if (usableNumericText && isDisprovenResultAtom(atom, input.numeric)) {
      return { ok: false, reason: `disproven numeric result ${atom} cannot remain in the correction`, citations };
    }
    if (!allowedNumericAtoms.has(atom)) {
      return { ok: false, reason: `unsupported number, sign, currency, or unit ${atom}`, citations };
    }
  }

  const matchedEvidenceIds = new Set<string>();
  let numericGroundingUsed = false;
  for (const sentence of sentences) {
    let sentenceGrounded = false;
    for (const id of citations) {
      const cited = evidenceById.get(id)!;
      if (!matchesGrounding(sentence, cited.excerpt)) continue;
      if (cited.citationAssessment!.qualifiersOmitted && !matchesCompleteGrounding(sentence, cited.excerpt)) continue;
      matchedEvidenceIds.add(id);
      sentenceGrounded = true;
    }
    if (usableNumericText && matchesGrounding(sentence, usableNumericText)) {
      numericGroundingUsed = true;
      sentenceGrounded = true;
    }
    if (!sentenceGrounded) {
      return { ok: false, reason: "factual tokens are unsupported or occur in a different order than the cited grounding", citations };
    }
  }

  const numericEvidenceIdsUsed = numericGroundingUsed ? new Set(numericSourceIds) : new Set<string>();
  const unusedCitation = citations.find((id) => !matchedEvidenceIds.has(id) && !numericEvidenceIdsUsed.has(id));
  if (unusedCitation) {
    return { ok: false, reason: `unused citation ${unusedCitation} did not ground the replacement prose`, citations: [] };
  }

  const matchedEvidence = [...matchedEvidenceIds].map((id) => evidenceById.get(id)!);
  if (input.verdictKind === "contradicted" && !usableNumericText && !matchedEvidence.some((item) => item.stance === "contradicts")) {
    return { ok: false, reason: "a contradicted revision must use contradictory evidence or a grounded numeric correction", citations };
  }
  if (input.verdictKind === "outdated" && !matchedEvidence.some((item) => item.stance === "contradicts")) {
    return { ok: false, reason: "an outdated revision must use newer contradictory evidence", citations };
  }
  const completeQualification = matchedEvidence.some((item) => item.stance === "qualifies"
    && sentences.some((sentence) => matchesCompleteGrounding(sentence, item.excerpt)));
  if (input.verdictKind === "supported_with_qualifications" && !completeQualification) {
    return { ok: false, reason: "a qualified revision must use qualifying evidence", citations };
  }
  if (input.verdictKind === "disputed") {
    const hasSupport = matchedEvidence.some((item) => item.stance === "supports");
    const hasContradiction = matchedEvidence.some((item) => item.stance === "contradicts");
    if (!hasSupport || !hasContradiction) return { ok: false, reason: "a disputed revision must present both evidence sides", citations };
  }

  return { ok: true, reason: "", citations, numericGroundingUsed };
}

const PROMPT = `You are the Revision Agent for Saga. Replace one audited sentence with finished, accurate prose grounded only in the supplied evidence and deterministic numeric trace.
Return one or two concise sentences. Cite every evidence excerpt used. Reuse the factual wording and order of the cited excerpts. Preserve negations, limits, and qualifiers. Do not add facts, numbers, signs, units, or editorial placeholders. If a deterministic numeric trace is supplied, you may state its verified computed result.`;

function polishedExcerpt(excerpt: string): string | null {
  if (PLACEHOLDER.test(excerpt) || groundingSegments(excerpt).length !== 1) return null;
  let text = excerpt.replace(/\s+/g, " ").trim().replace(/[,;:]$/, "");
  const firstWord = text.match(/^[a-z]+\b/)?.[0];
  if (firstWord && firstWord === firstWord.toLocaleLowerCase("en-US")) text = `${text[0]!.toLocaleUpperCase("en-US")}${text.slice(1)}`;
  if (!/[.!?]["')\]]?$/.test(text)) text += ".";
  return text;
}

function eligibleEvidence(claim: Claim, verdict: Verdict, evidence: Evidence[], numeric?: NumericCheck | null): Evidence[] {
  if (verdict.claimId !== claim.id) return [];
  const allowedIds = new Set([...verdict.supporting, ...verdict.contradicting]);
  if (verdict.verdict === "supported_with_qualifications") {
    for (const item of evidence) if (item.stance === "qualifies") allowedIds.add(item.id);
  }
  if (numeric?.claimId === claim.id && numeric.grounded) {
    for (const id of numeric.sourceEvidenceIds) allowedIds.add(id);
  }
  return uniqueValidatedEvidence(claim.id, evidence).filter((item) => allowedIds.has(item.id));
}

function evidenceRank(verdict: VerdictKind, evidence: Evidence): number {
  const strength = evidence.relevance === "strong" ? 0 : 1;
  if (verdict === "contradicted" || verdict === "outdated") {
    return (evidence.stance === "contradicts" ? 0 : evidence.stance === "qualifies" ? 2 : 4) + strength;
  }
  if (verdict === "supported_with_qualifications") {
    return (evidence.stance === "qualifies" ? 0 : evidence.stance === "supports" ? 2 : 4) + strength;
  }
  return (evidence.stance === "supports" ? 0 : evidence.stance === "contradicts" ? 2 : 4) + strength;
}

function deterministicRevision(claim: Claim, verdict: Verdict, evidence: Evidence[], numeric?: NumericCheck | null): DraftChange {
  const ranked = [...evidence].sort((a, b) => evidenceRank(verdict.verdict, a) - evidenceRank(verdict.verdict, b) || a.id.localeCompare(b.id));
  const numericReplacement = numericSummary(numeric, claim.id);
  const numericSourceIds = numeric?.sourceEvidenceIds ?? [];
  const numericSourcesAvailable = numericSourceIds.every((id) => ranked.some((item) => item.id === id));
  const pick = (stance: Evidence["stance"]): { evidence: Evidence; text: string } | null => {
    for (const item of ranked) {
      if (item.stance !== stance) continue;
      const text = polishedExcerpt(item.excerpt);
      if (text) return { evidence: item, text };
    }
    return null;
  };
  const support = pick("supports");
  const contradiction = pick("contradicts");
  const qualification = pick("qualifies");

  let replacement = "";
  let citations: string[] = [];
  let numericCheckClaimId: string | undefined;
  if (verdict.claimId === claim.id && verdict.verdict === "disputed" && support && contradiction) {
    replacement = `${support.text} ${contradiction.text}`;
    citations = [support.evidence.id, contradiction.evidence.id];
  } else if (verdict.claimId === claim.id && verdict.verdict === "supported_with_qualifications" && qualification) {
    replacement = qualification.text;
    citations = [qualification.evidence.id];
  } else if (verdict.claimId === claim.id && verdict.verdict === "outdated" && contradiction) {
    replacement = contradiction.text;
    citations = [contradiction.evidence.id];
  } else if (verdict.claimId === claim.id && verdict.verdict === "contradicted" && contradiction) {
    replacement = contradiction.text;
    citations = [contradiction.evidence.id];
  } else if (verdict.claimId === claim.id && verdict.verdict === "contradicted" && numericReplacement && numericSourcesAvailable) {
    replacement = numericReplacement;
    citations = [...numericSourceIds];
  }

  if (replacement) {
    const validation = validateRevision({ claimId: claim.id, original: claim.originalText, replacement, verdictKind: verdict.verdict, citationIds: citations, evidence, numeric });
    if (!validation.ok) {
      replacement = "";
      citations = [];
    } else if (validation.numericGroundingUsed) {
      numericCheckClaimId = numeric?.claimId;
    }
  }
  return {
    claimId: claim.id,
    kind: changeKind(verdict.verdict),
    original: claim.originalText,
    replacement,
    note: verdict.requiredCorrection ?? "The claim requires revision.",
    citations,
    source: "deterministic_revision",
    ...(numericCheckClaimId ? { numericCheckClaimId } : {}),
  };
}

export async function reviseChange(input: { claim: Claim; verdict: Verdict; evidence: Evidence[]; numeric?: NumericCheck | null; model: ModelProvider }): Promise<DraftChange | null> {
  const { claim, verdict, model } = input;
  if (verdict.requiredCorrection === null) return null;

  const numeric = input.numeric ?? null;
  const evidence = eligibleEvidence(claim, verdict, input.evidence, numeric);
  const fallback = (): DraftChange => deterministicRevision(claim, verdict, evidence, numeric);
  if (verdict.claimId !== claim.id || verdict.verdict === "failed" || verdict.verdict === "insufficient_evidence") return fallback();

  const numericText = numericGrounding(numeric, claim.id);
  try {
    const revision = await model.generateStructured({
      purpose: "revision",
      system: PROMPT,
      prompt: `Original sentence: "${claim.originalText}"\nVerdict: ${verdict.verdict}\nRequired correction: ${verdict.requiredCorrection}\nEligible evidence:\n${evidence.map((item) => `- [${item.id}] ${item.excerpt}`).join("\n") || "(none)"}\nGrounded numeric trace:\n${numericText ?? "(none)"}`,
      schema: RevisionSchema,
    });
    const validation = validateRevision({
      claimId: claim.id,
      original: claim.originalText,
      replacement: revision.replacement,
      verdictKind: verdict.verdict,
      citationIds: revision.citationEvidenceIds,
      evidence,
      numeric,
    });
    if (!validation.ok) return fallback();

    return {
      claimId: claim.id,
      kind: changeKind(verdict.verdict),
      original: claim.originalText,
      replacement: revision.replacement,
      note: verdict.requiredCorrection,
      citations: validation.citations,
      source: "revision_agent",
      ...(validation.numericGroundingUsed ? { numericCheckClaimId: numeric?.claimId } : {}),
    };
  } catch {
    return fallback();
  }
}
