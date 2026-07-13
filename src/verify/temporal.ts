// Temporal verification. An old claim is not simply false: it may have been accurate
// when written and superseded since. This decides, deterministically from evidence
// dates, whether newer evidence supersedes a once-supported claim. No LLM.
import type { TemporalAssessment } from "./types.js";

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

export interface TemporalInput {
  asOf: string | null; // the date the claim asserts as its "as of", if any
  supporting: string[]; // publication dates of supporting evidence
  contradicting: string[]; // publication dates of contradicting/qualifying evidence
  now: string;
}

export function assessTemporal(input: TemporalInput): TemporalAssessment {
  const latestSupport = maxDate(input.supporting);
  const latestContra = maxDate(input.contradicting);
  const claimAsOf = input.asOf ?? latestSupport;
  const latestEvidenceAt = maxDate([...input.supporting, ...input.contradicting]);

  // Superseded means: the claim once had support, and there is newer contradicting
  // evidence dated after that support. Contradiction with no prior support is a plain
  // contradiction, not an outdated claim.
  const superseded =
    input.supporting.length > 0 &&
    latestContra !== null &&
    latestSupport !== null &&
    latestContra > latestSupport;

  let note: string;
  if (superseded) {
    const asOfLabel = claimAsOf ? monthYear(claimAsOf) : "the time of writing";
    note = `Historically accurate as of ${asOfLabel}, but outdated as of ${monthYear(latestContra!)}.`;
  } else {
    note = "No newer evidence supersedes this claim.";
  }

  return { claimAsOf, latestEvidenceAt, superseded, note };
}
