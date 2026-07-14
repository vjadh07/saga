// The live audit orchestrator. Runs the per-claim pipeline for every claim with per-claim
// failure isolation, detects cross-claim dependencies, builds the Trust Passport, produces
// the revised draft through the Revision Agent, and emits a tamper-evident receipt. This is
// the live counterpart of runAudit; it never touches fixture labels.
import { auditClaim, type LiveClaimAudit } from "./audit-claim.js";
import { detectDependencies, propagateReevaluation } from "../research/dependencies.js";
import { reviseChange } from "../research/revision.js";
import { buildPassport } from "../passport.js";
import { buildReceipt, type AuditReceipt } from "../receipt.js";
import { detectLineage } from "../lineage.js";
import { citedSources } from "../corpus.js";
import type { AuditMode } from "../mapview.js";
import type { ModelProvider } from "../providers/model.js";
import type { PageFetcher } from "../providers/fetch.js";
import type { SearchProvider } from "../providers/search.js";
import type { Recorder } from "../recorder.js";
import type { ExecutionMode } from "../mode.js";
import type {
  Claim,
  ClaimDependency,
  CorrectedDraft,
  DraftChange,
  Evidence,
  FlightEvent,
  FlightEventType,
  Source,
  TrustPassport,
} from "../types.js";

export interface LiveAuditInput {
  auditId: string;
  document: string;
  claims: Claim[];
  mode: AuditMode;
  model: ModelProvider;
  search: SearchProvider;
  fetcher: PageFetcher;
  now: string;
  recorder?: Recorder;
  onEvent?: (e: FlightEvent) => void;
}

export interface LiveAuditResult {
  auditId: string;
  mode: ExecutionMode;
  document: string;
  claimAudits: LiveClaimAudit[];
  dependencies: ClaimDependency[];
  reevaluation: Array<{ claimId: string; reason: string }>;
  passport: TrustPassport;
  correctedDraft: CorrectedDraft;
  receipt: AuditReceipt;
  flight: FlightEvent[];
}

const FAILED_VERDICTS = new Set(["contradicted", "outdated", "insufficient_evidence", "failed"]);

export async function runLiveAudit(input: LiveAuditInput): Promise<LiveAuditResult> {
  const { auditId, document, claims, mode, model, search, fetcher, now, recorder } = input;
  const startedAt = now;

  const flight: FlightEvent[] = [];
  let seq = 0;
  const emit = (type: FlightEventType, claimId: string, detail: Record<string, unknown>): void => {
    const e = recorder ? recorder.record({ auditId, claimId, type, detail }) : { seq: ++seq, auditId, claimId, type, detail, at: now };
    flight.push(e);
    input.onEvent?.(e);
  };
  const emitFor = (claimId: string) => (type: FlightEventType, detail: Record<string, unknown>) => emit(type, claimId, detail);

  emit("CLAIMS_EXTRACTED", "", { count: claims.length });

  // audit each claim with failure isolation
  const claimAudits: LiveClaimAudit[] = [];
  for (const claim of claims) {
    try {
      claimAudits.push(await auditClaim({ claim, mode, model, search, fetcher, now, emit: emitFor(claim.id) }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      claimAudits.push(failedClaimAudit(claim, message));
      emit("VERDICT_REACHED", claim.id, { verdict: "failed", confidence: "low", error: message });
    }
  }

  // cross-claim dependencies and re-evaluation
  const dependencies = await detectDependencies({ claims, model }).catch(() => [] as ClaimDependency[]);
  const failedIds = new Set(claimAudits.filter((a) => FAILED_VERDICTS.has(a.verdict.verdict)).map((a) => a.claim.id));
  const reevaluation = propagateReevaluation(dependencies, failedIds);

  // document-level provenance from all accepted evidence
  const allEvidence: Evidence[] = claimAudits.flatMap((a) => a.evidence);
  const byId = new Map<string, Source>();
  for (const a of claimAudits) for (const s of a.sourcesExamined) if (!byId.has(s.id)) byId.set(s.id, s);
  const citedAll = citedSources(allEvidence, byId);
  const primarySourceCount = new Set(citedAll.filter((s) => s.sourceType === "primary").map((s) => s.id)).size;
  const independentOrigins = detectLineage(citedAll).independentOrigins;

  const passport = buildPassport({ verdicts: claimAudits.map((a) => a.verdict), primarySourceCount, independentOrigins, now });

  // corrected draft through the Revision Agent, applied at claim offsets (original preserved)
  const changes: DraftChange[] = [];
  for (const a of claimAudits) {
    const change = await reviseChange({ claim: a.claim, verdict: a.verdict, evidence: a.evidence, model }).catch(() => null);
    if (change) changes.push(change);
  }
  const correctedDraft = assembleDraft(document, claims, changes);

  emit("AUDIT_COMPLETED", "", { documentStatus: passport.documentStatus, claimsRequiringRevision: passport.claimsRequiringRevision });

  const receipt = buildReceipt({
    auditId,
    mode: "live",
    modelProvider: model.id,
    modelId: model.id,
    searchProvider: search.id,
    document,
    finalDraft: correctedDraft.draft,
    searchQueries: [...new Set(claimAudits.flatMap((a) => a.plan?.supportingQueries.concat(a.plan.skepticQueries) ?? []))],
    sources: citedAll.map((s) => ({ originalUrl: s.url, finalUrl: s.canonicalUrl ?? s.url, accessedAt: now, contentHash: "" })),
    evidence: allEvidence.map((e) => ({ id: e.id, claimId: e.claimId, sourceId: e.sourceId, stance: e.stance, excerpt: e.excerpt, relation: e.citationAssessment?.relation })),
    numericChecks: claimAudits.flatMap((a) => a.numeric ? [a.numeric] : []),
    contractEvaluations: claimAudits.map((a) => a.contractEvaluation),
    verdicts: claimAudits.map((a) => ({ claimId: a.claim.id, verdict: a.verdict.verdict, confidence: a.verdict.confidence })),
    safetyEvents: claimAudits.flatMap((a) => a.safety),
    approvedChangeIds: [],
    startedAt,
    completedAt: now,
  });

  return { auditId, mode: "live", document, claimAudits, dependencies, reevaluation, passport, correctedDraft, receipt, flight };
}

function assembleDraft(document: string, claims: Claim[], changes: DraftChange[]): CorrectedDraft {
  const locById = new Map(claims.map((c) => [c.id, c.location]));
  const ordered = [...changes]
    .map((c) => ({ c, loc: locById.get(c.claimId) }))
    .filter((x) => x.loc)
    .sort((a, b) => b.loc!.start - a.loc!.start);
  let draft = document;
  for (const { c, loc } of ordered) {
    draft = draft.slice(0, loc!.start) + c.replacement + draft.slice(loc!.end);
  }
  return { original: document, changes, draft };
}

function failedClaimAudit(claim: Claim, message: string): LiveClaimAudit {
  return {
    claim,
    contract: { claimId: claim.id, supportingCriteria: [], contradictingCriteria: [], abstentionConditions: [], preferredSourceTypes: ["unknown"], primaryRequired: false },
    plan: null,
    evidence: [],
    sourceQuality: [],
    sourcesExamined: [],
    contractEvaluation: { claimId: claim.id, supportingCriteriaMet: false, contradictingCriteriaMet: false, primaryRequirementMet: false, preferredSourceRequirementMet: false, independentOriginRequirementMet: false, temporalRequirementMet: true, triggeredAbstentionConditions: [message], explanation: message },
    temporal: { scope: "undated", claimAsOf: null, latestEvidenceAt: null, superseded: false, note: "" },
    numeric: null,
    conflict: { claimId: claim.id, hasConflict: false, cause: "none", reconciled: false, explanation: "" },
    verdict: { claimId: claim.id, verdict: "failed", confidence: "low", rationale: message, supporting: [], contradicting: [], independentOrigins: 0, temporal: null, requiredCorrection: null },
    safety: [],
    errors: [{ url: "", error: message }],
  };
}
