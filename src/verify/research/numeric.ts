// Deterministic numerical verification. The model may identify candidate values and the
// relationship between them, but conventional code does every calculation and comparison.
// This catches the classic error where prose asserts one figure ("a 40% increase") while
// the underlying numbers imply another (25%).
import { z } from "zod";
import type { Claim, NumericCheck, NumericKind } from "../types.js";
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
  return Math.round(n * 1e6) / 1e6;
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.02);
}

// Pure calculator: given an extracted relation, do the arithmetic. Missing inputs or a
// division by zero yield null rather than a wrong number.
export function computeNumeric(relation: NumericRelation): NumericComputation {
  const { kind, inputs, claimedResult, explanation } = relation;
  const has = (...keys: string[]) => keys.every((k) => typeof inputs[k] === "number");

  let computedResult: number | null = null;
  let expression = "";

  switch (kind) {
    case "percent_change":
      if (has("from", "to") && inputs.from !== 0) {
        expression = "(to - from) / from * 100";
        computedResult = round(((inputs.to! - inputs.from!) / inputs.from!) * 100);
      }
      break;
    case "ratio":
      if (has("numerator", "denominator") && inputs.denominator !== 0) {
        expression = "numerator / denominator";
        computedResult = round(inputs.numerator! / inputs.denominator!);
      }
      break;
    case "market_share":
      if (has("part", "whole") && inputs.whole !== 0) {
        expression = "part / whole * 100";
        computedResult = round((inputs.part! / inputs.whole!) * 100);
      }
      break;
    case "average": {
      const vals = Object.values(inputs);
      if (vals.length > 0) {
        expression = "sum(values) / count(values)";
        computedResult = round(vals.reduce((a, b) => a + b, 0) / vals.length);
      }
      break;
    }
    case "total": {
      const vals = Object.values(inputs);
      if (vals.length > 0) {
        expression = "sum(values)";
        computedResult = round(vals.reduce((a, b) => a + b, 0));
      }
      break;
    }
    case "unit_conversion":
      if (has("value", "factor")) {
        expression = "value * factor";
        computedResult = round(inputs.value! * inputs.factor!);
      }
      break;
    case "date_interval":
      if (has("start", "end")) {
        expression = "end - start";
        computedResult = round(inputs.end! - inputs.start!);
      }
      break;
    case "none":
    default:
      break;
  }

  const matches = computedResult === null || claimedResult === null ? null : approxEqual(computedResult, claimedResult);

  return { kind, expression, inputs, computedResult, claimedResult, matches, explanation };
}

const PROMPT = `You are the Numeric analyst for Saga. If the claim asserts a numeric relationship, identify the underlying values and the relationship kind so conventional code can recompute it. Do not do the arithmetic yourself.
kind is one of: percent_change (inputs from, to), ratio (numerator, denominator), total (the addends), average (the values), unit_conversion (value, factor), market_share (part, whole), date_interval (start, end), or none if there is no checkable numeric relationship.
claimedResult is the number the claim asserts as the result (e.g. 40 for "a 40% increase"), or null.
inputs is an object of named numbers.`;

export async function verifyNumericClaim(input: { claim: Claim; model: ModelProvider }): Promise<NumericCheck | null> {
  const relation = await input.model.generateStructured({
    purpose: "numeric_extract",
    system: PROMPT,
    prompt: `Claim: "${input.claim.originalText}"`,
    schema: NumericRelationSchema,
  });
  if (relation.kind === "none") return null;

  const c = computeNumeric(relation);
  return {
    claimId: input.claim.id,
    kind: c.kind,
    expression: c.expression,
    inputs: c.inputs,
    computedResult: c.computedResult,
    claimedResult: c.claimedResult,
    matches: c.matches,
    explanation: c.explanation,
  };
}
