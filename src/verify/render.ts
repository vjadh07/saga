// Turns an audit result into human-readable text: the flight-recorder log and a full
// markdown report. Pure formatting, shared by the CLI and any report file. No I/O.
import type { AuditResult } from "./pipeline.js";
import type { FlightEvent, Verdict } from "./types.js";

const D = (e: FlightEvent) => e.detail;

export function flightMarker(type: FlightEvent["type"]): string {
  switch (type) {
    case "INJECTION_QUARANTINED":
    case "SOURCE_REJECTED":
    case "CONTRADICTION_FOUND":
    case "TEMPORAL_FLAGGED":
      return "!";
    case "QUERY_EXECUTED":
    case "CONTRACT_DEFINED":
    case "CLAIM_CLASSIFIED":
      return ".";
    default:
      return "+";
  }
}

export function flightLine(e: FlightEvent): string {
  const d = D(e);
  switch (e.type) {
    case "CLAIMS_EXTRACTED":
      return `Extracted ${d.count} verifiable claims from the document`;
    case "CLAIM_CLASSIFIED":
      return `Claim ${e.claimId} classified as time-sensitive`;
    case "INJECTION_QUARANTINED":
      return `Prompt injection quarantined from ${d.sourceId} (${d.kind})`;
    case "LINEAGE_GROUP_DETECTED":
      return `${(d.sourceIds as string[]).length} sources traced to one origin: ${d.originLabel}`;
    case "CONTRACT_DEFINED":
      return `Evidence contract defined for ${e.claimId}${d.primaryRequired ? " (primary source required)" : ""}`;
    case "QUERY_EXECUTED":
      return `${d.agent} searched claim ${e.claimId}, ${d.found} passage(s)`;
    case "PRIMARY_SOURCE_FOUND":
      return `Primary source found for ${e.claimId}: ${d.sourceId}`;
    case "SOURCE_REJECTED":
      return `Source ${d.sourceId} rejected for ${e.claimId}: ${d.reason}`;
    case "CONTRADICTION_FOUND":
      return `Skeptic found ${d.count} contradiction(s) for ${e.claimId}`;
    case "TEMPORAL_FLAGGED":
      return `${e.claimId} flagged outdated: ${d.note}`;
    case "VERDICT_REACHED":
      return `Verdict for ${e.claimId}: ${d.verdict} (${d.confidence} confidence)`;
    case "AUDIT_COMPLETED":
      return `Audit complete: ${d.documentStatus}, ${d.claimsRequiringRevision} claim(s) need revision`;
    default:
      return e.type;
  }
}

const VERDICT_LABEL: Record<Verdict["verdict"], string> = {
  supported: "Supported",
  supported_with_qualifications: "Supported with qualifications",
  contradicted: "Contradicted",
  disputed: "Disputed",
  outdated: "Outdated",
  insufficient_evidence: "Insufficient evidence",
  not_verifiable: "Not objectively verifiable",
  failed: "Audit failed",
};

const STATUS_LABEL: Record<string, string> = {
  strongly_supported: "Strongly supported",
  mostly_supported: "Mostly supported",
  revision_required: "Revision required",
  insufficiently_supported: "Insufficiently supported",
  materially_contradicted: "Materially contradicted",
};

export function verdictLabel(v: Verdict["verdict"]): string {
  return VERDICT_LABEL[v];
}
export function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s;
}

export function renderFlightLog(r: AuditResult): string {
  return r.flight.map((e) => `  ${flightMarker(e.type)} ${flightLine(e)}`).join("\n");
}

export function renderMarkdown(r: AuditResult): string {
  const p = r.passport;
  const lines: string[] = [];

  lines.push(`# Saga audit`);
  lines.push("");
  lines.push(`Document status: **${statusLabel(p.documentStatus)}**`);
  lines.push("");
  lines.push("## Trust Passport");
  lines.push(`- Total claims: ${p.totalClaims}`);
  lines.push(`- Supported: ${p.supported}`);
  lines.push(`- Supported with qualifications: ${p.qualified}`);
  lines.push(`- Contradicted: ${p.contradicted}`);
  lines.push(`- Disputed: ${p.disputed}`);
  lines.push(`- Outdated: ${p.outdated}`);
  lines.push(`- Insufficient evidence: ${p.insufficient}`);
  lines.push(`- Not objectively verifiable: ${p.notVerifiable}`);
  lines.push(`- Primary sources cited: ${p.primarySourceCount}`);
  lines.push(`- Independent evidence origins: ${p.independentOrigins}`);
  lines.push(`- Claims requiring revision: ${p.claimsRequiringRevision}`);
  lines.push(`- Last verified: ${p.lastVerifiedAt}`);
  lines.push("");

  lines.push("## Source lineage");
  lines.push(`${r.lineage.sourceCount} sources cited, but only ${r.lineage.independentOrigins} independent evidence origins.`);
  for (const g of r.lineage.groups) {
    lines.push(`- ${g.sourceIds.length} sources trace to one origin (${g.originLabel}); signals: ${g.signals.join(", ")}`);
  }
  lines.push("");

  lines.push("## Safety");
  if (r.safetyEvents.length === 0) {
    lines.push("No unsafe content detected in retrieved sources.");
  } else {
    for (const s of r.safetyEvents) {
      lines.push(`- ${s.kind} ${s.action} in ${s.sourceId}: "${s.excerpt}"`);
    }
  }
  lines.push("");

  lines.push("## Claim-level audit");
  for (const a of r.claimAudits) {
    const v = a.verdict;
    lines.push(`### ${VERDICT_LABEL[v.verdict]} (${v.confidence} confidence)`);
    lines.push(`- Claim: "${a.claim.originalText}"`);
    lines.push(`- Type: ${a.claim.claimType}, risk: ${a.claim.risk}${a.claim.timeSensitive ? ", time-sensitive" : ""}`);
    lines.push(`- Rationale: ${v.rationale}`);
    lines.push(`- Independent origins behind support: ${v.independentOrigins}`);
    const support = a.evidence.filter((e) => e.stance === "supports");
    const against = a.evidence.filter((e) => e.stance === "contradicts" || e.stance === "qualifies");
    if (support.length > 0) {
      lines.push(`- Supporting evidence:`);
      for (const e of support) lines.push(`  - [${e.sourceId}] "${e.excerpt}"`);
    }
    if (against.length > 0) {
      lines.push(`- Contradicting or qualifying evidence:`);
      for (const e of against) lines.push(`  - [${e.sourceId}, ${e.stance}] "${e.excerpt}"`);
    }
    if (v.temporal && v.temporal.superseded) lines.push(`- Temporal: ${v.temporal.note}`);
    if (v.requiredCorrection) lines.push(`- Required correction: ${v.requiredCorrection}`);
    lines.push("");
  }

  lines.push("## Corrected draft (proposed, pending approval)");
  if (r.correctedDraft.changes.length === 0) {
    lines.push("No changes proposed.");
  } else {
    for (const c of r.correctedDraft.changes) {
      lines.push(`- **${c.kind}** [${c.claimId}]: ${c.note}`);
      lines.push(`  - was: "${c.original}"`);
      lines.push(`  - now: "${c.replacement}"`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
