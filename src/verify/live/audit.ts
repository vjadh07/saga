// The live audit orchestrator. Runs the per-claim pipeline for every claim with per-claim
// failure isolation, detects cross-claim dependencies, builds the Trust Passport, produces
// the revised draft through the Revision Agent, and emits a tamper-evident receipt. This is
// the live counterpart of runAudit; it never touches fixture labels.
import { auditClaim, createLiveClaimTrace, type LiveClaimAudit, type LiveClaimTrace } from "./audit-claim.js";
import { detectDependencies, propagateReevaluation } from "../research/dependencies.js";
import { reviseChange } from "../research/revision.js";
import { buildPassport } from "../passport.js";
import { buildReceipt, type AuditReceipt } from "../receipt.js";
import { detectLineage } from "../lineage.js";
import { citedSources } from "../sources.js";
import { sha256hex } from "../text.js";
import type { LiveAuditStage } from "./stages.js";
import { AuditResources, type AuditMetrics, type AuditResourceOptions } from "./resources.js";
import type { AuditMode } from "../mapview.js";
import type { ModelProvider } from "../providers/model.js";
import type { PageFetcher } from "../providers/fetch.js";
import type { SearchProvider } from "../providers/search.js";
import type { Recorder } from "../recorder.js";
import type {
  Claim,
  ClaimDependency,
  CorrectedDraft,
  DraftChange,
  Evidence,
  FlightEvent,
  FlightEventType,
  LineageReport,
  SafetyEvent,
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
  signal?: AbortSignal;
  onStage?: (stage: LiveAuditStage, claimId: string) => void | Promise<void>;
  resourceOptions?: Omit<AuditResourceOptions, "signal">;
}

export interface LiveAuditResult {
  auditId: string;
  mode: "live";
  document: string;
  claimAudits: LiveClaimAudit[];
  dependencies: ClaimDependency[];
  reevaluation: Array<{ claimId: string; reason: string }>;
  lineage: LineageReport;
  safetyEvents: SafetyEvent[];
  passport: TrustPassport;
  correctedDraft: CorrectedDraft;
  receipt: AuditReceipt;
  flight: FlightEvent[];
  metrics: AuditMetrics;
}

const FAILED_VERDICTS = new Set(["contradicted", "outdated", "insufficient_evidence", "failed"]);

export async function runLiveAudit(input: LiveAuditInput): Promise<LiveAuditResult> {
  const { auditId, document, claims, mode, now, recorder } = input;
  const startedAt = now;
  input.signal?.throwIfAborted();
  const resources = new AuditResources(mode, { ...input.resourceOptions, signal: input.signal });
  resources.checkClaimCount(claims.length);
  const { model, search, fetcher } = resources.guard({ model: input.model, search: input.search, fetcher: input.fetcher });

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
    input.signal?.throwIfAborted();
    const trace = createLiveClaimTrace();
    try {
      claimAudits.push(await auditClaim({
        claim,
        mode,
        model,
        search,
        fetcher,
        now,
        trace,
        emit: emitFor(claim.id),
        signal: input.signal,
        onStage: input.onStage,
      }));
    } catch (err) {
      if (input.signal?.aborted) throw input.signal.reason ?? err;
      const rawMessage = err instanceof Error ? err.message : String(err);
      const message = rawMessage.trim() || "claim audit failed without an error message";
      claimAudits.push(failedClaimAudit(claim, message, trace));
      emit("VERDICT_REACHED", claim.id, { verdict: "failed", confidence: "low", error: message });
    }
  }

  // cross-claim dependencies and re-evaluation
  const dependencies = await detectDependencies({ claims, model }).catch(() => [] as ClaimDependency[]);
  const failedIds = new Set(claimAudits.filter((a) => FAILED_VERDICTS.has(a.verdict.verdict)).map((a) => a.claim.id));
  const reevaluation = propagateReevaluation(dependencies, failedIds);

  // document-level provenance from all accepted evidence
  const allEvidence: Evidence[] = claimAudits.flatMap((a) => a.evidence);
  const byId = collectSources(claimAudits);
  const citedAll = citedSources(allEvidence, byId);
  const primarySourceCount = new Set(citedAll.filter((s) => s.sourceType === "primary").map((s) => s.id)).size;
  const lineage = detectLineage(citedAll);
  const independentOrigins = lineage.independentOrigins;
  const safetyEvents = claimAudits.flatMap((audit) => audit.safety);

  const passport = buildPassport({ verdicts: claimAudits.map((a) => a.verdict), primarySourceCount, independentOrigins, now });

  // corrected draft through the Revision Agent, applied at claim offsets (original preserved)
  input.signal?.throwIfAborted();
  await input.onStage?.("generating_revision", "");
  input.signal?.throwIfAborted();
  const changes: DraftChange[] = [];
  for (const a of claimAudits) {
    const change = await reviseChange({ claim: a.claim, verdict: a.verdict, evidence: a.evidence, numeric: a.numeric, model });
    if (change) changes.push(change);
  }
  const correctedDraft = assembleDraft(document, claims, changes);

  const revisions = changes.map((change) => {
    if (!change.source) throw new Error(`revision ${change.claimId} is missing its production source`);
    return {
      claimId: change.claimId,
      kind: change.kind,
      original: change.original,
      replacement: change.replacement,
      citationEvidenceIds: change.citations ?? [],
      source: change.source,
      numericCheckClaimId: change.numericCheckClaimId ?? null,
    };
  });

  let searchSequence = 0;
  const searches = claimAudits.flatMap((audit) => audit.executedSearches.map((searchRecord) => ({
    sequence: ++searchSequence,
    claimId: audit.claim.id,
    agent: searchRecord.agent,
    query: searchRecord.query,
  })));
  let failureSequence = 0;
  const failures = claimAudits.flatMap((audit) => audit.errors.map((error) => ({
    sequence: ++failureSequence,
    claimId: audit.claim.id,
    ...error,
  })));

  const receipt = buildReceipt({
    auditId,
    mode: "live",
    modelProvider: model.id,
    modelId: model.id,
    searchProvider: search.id,
    document,
    finalDraft: correctedDraft.draft,
    searches,
    sources: [...byId.values()].map((source) => ({
      sourceId: source.id,
      sanitizedContentHash: sha256hex(source.content),
      retrievals: (source.retrievals ?? []).map((retrieval) => {
        if (!retrieval.claimId || !retrieval.agent || !retrieval.query) {
          throw new Error(`source ${source.id} is missing live retrieval execution provenance`);
        }
        return {
          claimId: retrieval.claimId,
          agent: retrieval.agent,
          query: retrieval.query,
          originalUrl: retrieval.originalUrl,
          finalUrl: retrieval.finalUrl,
          accessedAt: retrieval.fetchedAt,
          contentHash: retrieval.contentHash,
        };
      }),
    })),
    evidence: allEvidence.map((evidence) => {
      if (!evidence.citationAssessment) throw new Error(`evidence ${evidence.id} is missing citation validation`);
      return {
        id: evidence.id,
        claimId: evidence.claimId,
        sourceId: evidence.sourceId,
        stance: evidence.stance,
        excerpt: evidence.excerpt,
        citationAssessment: evidence.citationAssessment,
      };
    }),
    numericChecks: claimAudits.flatMap((a) => a.numeric ? [a.numeric] : []),
    contractEvaluations: claimAudits.map((a) => a.contractEvaluation),
    verdicts: claimAudits.map((a) => ({
      claimId: a.claim.id,
      verdict: a.verdict.verdict,
      confidence: a.verdict.confidence,
      supportingEvidenceIds: a.verdict.supporting,
      contradictingEvidenceIds: a.verdict.contradicting,
    })),
    revisions,
    safetyEvents,
    failures,
    approvedChangeIds: [],
    startedAt,
    completedAt: now,
  });

  emit("AUDIT_COMPLETED", "", { documentStatus: passport.documentStatus, claimsRequiringRevision: passport.claimsRequiringRevision });

  const metrics = resources.snapshot();
  return {
    auditId,
    mode: "live",
    document,
    claimAudits,
    dependencies,
    reevaluation,
    lineage,
    safetyEvents,
    passport,
    correctedDraft,
    receipt,
    flight,
    metrics,
  };
}

function collectSources(claimAudits: LiveClaimAudit[]): Map<string, Source> {
  const sources = new Map<string, Source>();
  for (const audit of claimAudits) {
    for (const source of audit.sourcesExamined) {
      const existing = sources.get(source.id);
      if (!existing) {
        sources.set(source.id, source);
        continue;
      }
      if (source !== existing && source.retrievals?.length) {
        existing.retrievals = [...(existing.retrievals ?? []), ...source.retrievals];
      }
    }
  }
  return sources;
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

function failedClaimAudit(claim: Claim, message: string, trace: LiveClaimTrace): LiveClaimAudit {
  return {
    claim,
    contract: { claimId: claim.id, supportingCriteria: [], contradictingCriteria: [], abstentionConditions: [], preferredSourceTypes: ["unknown"], primaryRequired: false },
    plan: null,
    evidence: [],
    sourceQuality: [],
    sourcesExamined: mergeSources(trace.sourcesExamined),
    contractEvaluation: { claimId: claim.id, supportingCriteriaMet: false, contradictingCriteriaMet: false, primaryRequirementMet: false, preferredSourceRequirementMet: false, independentOriginRequirementMet: false, temporalRequirementMet: true, triggeredAbstentionConditions: [message], explanation: message },
    temporal: { scope: "undated", claimAsOf: null, latestEvidenceAt: null, superseded: false, note: "" },
    numeric: null,
    conflict: { claimId: claim.id, hasConflict: false, cause: "none", reconciled: false, explanation: "" },
    verdict: { claimId: claim.id, verdict: "failed", confidence: "low", rationale: message, supporting: [], contradicting: [], independentOrigins: 0, temporal: null, requiredCorrection: "Remove or retry this claim because its audit failed." },
    executedSearches: trace.executedSearches,
    safety: trace.safety,
    errors: [...trace.errors, { agent: "pipeline", operation: "claim", query: null, url: null, error: message }],
  };
}

function mergeSources(input: Source[]): Source[] {
  const byId = new Map<string, Source>();
  for (const source of input) {
    const existing = byId.get(source.id);
    if (!existing) {
      byId.set(source.id, source);
      continue;
    }
    if (source !== existing && source.retrievals?.length) {
      existing.retrievals = [...(existing.retrievals ?? []), ...source.retrievals];
    }
  }
  return [...byId.values()];
}
