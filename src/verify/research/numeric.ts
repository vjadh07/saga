// Deterministic numerical verification. The model may identify candidate values and the
// relationship between them, but conventional code does every calculation and comparison.
// This catches the classic error where prose asserts one figure ("a 40% increase") while
// the underlying numbers imply another (25%).
import { z } from "zod";
import { isCitationValidatedEvidence } from "./citation.js";
import type { Claim, Evidence, NumericCheck, NumericKind } from "../types.js";
import type { ModelProvider } from "../providers/model.js";

export const NumericRelationSchema = z.object({
  kind: z.enum(["percent_change", "ratio", "total", "average", "unit_conversion", "market_share", "date_interval", "none"]),
  inputs: z.record(z.string(), z.number()),
  claimedResult: z.number().nullable(),
  explanation: z.string(),
});
export type NumericRelation = z.infer<typeof NumericRelationSchema>;

export interface NumericComputation {
  kind: NumericKind;
  expression: string;
  inputs: Record<string, number>;
  computedResult: number | null;
  claimedResult: number | null;
  matches: boolean | null;
  explanation: string;
}

function round(n: number): number {
  return Number(n.toPrecision(12));
}

function approxEqual(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(1e-9, scale * 0.02);
}

function stableValues(inputs: Record<string, number>): Array<[string, number]> {
  return Object.entries(inputs).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

function stableSum(values: number[]): number {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = sum + adjusted;
    correction = next - sum - adjusted;
    sum = next;
  }
  return sum;
}

function shown(n: number): string {
  return Number.isInteger(n) ? String(n) : String(round(n));
}

// Pure calculator: given an extracted relation, do the arithmetic. Missing inputs or a
// division by zero yield null rather than a wrong number.
export function computeNumeric(relation: NumericRelation): NumericComputation {
  const { kind, inputs, claimedResult, explanation } = relation;
  const has = (...keys: string[]) => keys.every((k) => typeof inputs[k] === "number" && Number.isFinite(inputs[k]));

  let exactResult: number | null = null;
  let computedResult: number | null = null;
  let expression = "";

  switch (kind) {
    case "percent_change":
      if (has("from", "to") && inputs.from !== 0) {
        exactResult = ((inputs.to! - inputs.from!) / inputs.from!) * 100;
        expression = `(${shown(inputs.to!)} - ${shown(inputs.from!)}) / ${shown(inputs.from!)} * 100`;
      }
      break;
    case "ratio":
      if (has("numerator", "denominator") && inputs.denominator !== 0) {
        exactResult = inputs.numerator! / inputs.denominator!;
        expression = `${shown(inputs.numerator!)} / ${shown(inputs.denominator!)}`;
      }
      break;
    case "market_share":
      if (has("part", "whole") && inputs.whole !== 0) {
        exactResult = (inputs.part! / inputs.whole!) * 100;
        expression = `${shown(inputs.part!)} / ${shown(inputs.whole!)} * 100`;
      }
      break;
    case "average": {
      const vals = stableValues(inputs).map(([, value]) => value);
      if (vals.length > 0 && vals.every(Number.isFinite)) {
        exactResult = stableSum(vals) / vals.length;
        expression = `(${vals.map(shown).join(" + ")}) / ${vals.length}`;
      }
      break;
    }
    case "total": {
      const vals = stableValues(inputs).map(([, value]) => value);
      if (vals.length > 0 && vals.every(Number.isFinite)) {
        exactResult = stableSum(vals);
        expression = vals.map(shown).join(" + ");
      }
      break;
    }
    case "unit_conversion":
      if (has("value", "factor")) {
        exactResult = inputs.value! * inputs.factor!;
        expression = `${shown(inputs.value!)} * ${shown(inputs.factor!)}`;
      }
      break;
    case "date_interval":
      if (has("start", "end")) {
        exactResult = inputs.end! - inputs.start!;
        expression = `${shown(inputs.end!)} - ${shown(inputs.start!)}`;
      }
      break;
    case "none":
    default:
      break;
  }

  if (exactResult !== null && Number.isFinite(exactResult)) {
    computedResult = round(exactResult);
    expression = `${expression} = ${shown(computedResult)}`;
  } else if (exactResult !== null) {
    exactResult = null;
    expression = "";
  }
  const matches = exactResult === null || claimedResult === null
    ? null
    : (kind === "percent_change" || kind === "date_interval") && claimedResult >= 0
      ? approxEqual(Math.abs(exactResult), claimedResult)
      : approxEqual(exactResult, claimedResult);

  return { kind, expression, inputs, computedResult, claimedResult, matches, explanation };
}

const PROMPT = `You are the Numeric analyst for Saga. If the claim asserts a numeric relationship, identify the underlying values and the relationship kind so conventional code can recompute it. Do not do the arithmetic yourself.
kind is one of: percent_change (inputs from, to), ratio (numerator, denominator), total (the addends), average (the values), unit_conversion (value, factor), market_share (part, whole), date_interval (start, end), or none if there is no checkable numeric relationship.
claimedResult is the number the claim asserts as the result (e.g. 40 for "a 40% increase"), or null.
inputs is an object of named numbers. Copy values exactly from the claim or the validated evidence. Never infer or estimate a missing value.
Preserve semantic roles exactly: from and to are the explicit nearest "from ... to ..." operands; numerator comes before denominator; part comes before whole. Include every explicit operand for a total or average. Use unit_conversion only for a complete two-operand multiplication equation. If the text does not explicitly establish the relationship and result, return none.`;

function usedInputKeys(kind: NumericKind, inputs: Record<string, number>): string[] {
  switch (kind) {
    case "percent_change": return ["from", "to"];
    case "ratio": return ["numerator", "denominator"];
    case "market_share": return ["part", "whole"];
    case "unit_conversion": return ["value", "factor"];
    case "date_interval": return ["start", "end"];
    case "average":
    case "total": return Object.keys(inputs).sort();
    case "none": return [];
  }
}

function textNumbers(text: string): number[] {
  const matches = text.match(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? [];
  return matches.map((token) => Number(token.replace(/,/g, ""))).filter(Number.isFinite);
}

function textHasNumber(text: string, value: number): boolean {
  return textNumbers(text).some((candidate) => candidate === value);
}

function sentenceSegments(text: string): string[] {
  const segments: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char !== "." && char !== "!" && char !== "?" && char !== ";") continue;
    if (char === "." && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "")) continue;
    const segment = text.slice(start, i).trim();
    if (segment) segments.push(segment);
    start = i + 1;
  }
  const tail = text.slice(start).trim();
  if (tail) segments.push(tail);
  return segments;
}

function hasFromTo(text: string, from: number, to: number): boolean {
  for (const segment of sentenceSegments(text)) {
    for (const match of segment.matchAll(/\bfrom\b(.{0,80}?)\bto\b(.{0,80})/gi)) {
      const beforeTo = textNumbers(match[1] ?? "");
      const afterTo = textNumbers(match[2] ?? "");
      if (beforeTo.at(-1) === from && afterTo[0] === to) return true;
    }
  }
  return false;
}

interface NumberSpan {
  value: number;
  start: number;
  end: number;
}

function numberSpans(text: string): NumberSpan[] {
  const pattern = /[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?/g;
  return [...text.matchAll(pattern)]
    .map((match) => ({ value: Number(match[0].replace(/,/g, "")), start: match.index, end: match.index + match[0].length }))
    .filter((span) => Number.isFinite(span.value));
}

function hasOrderedPair(text: string, first: number, second: number, separator: RegExp): boolean {
  const spans = numberSpans(text);
  for (let i = 0; i + 1 < spans.length; i++) {
    const left = spans[i]!;
    const right = spans[i + 1]!;
    if (left.value !== first || right.value !== second) continue;
    if (separator.test(text.slice(left.end, right.start))) return true;
  }
  return false;
}

function sameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((value, index) => value === right[index]);
}

function aggregateRolesVerified(kind: "average" | "total", inputs: Record<string, number>, claimedResult: number | null, text: string): boolean {
  if (claimedResult === null) return false;
  const operandValues = Object.values(inputs);
  const label = kind === "average" ? "average|mean" : "total|sum";
  for (const segment of sentenceSegments(text)) {
    const wordPattern = new RegExp(`\\b(?:${label})\\s+of\\b(.{1,120}?)\\b(?:is|was|equals?)\\b(.{0,40})`, "gi");
    for (const match of segment.matchAll(wordPattern)) {
      if (sameNumbers(textNumbers(match[1] ?? ""), operandValues) && textHasNumber(match[2] ?? "", claimedResult)) return true;
    }
    const equalsPattern = new RegExp(`\\b(?:${label})\\s+of\\b([^=]{1,120})=(.{0,40})`, "gi");
    for (const match of segment.matchAll(equalsPattern)) {
      if (sameNumbers(textNumbers(match[1] ?? ""), operandValues) && textHasNumber(match[2] ?? "", claimedResult)) return true;
    }
    if (kind === "total") {
      for (const match of segment.matchAll(/(.{1,120})=(.{0,40})/g)) {
        const operands = match[1] ?? "";
        if (operands.includes("+") && sameNumbers(textNumbers(operands), operandValues) && textHasNumber(match[2] ?? "", claimedResult)) return true;
      }
    }
  }
  return false;
}

function conversionRolesVerified(inputs: Record<string, number>, claimedResult: number | null, text: string): boolean {
  if (claimedResult === null || typeof inputs.value !== "number" || typeof inputs.factor !== "number") return false;
  for (const segment of sentenceSegments(text)) {
    for (const equals of segment.matchAll(/=|\bequals?\b/gi)) {
      const before = segment.slice(0, equals.index);
      const after = segment.slice(equals.index + equals[0].length);
      const beforeSpans = numberSpans(before);
      const result = numberSpans(after)[0];
      if (beforeSpans.length === 0 || result?.value !== claimedResult) continue;

      const chain: NumberSpan[] = [beforeSpans.at(-1)!];
      for (let i = beforeSpans.length - 2; i >= 0; i--) {
        const left = beforeSpans[i]!;
        const right = chain[0]!;
        if (!/\*|×|\bmultiplied\s+by\b/i.test(before.slice(left.end, right.start))) break;
        chain.unshift(left);
      }
      if (chain.length === 2 && sameNumbers(chain.map((span) => span.value), [inputs.value, inputs.factor])) return true;
    }
  }
  return false;
}

function numberHasTimeContext(text: string, value: number): boolean {
  return numberSpans(text).some((span) => {
    if (span.value !== value) return false;
    const before = text.slice(Math.max(0, span.start - 16), span.start);
    const after = text.slice(span.end, span.end + 16);
    return /\b(?:year|month|week|day)s?\s*$/i.test(before) || /^\s*(?:year|month|week|day)s?\b/i.test(after);
  });
}

const QUANTITY_PREFIX = /(?:[$€£¥]|(?:usd|eur|gbp|jpy|cad|aud|cny|inr)\s*)$/i;
const QUANTITY_SUFFIX = /^\s*(?:%|[$€£¥]|(?:usd|eur|gbp|jpy|cad|aud|cny|inr|dollars?|euros?|pounds?|yen|yuan|rupees?|thousand|million|billion|trillion|[kmbt]|mm|cm|km|meters?|metres?|inches?|feet|foot|yards?|miles?|mg|kg|grams?|lbs?|ounces?|liters?|litres?|ml|gallons?|mph|kph|watts?|kw|mw|gw|volts?|units?)\b)/i;

function numberHasQuantityContext(text: string, value: number): boolean {
  return numberSpans(text).some((span) => {
    if (span.value !== value) return false;
    const before = text.slice(Math.max(0, span.start - 24), span.start);
    const after = text.slice(span.end, span.end + 24);
    return QUANTITY_PREFIX.test(before) || QUANTITY_SUFFIX.test(after);
  });
}

function dateOperandsVerified(text: string, start: number, end: number): boolean {
  if (!hasFromTo(text, start, end)) return false;
  if (numberHasQuantityContext(text, start) || numberHasQuantityContext(text, end)) return false;
  const plausibleYears = Number.isInteger(start) && Number.isInteger(end) && start >= 1000 && start <= 9999 && end >= 1000 && end <= 9999;
  return plausibleYears || (numberHasTimeContext(text, start) && numberHasTimeContext(text, end));
}

function rolesVerified(kind: NumericKind, inputs: Record<string, number>, claimedResult: number | null, text: string): boolean {
  switch (kind) {
    case "percent_change":
      return typeof inputs.from === "number" && typeof inputs.to === "number" && hasFromTo(text, inputs.from, inputs.to);
    case "date_interval":
      return typeof inputs.start === "number" && typeof inputs.end === "number" && dateOperandsVerified(text, inputs.start, inputs.end);
    case "ratio":
      return typeof inputs.numerator === "number" && typeof inputs.denominator === "number"
        && sentenceSegments(text).some((segment) => hasOrderedPair(segment, inputs.numerator!, inputs.denominator!, /[:/]|\bto\b|\bout of\b/i));
    case "market_share":
      return typeof inputs.part === "number" && typeof inputs.whole === "number"
        && sentenceSegments(text).some((segment) => hasOrderedPair(segment, inputs.part!, inputs.whole!, /[/]|\bout of\b|\bof\b/i));
    case "average":
    case "total":
      return aggregateRolesVerified(kind, inputs, claimedResult, text);
    case "unit_conversion":
      return conversionRolesVerified(inputs, claimedResult, text);
    default:
      return true;
  }
}

function needsRoleCheck(kind: NumericKind): boolean {
  return kind === "percent_change" || kind === "date_interval" || kind === "ratio" || kind === "market_share" || kind === "average" || kind === "total" || kind === "unit_conversion";
}

function kindVerified(kind: NumericKind, texts: string[]): boolean {
  const text = texts.join("\n");
  switch (kind) {
    case "percent_change":
      return /%|\b(percent|percentage|increase|increased|rose|rise|grew|growth|decrease|decreased|fell|fall|decline|declined|drop|dropped|change|changed)\b/i.test(text);
    case "ratio":
      return /\bratio\b|[:/]|\bout of\b/i.test(text);
    case "market_share":
      return /%|\b(percent|percentage|share|portion|market)\b/i.test(text);
    case "average":
      return /\b(average|mean)\b/i.test(text);
    case "total":
      return /\b(total|sum|combined|altogether|in all)\b|\+/i.test(text);
    case "unit_conversion":
      return /\b(convert|converted|conversion|equivalent|equals|equal to|factor)\b|=/i.test(text);
    case "date_interval":
      return /\b(year|years|month|months|week|weeks|day|days|date|duration|elapsed|interval)\b/i.test(text);
    case "none":
      return true;
  }
}

function percentDirection(text: string): "increase" | "decrease" | "unknown" {
  const increase = /\b(increase|increased|increasing|rose|rise|rising|grew|grown|growth|gain|gained|up)\b/i.test(text);
  const decrease = /\b(decrease|decreased|decreasing|fell|fall|falling|decline|declined|drop|dropped|down|reduction|reduced)\b/i.test(text);
  if (increase === decrease) return "unknown";
  return increase ? "increase" : "decrease";
}

function numberHasSuffix(text: string, value: number, suffix: RegExp): boolean {
  return numberSpans(text).some((span) => span.value === value && suffix.test(text.slice(span.end, span.end + 32)));
}

function numberHasResultPrefix(text: string, value: number): boolean {
  return numberSpans(text).some((span) => {
    if (span.value !== value) return false;
    return /(?:\bis\b|\bwas\b|\bequals?\b|=)\s*$/i.test(text.slice(Math.max(0, span.start - 32), span.start));
  });
}

function resultRoleVerified(kind: NumericKind, claimedResult: number | null, text: string): boolean {
  if (claimedResult === null) return true;
  switch (kind) {
    case "percent_change":
    case "market_share":
      return numberHasSuffix(text, claimedResult, /^\s*(?:%|percent(?:age)?\b)/i);
    case "date_interval":
      return numberHasSuffix(text, claimedResult, /^\s*-?\s*(?:year|month|week|day)s?\b/i);
    case "ratio":
      return numberHasResultPrefix(text, claimedResult);
    case "average":
    case "total":
    case "unit_conversion":
      return true; // their role checks validate the result and operands together
    case "none":
      return true;
  }
}

export async function verifyNumericClaim(input: { claim: Claim; evidence: Evidence[]; model: ModelProvider }): Promise<NumericCheck | null> {
  const validatedEvidence = input.evidence.filter((e) => e.claimId === input.claim.id && isCitationValidatedEvidence(e));
  const relation = await input.model.generateStructured({
    purpose: "numeric_extract",
    system: PROMPT,
    prompt: `Claim: "${input.claim.originalText}"\n\nValidated evidence:\n${validatedEvidence.map((e) => `- [${e.id}] ${e.excerpt}`).join("\n") || "(none)"}`,
    schema: NumericRelationSchema,
  });
  if (relation.kind === "none") return null;

  const c = computeNumeric(relation);
  const issues: string[] = [];
  const sourceEvidenceIds = new Set<string>();
  const usedKeys = usedInputKeys(relation.kind, relation.inputs);
  const groundingTexts = [input.claim.originalText, ...validatedEvidence.map((e) => e.excerpt)];

  if (usedKeys.length === 0) issues.push(`no inputs were supplied for ${relation.kind}`);
  if (!kindVerified(relation.kind, groundingTexts)) {
    issues.push(`the ${relation.kind} relationship was not verified in the claim or validated evidence`);
  }
  for (const key of usedKeys) {
    const value = relation.inputs[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(`required input ${key} is missing or non-finite`);
      continue;
    }
    if (textHasNumber(input.claim.originalText, value)) continue;
    const matching = validatedEvidence.filter((e) => textHasNumber(e.excerpt, value));
    if (matching.length === 0) {
      issues.push(`input ${key}=${shown(value)} was not found in the claim or validated evidence`);
      continue;
    }
    for (const e of matching) sourceEvidenceIds.add(e.id);
  }
  if (needsRoleCheck(relation.kind)) {
    const roleEvidence = validatedEvidence.filter((e) => rolesVerified(relation.kind, relation.inputs, relation.claimedResult, e.excerpt));
    const rolesInClaim = rolesVerified(relation.kind, relation.inputs, relation.claimedResult, input.claim.originalText);
    if (!rolesInClaim && roleEvidence.length === 0) {
      const labels = relation.kind === "percent_change" || relation.kind === "date_interval" ? "from and to" : "numeric";
      issues.push(`the ${labels} roles were not verified in the claim or validated evidence`);
    }
    for (const e of roleEvidence) sourceEvidenceIds.add(e.id);
  }
  if (relation.claimedResult !== null && !textHasNumber(input.claim.originalText, relation.claimedResult)) {
    issues.push(`claimed result ${shown(relation.claimedResult)} was not found in the claim`);
  } else if (!resultRoleVerified(relation.kind, relation.claimedResult, input.claim.originalText)) {
    const label = relation.kind === "percent_change" ? "percent" : relation.kind;
    issues.push(`claimed result ${shown(relation.claimedResult!)} was not verified as the asserted ${label} result`);
  }
  if (c.computedResult === null) issues.push("the calculation could not produce a finite result");

  const grounded = issues.length === 0;
  let matches = grounded ? c.matches : null;
  if (grounded && relation.kind === "percent_change" && c.computedResult !== null && relation.claimedResult !== null) {
    const direction = percentDirection(input.claim.originalText);
    if (direction === "increase" && c.computedResult < 0) matches = false;
    if (direction === "decrease" && c.computedResult > 0) matches = false;
  }
  return {
    claimId: input.claim.id,
    kind: c.kind,
    expression: c.expression,
    inputs: c.inputs,
    computedResult: c.computedResult,
    claimedResult: c.claimedResult,
    matches,
    explanation: c.explanation,
    grounded,
    groundingIssues: issues,
    sourceEvidenceIds: [...sourceEvidenceIds].sort(),
  };
}
