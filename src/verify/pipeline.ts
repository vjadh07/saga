// The orchestrator. It runs the whole audit deterministically over a claim set and a
// labeled corpus, emitting real flight-recorder events at each step, and returns the
// full typed result the CLI and UI render. Every hard decision is delegated to a stage
// that is unit-tested on its own; this file only sequences them and records what
// happened. Given the same inputs it produces the same output.
import { arbitrate } from "./arbiter.js";
import { defaultContract } from "./contract.js";
import { buildCorrectedDraft } from "./corrections.js";
import { investigate, skeptic, type CorpusEntry } from "./corpus.js";
import { detectLineage } from "./lineage.js";
import { buildPassport } from "./passport.js";
import { createDeterministicRevision } from "./research/revision.js";
import { sanitizeSource } from "./safety.js";
import { citedSources } from "./sources.js";
import { assessTemporal, temporalScope } from "./temporal.js";
import type { Recorder } from "./recorder.js";
import type {
  Claim,
  ClaimAudit,
  CorrectedDraft,
  Evidence,
  FlightEvent,
  FlightEventType,
  LineageReport,
  SafetyEvent,
  Source,
  TrustPassport,
  Verdict,
} from "./types.js";

export interface AuditInput {
  auditId: string;
  document: string;
  claims: Claim[];
  corpus: CorpusEntry[];
  now: string;
  recorder?: Recorder;
  // This deterministic engine accepts only Demo mode. The optional field preserves older
  // callers that omitted it, while both its type and runtime boundary reject Live mode.
  mode?: "demo";
}

export interface AuditResult {
  auditId: string;
  mode: "demo";
  document: string;
  claimAudits: ClaimAudit[];
  lineage: LineageReport;
  safetyEvents: SafetyEvent[];
  passport: TrustPassport;
  correctedDraft: CorrectedDraft;
  flight: FlightEvent[];
}

const INJECTION_KINDS = new Set<SafetyEvent["kind"]>([
  "instruction_injection",
  "role_override",
  "exfiltration",
  "hidden_content",
]);

export function runAudit(input: AuditInput): AuditResult {
  const { auditId, document, claims, corpus, now, recorder } = input;
  const requestedMode = (input as { mode?: unknown }).mode;
  if (requestedMode !== undefined && requestedMode !== "demo") {
    throw new Error("runAudit is demo-only; use runLiveAudit for arbitrary text and provider-backed evidence");
  }
  const mode = "demo" as const;

  // flight-recorder emit: durable if a recorder is present, always mirrored in-memory
  const flight: FlightEvent[] = [];
  let seq = 0;
  const emit = (type: FlightEventType, claimId: string, detail: Record<string, unknown>): void => {
    if (recorder) {
      flight.push(recorder.record({ auditId, claimId, type, detail }));
    } else {
      flight.push({ seq: ++seq, auditId, claimId, type, detail, at: now });
    }
  };

  // unique sources across the corpus
  const byId = new Map<string, Source>();
  for (const e of corpus) if (!byId.has(e.source.id)) byId.set(e.source.id, e.source);
  const sources = [...byId.values()];

  // claims come from the submitted document (trusted input)
  emit("CLAIMS_EXTRACTED", "", { count: claims.length });
  for (const c of claims) {
    if (c.timeSensitive) emit("CLAIM_CLASSIFIED", c.id, { timeSensitive: true });
  }

  // all retrieved content is data: sanitize every source before any of it is used
  const safetyEvents: SafetyEvent[] = [];
  const cleanById = new Map<string, string>();
  for (const s of sources) {
    const r = sanitizeSource(s);
    cleanById.set(s.id, r.clean);
    safetyEvents.push(...r.events);
    for (const ev of r.events) {
      if (INJECTION_KINDS.has(ev.kind)) {
        emit("INJECTION_QUARANTINED", "", { sourceId: ev.sourceId, kind: ev.kind, excerpt: ev.excerpt });
      }
    }
  }

  // source lineage across the whole corpus: how many independent origins really exist
  const lineage = detectLineage(sources);
  for (const g of lineage.groups) {
    emit("LINEAGE_GROUP_DETECTED", "", {
      sourceIds: g.sourceIds,
      independentOrigins: 1,
      originLabel: g.originLabel,
      signals: g.signals,
    });
  }

  const claimAudits: ClaimAudit[] = [];
  const allCited: Evidence[] = [];

  for (const claim of claims) {
    const contract = defaultContract(claim);
    emit("CONTRACT_DEFINED", claim.id, { primaryRequired: contract.primaryRequired });

    if (!claim.verifiable) {
      const verdict = arbitrate({
        claim,
        evidence: [],
        supportOrigins: 0,
        contraOrigins: 0,
        temporal: assessTemporal({ scope: temporalScope(claim), asOf: claim.asOf, supporting: [], contradicting: [], now }),
      });
      emit("VERDICT_REACHED", claim.id, { verdict: verdict.verdict, confidence: verdict.confidence });
      claimAudits.push({ claim, contract, evidence: [], verdict });
      continue;
    }

    // Investigator: strongest supporting evidence
    const inv = investigate(claim.id, corpus, cleanById);
    emit("QUERY_EXECUTED", claim.id, { agent: "investigator", found: inv.evidence.length });
    for (const rej of inv.rejected) {
      emit("SOURCE_REJECTED", claim.id, { sourceId: rej.sourceId, reason: rej.reason });
    }
    for (const e of inv.evidence) {
      if (byId.get(e.sourceId)?.sourceType === "primary") {
        emit("PRIMARY_SOURCE_FOUND", claim.id, { sourceId: e.sourceId });
      }
    }

    // Skeptic: independently searches for contradictions and qualifications
    const skep = skeptic(claim.id, corpus, cleanById);
    emit("QUERY_EXECUTED", claim.id, { agent: "skeptic", found: skep.evidence.length });
    const contras = skep.evidence.filter((e) => e.stance === "contradicts");
    if (contras.length > 0) emit("CONTRADICTION_FOUND", claim.id, { count: contras.length });

    const evidence = [...inv.evidence, ...skep.evidence];
    allCited.push(...evidence);

    // independent origins behind each side (this is where a crowd of syndicated
    // sources collapses to one)
    const supportOrigins = detectLineage(citedSources(inv.evidence, byId)).independentOrigins;
    const contraOrigins = detectLineage(citedSources(contras, byId)).independentOrigins;

    // supersession is driven only by contradicting evidence: a newer qualification is
    // current context, not grounds to call a claim outdated
    const temporal = assessTemporal({
      scope: temporalScope(claim),
      asOf: claim.asOf,
      supporting: inv.evidence.map((e) => byId.get(e.sourceId)!.publishedAt),
      contradicting: contras.map((e) => byId.get(e.sourceId)!.publishedAt),
      now,
    });
    if (temporal.superseded) emit("TEMPORAL_FLAGGED", claim.id, { note: temporal.note });

    const verdict = arbitrate({ claim, evidence, supportOrigins, contraOrigins, temporal });
    emit("VERDICT_REACHED", claim.id, { verdict: verdict.verdict, confidence: verdict.confidence });

    claimAudits.push({ claim, contract, evidence, verdict });
  }

  const verdicts: Verdict[] = claimAudits.map((a) => a.verdict);
  const citedAll = citedSources(allCited, byId);
  const primarySourceCount = new Set(citedAll.filter((s) => s.sourceType === "primary").map((s) => s.id)).size;
  const globalOrigins = detectLineage(citedAll).independentOrigins;

  const passport = buildPassport({ verdicts, primarySourceCount, independentOrigins: globalOrigins, now });

  const correctedDraft = buildCorrectedDraft(
    document,
    claimAudits.map((a) => ({
      claim: a.claim,
      verdict: a.verdict,
      change: createDeterministicRevision({ claim: a.claim, verdict: a.verdict, evidence: a.evidence }),
    })),
  );

  emit("AUDIT_COMPLETED", "", {
    documentStatus: passport.documentStatus,
    claimsRequiringRevision: passport.claimsRequiringRevision,
  });

  return { auditId, mode, document, claimAudits, lineage, safetyEvents, passport, correctedDraft, flight };
}
