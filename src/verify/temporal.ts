// Temporal verification. A claim about a past period is not made false by later change;
// only a claim asserting the present can become outdated. Scope is derived from the claim's
// OWN dating, never inferred: a claim is historical only when it states its reference date,
// current when it is time-sensitive and undated, a prediction when it is about the future,
// and otherwise timeless. No fabricated asOf.
import type { Claim, TemporalAssessment, TemporalScope } from "./types.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function maxDate(dates: string[]): string | null {
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a >= b ? a : b));
}

export function temporalScope(claim: Pick<Claim, "claimType" | "timeSensitive" | "asOf">): TemporalScope {
  if (claim.claimType === "prediction") return "prediction";
  if (claim.asOf) return "historical"; // the claim states its own reference date
  if (claim.timeSensitive) return "current";
  return "undated";
}

export interface TemporalInput {
  scope: TemporalScope;
  asOf: string | null;
  supporting: string[]; // publication dates of supporting evidence
  contradicting: string[]; // publication dates of contradicting evidence
  now: string;
}

export function assessTemporal(input: TemporalInput): TemporalAssessment {
  const latestSupport = maxDate(input.supporting);
  const latestContra = maxDate(input.contradicting);
  const claimAsOf = input.asOf ?? latestSupport;
  const latestEvidenceAt = maxDate([...input.supporting, ...input.contradicting]);

  // Only a current claim can be superseded: it once had support and newer contradicting
  // evidence exists. Historical, prediction, and undated claims are never marked outdated.
  const superseded =
    input.scope === "current" &&
    input.supporting.length > 0 &&
    latestContra !== null &&
    latestSupport !== null &&
    latestContra > latestSupport;

  let note: string;
  if (input.scope === "prediction") {
    note = "A prediction about the future; not evaluated as currently true or false.";
  } else if (input.scope === "historical") {
    note = `Scoped to ${claimAsOf ? monthYear(claimAsOf) : "a stated past period"}; assessed as a historical claim and not affected by later changes.`;
  } else if (superseded) {
    note = `Was accurate earlier but is no longer current as of ${monthYear(latestContra!)}.`;
  } else {
    note = "No newer evidence supersedes this claim.";
  }

  return { scope: input.scope, claimAsOf, latestEvidenceAt, superseded, note };
}
