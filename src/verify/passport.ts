// The Trust Passport: a document-level summary that replaces any single credibility
// score. It counts claims by verdict, records provenance (primary sources, independent
// origins), and assigns a human-readable document status by deterministic rule. No
// percentage is invented; the status is derived from counts.
import type { DocumentStatus, TrustPassport, Verdict } from "./types.js";

export interface PassportInput {
  verdicts: Verdict[];
  primarySourceCount: number;
  independentOrigins: number;
  now: string;
}

function documentStatus(counts: {
  verifiable: number;
  supported: number;
  qualified: number;
  contradicted: number;
  disputed: number;
  outdated: number;
  insufficient: number;
}): DocumentStatus {
  const { verifiable, supported, qualified, contradicted, disputed, outdated, insufficient } = counts;
  if (verifiable === 0) return "insufficiently_supported";

  const falseish = contradicted + outdated;
  // a quarter or more of verifiable claims are false or outdated, with at least one
  // outright contradiction
  if (contradicted >= 1 && falseish >= Math.ceil(verifiable * 0.25)) {
    return "materially_contradicted";
  }
  // half or more could not be verified at all
  if (insufficient >= Math.ceil(verifiable * 0.5)) {
    return "insufficiently_supported";
  }
  // nothing needs revision: every verifiable claim is cleanly supported
  if (qualified + contradicted + disputed + outdated + insufficient === 0) {
    return "strongly_supported";
  }
  // no falsehoods, a strong majority supported, only qualifications remain
  if (falseish === 0 && disputed === 0 && supported >= Math.ceil(verifiable * 0.6)) {
    return "mostly_supported";
  }
  return "revision_required";
}

export function buildPassport(input: PassportInput): TrustPassport {
  const count = (k: Verdict["verdict"]): number => input.verdicts.filter((v) => v.verdict === k).length;

  const supported = count("supported");
  const qualified = count("supported_with_qualifications");
  const contradicted = count("contradicted");
  const disputed = count("disputed");
  const outdated = count("outdated");
  const insufficient = count("insufficient_evidence");
  const notVerifiable = count("not_verifiable");
  const totalClaims = input.verdicts.length;
  const verifiable = totalClaims - notVerifiable;
  const claimsRequiringRevision = input.verdicts.filter((v) => v.requiredCorrection !== null).length;

  return {
    totalClaims,
    supported,
    qualified,
    contradicted,
    disputed,
    outdated,
    insufficient,
    notVerifiable,
    primarySourceCount: input.primarySourceCount,
    independentOrigins: input.independentOrigins,
    claimsRequiringRevision,
    lastVerifiedAt: input.now,
    documentStatus: documentStatus({ verifiable, supported, qualified, contradicted, disputed, outdated, insufficient }),
  };
}
