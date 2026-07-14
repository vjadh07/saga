// The audit service: drives one audit through the state machine, persists every step, and
// isolates failure. The Claim Mapper and the live audit runner are injected so the service
// is testable without a model, and so a hosted deployment can swap in a managed queue and
// database behind the same store interface. Cancellation is checked between stages; a
// browser refresh reads the persisted record; a partial result is preserved when some
// claims fail.
import type { AuditRecord, AuditStore, StoredAudit, AuditStatus } from "../providers/store.js";
import type { LiveAuditResult } from "./audit.js";
import type { Claim, FlightEvent } from "../types.js";
import type { ExecutionMode } from "../mode.js";
import type { AuditMode } from "../mapview.js";
import type { LiveAuditStage } from "./stages.js";
import { canonicalJson, verifyReceipt } from "../receipt.js";
import { hashId, sha256hex } from "../text.js";

const TERMINAL: ReadonlySet<AuditStatus> = new Set(["completed", "partially_completed", "failed", "cancelled"]);
const RETRYABLE: ReadonlySet<AuditStatus> = new Set(["partially_completed", "failed", "cancelled"]);

export interface AuditRunners {
  mapClaims: (document: string, context: { signal: AbortSignal }) => Promise<Claim[]>;
  runAudit: (input: {
    auditId: string;
    document: string;
    claims: Claim[];
    auditMode: AuditMode;
    signal: AbortSignal;
    onStage?: (stage: LiveAuditStage, claimId: string) => void | Promise<void>;
    onEvent?: (event: FlightEvent) => void;
  }) => Promise<LiveAuditResult>;
}

export interface AuditServiceOptions {
  mappingTimeoutMs?: number;
  auditTimeoutMs?: number;
  clock?: () => number;
}

export class AuditService {
  private cancelled = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private processing = new Set<string>();
  private mappingTimeoutMs: number;
  private auditTimeoutMs: number;
  private clock: () => number;

  constructor(private store: AuditStore, private runners: AuditRunners, options: AuditServiceOptions = {}) {
    this.mappingTimeoutMs = options.mappingTimeoutMs ?? 60_000;
    this.auditTimeoutMs = options.auditTimeoutMs ?? 300_000;
    this.clock = options.clock ?? (() => performance.now());
  }

  async create(input: { document: string; mode: ExecutionMode; auditMode?: AuditMode; workspaceId: string }): Promise<AuditRecord> {
    return this.store.createAudit(input);
  }

  async get(auditId: string): Promise<StoredAudit> {
    return this.store.loadAudit(auditId);
  }

  async cancel(auditId: string): Promise<void> {
    const { record } = await this.store.loadAudit(auditId);
    if (!TERMINAL.has(record.status)) {
      this.cancelled.add(auditId);
      await this.store.updateAudit(auditId, { status: "cancelled" });
      this.controllers.get(auditId)?.abort(new Error("audit cancelled"));
    }
  }

  async retry(auditId: string): Promise<void> {
    const { record } = await this.store.loadAudit(auditId);
    if (!RETRYABLE.has(record.status)) throw new Error(`cannot retry audit in ${record.status} status`);
    this.cancelled.delete(auditId);
    await this.store.clearAuditOutput(auditId);
    await this.store.updateAudit(auditId, { status: "created", error: null });
    await this.process(auditId);
  }

  // The worker. Runs mapping, then the live audit, transitioning status and persisting as it
  // goes. Any thrown error fails only this audit.
  async process(auditId: string): Promise<void> {
    if (this.processing.has(auditId)) return;
    this.processing.add(auditId);
    const processStartedAt = this.clock();
    const set = (status: AuditStatus, error: string | null = null) => this.store.updateAudit(auditId, { status, error });
    let controller: AbortController | null = null;
    let eventWrites: Promise<void> = Promise.resolve();
    const stopIfDurablyCancelled = async (): Promise<boolean> => {
      const latest = await this.store.loadAudit(auditId);
      if (latest.record.status !== "cancelled") return false;
      if (controller && !controller.signal.aborted) controller.abort(new Error("audit cancelled"));
      return true;
    };
    try {
      const { record } = await this.store.loadAudit(auditId);
      if (record.status === "cancelled" || this.cancelled.has(auditId)) return set("cancelled");
      if (TERMINAL.has(record.status)) return;
      controller = new AbortController();
      this.controllers.set(auditId, controller);

      await set("mapping_claims");
      const claims = await bounded(
        "claim mapping",
        this.mappingTimeoutMs,
        controller,
        this.runners.mapClaims(record.document, { signal: controller.signal }),
      );
      if (await stopIfDurablyCancelled()) return;
      validateMappedClaims(claims, record.document);
      for (const c of claims) await this.store.saveClaim(auditId, c);
      if (controller.signal.aborted || this.cancelled.has(auditId) || await stopIfDurablyCancelled()) return;
      if (claims.length === 0) return set("failed", "no verifiable claims were extracted");

      await set("researching_support");
      const result = await bounded(
        "live audit",
        this.auditTimeoutMs,
        controller,
        this.runners.runAudit({
          auditId,
          document: record.document,
          claims,
          auditMode: record.auditMode,
          signal: controller.signal,
          onStage: async (stage) => {
            const latest = await this.store.loadAudit(auditId);
            if (latest.record.status === "cancelled") {
              const error = new Error("audit cancelled");
              if (!controller!.signal.aborted) controller!.abort(error);
              throw controller!.signal.reason ?? error;
            }
            if (!TERMINAL.has(latest.record.status)) await set(stage);
          },
          onEvent: (event) => {
            if (event.auditId !== auditId) throw new Error(`flight event audit id ${event.auditId} does not match ${auditId}`);
            eventWrites = eventWrites.then(async () => {
              if (await stopIfDurablyCancelled()) return;
              await this.store.appendEvent(event);
            });
          },
        }),
      );
      if (controller.signal.aborted || this.cancelled.has(auditId) || await stopIfDurablyCancelled()) return;
      await eventWrites;
      if (await stopIfDurablyCancelled()) return;

      if (result.auditId !== auditId) {
        throw new Error(`runner result audit id ${result.auditId} does not match ${auditId}`);
      }
      if (result.document !== record.document) {
        throw new Error(`runner result document does not match audit ${auditId}`);
      }
      if (result.mode !== record.mode) {
        throw new Error(`runner result mode ${result.mode} does not match audit mode ${record.mode}`);
      }
      result.metrics.durationMs = Math.max(0, Math.round(this.clock() - processStartedAt));
      validateResultGraph(result, claims, record.document);

      for (const e of result.flight) {
        if (await stopIfDurablyCancelled()) return;
        if (e.auditId !== auditId) throw new Error(`flight event audit id ${e.auditId} does not match ${auditId}`);
        await this.store.appendEvent(e as FlightEvent);
      }
      for (const claimAudit of result.claimAudits) {
        for (const evidence of claimAudit.evidence ?? []) {
          if (await stopIfDurablyCancelled()) return;
          await this.store.saveEvidence(auditId, evidence);
        }
      }
      if (await stopIfDurablyCancelled()) return;
      await this.store.saveResult(auditId, result);

      const verdicts = result.claimAudits.map((a) => a.verdict.verdict);
      const allFailed = verdicts.length > 0 && verdicts.every((v) => v === "failed");
      const anyFailed = verdicts.some((v) => v === "failed");
      if (await stopIfDurablyCancelled()) return;
      await set(allFailed ? "failed" : anyFailed ? "partially_completed" : "completed");
    } catch (err) {
      let failure = err;
      try {
        await eventWrites;
      } catch (eventError) {
        failure = eventError;
      }
      const latest = await this.store.loadAudit(auditId);
      if (latest.record.status !== "cancelled") {
        await set("failed", failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (controller && this.controllers.get(auditId) === controller) this.controllers.delete(auditId);
      this.processing.delete(auditId);
    }
  }
}

function validateMappedClaims(claims: Claim[], document: string): void {
  const ids = new Set<string>();
  const spans: Array<{ id: string; start: number; end: number }> = [];
  for (const claim of claims) {
    if (typeof claim.id !== "string" || claim.id.trim() === "" || ids.has(claim.id)) {
      throw new Error("mapped claim ids must be non-empty and unique");
    }
    ids.add(claim.id);
    const { start, end } = claim.location;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > document.length) {
      throw new Error(`mapped claim ${claim.id} has an invalid document location`);
    }
    if (claim.originalText !== document.slice(start, end)) {
      throw new Error(`mapped claim ${claim.id} text does not match its document location`);
    }
    spans.push({ id: claim.id, start, end });
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end || compareStrings(a.id, b.id));
  for (let index = 1; index < spans.length; index++) {
    if (spans[index]!.start < spans[index - 1]!.end) {
      throw new Error(`mapped claims ${spans[index - 1]!.id} and ${spans[index]!.id} overlap`);
    }
  }
}

function validateResultGraph(result: LiveAuditResult, claims: Claim[], document: string): void {
  if (result.receipt.auditId !== result.auditId) throw new Error("receipt audit id does not match the live result");
  if (result.receipt.mode !== result.mode) throw new Error("receipt mode does not match the live result");
  if (result.receipt.documentHash !== sha256hex(document)) throw new Error("receipt document hash does not match the submitted document");
  if (result.correctedDraft.original !== document) throw new Error("corrected draft original does not match the submitted document");
  if (result.receipt.finalDraftHash !== sha256hex(result.correctedDraft.draft)) throw new Error("receipt final draft hash does not match the corrected draft");
  const verification = verifyReceipt(result.receipt);
  if (!verification.valid) throw new Error(`receipt validation failed: ${verification.reason}`);

  const mappedIds = [...new Set(claims.map((claim) => claim.id))].sort();
  const auditedIds = [...new Set(result.claimAudits.map((audit) => audit.claim.id))].sort();
  if (mappedIds.length !== claims.length || auditedIds.length !== result.claimAudits.length
      || canonicalJson(mappedIds) !== canonicalJson(auditedIds)) {
    throw new Error("result claim coverage does not exactly match the mapped claims");
  }
  assertGraphParity("claim details", sortByClaimId(claims), sortByClaimId(result.claimAudits.map((audit) => audit.claim)));

  assertGraphParity("verdicts", sortByClaimId(result.claimAudits.map((audit) => ({
    claimId: audit.claim.id,
    verdict: audit.verdict.verdict,
    confidence: audit.verdict.confidence,
    supportingEvidenceIds: audit.verdict.supporting,
    contradictingEvidenceIds: audit.verdict.contradicting,
  }))), sortByClaimId(result.receipt.verdicts));

  const evidence = result.claimAudits.flatMap((audit) => audit.evidence ?? []).map((item) => {
    if (!item.citationAssessment) throw new Error(`evidence ${item.id} is missing citation validation`);
    return {
      id: item.id,
      claimId: item.claimId,
      sourceId: item.sourceId,
      stance: item.stance,
      excerpt: item.excerpt,
      citationAssessment: item.citationAssessment,
      excerptHash: sha256hex(item.excerpt),
    };
  });
  assertGraphParity("evidence", sortById(evidence), sortById(result.receipt.evidence));

  const numericChecks = result.claimAudits.flatMap((audit) => audit.numeric ? [audit.numeric] : []);
  assertGraphParity("numeric checks", sortByClaimId(numericChecks), sortByClaimId(result.receipt.numericChecks));
  assertGraphParity(
    "contract evaluations",
    sortByClaimId(result.claimAudits.map((audit) => audit.contractEvaluation)),
    sortByClaimId(result.receipt.contractEvaluations),
  );

  const revisions = result.correctedDraft.changes.map((change) => {
    if (!change.source) throw new Error(`revision ${change.claimId} is missing its production source`);
    const withoutId = {
      claimId: change.claimId,
      kind: change.kind,
      originalHash: sha256hex(change.original),
      replacementHash: sha256hex(change.replacement),
      citationEvidenceIds: [...(change.citations ?? [])].sort(compareStrings),
      source: change.source,
      numericCheckClaimId: change.numericCheckClaimId ?? null,
    };
    return {
      ...withoutId,
      changeId: hashId(
        "chg", withoutId.claimId, withoutId.kind, withoutId.originalHash, withoutId.replacementHash,
        withoutId.citationEvidenceIds.join(","), withoutId.source, withoutId.numericCheckClaimId ?? "",
      ),
    };
  });
  assertGraphParity("revisions", sortByClaimId(revisions), sortByClaimId(result.receipt.revisions));
  assertGraphParity("approved revisions", [], result.receipt.approvedChangeIds);

  let searchSequence = 0;
  const searches = result.claimAudits.flatMap((audit) => (audit.executedSearches ?? []).map((search) => ({
    sequence: ++searchSequence,
    claimId: audit.claim.id,
    agent: search.agent,
    query: search.query,
  })));
  assertGraphParity("searches", searches, result.receipt.searches);
  assertGraphParity("sources", sourcesFromResult(result), normalizeReceiptSources(result.receipt.sources));

  const claimSafety = result.claimAudits.flatMap((audit) => audit.safety ?? []);
  assertGraphParity("claim safety events", claimSafety, result.safetyEvents);
  assertGraphParity("safety events", result.safetyEvents, result.receipt.safetyEvents);

  let failureSequence = 0;
  const failures = result.claimAudits.flatMap((audit) => (audit.errors ?? []).map((failure) => ({
    sequence: ++failureSequence,
    claimId: audit.claim.id,
    ...failure,
  })));
  assertGraphParity("failures", failures, result.receipt.failures);
}

function sourcesFromResult(result: LiveAuditResult): Array<{ sourceId: string; sanitizedContentHash: string; retrievals: unknown[] }> {
  const sources = new Map<string, { sourceId: string; sanitizedContentHash: string; retrievals: unknown[] }>();
  for (const audit of result.claimAudits) {
    for (const source of audit.sourcesExamined ?? []) {
      const sanitizedContentHash = sha256hex(source.content);
      const retrievals = (source.retrievals ?? []).map((retrieval) => {
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
      });
      const existing = sources.get(source.id);
      if (!existing) {
        sources.set(source.id, { sourceId: source.id, sanitizedContentHash, retrievals: sortCanonical(retrievals) });
        continue;
      }
      if (existing.sanitizedContentHash !== sanitizedContentHash) {
        throw new Error(`source ${source.id} has divergent content in the live result`);
      }
      for (const retrieval of retrievals) {
        if (!existing.retrievals.some((candidate) => canonicalJson(candidate) === canonicalJson(retrieval))) {
          existing.retrievals.push(retrieval);
        }
      }
      existing.retrievals = sortCanonical(existing.retrievals);
    }
  }
  return [...sources.values()].sort((a, b) => compareStrings(a.sourceId, b.sourceId));
}

function normalizeReceiptSources(sources: LiveAuditResult["receipt"]["sources"]): Array<{ sourceId: string; sanitizedContentHash: string; retrievals: unknown[] }> {
  return sources.map((source) => ({ ...source, retrievals: sortCanonical(source.retrievals) }))
    .sort((a, b) => compareStrings(a.sourceId, b.sourceId));
}

function assertGraphParity(label: string, resultValue: unknown, receiptValue: unknown): void {
  if (canonicalJson(resultValue) !== canonicalJson(receiptValue)) {
    throw new Error(`receipt ${label} do not match the live result`);
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortByClaimId<T extends { claimId?: string; id?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => compareStrings(a.claimId ?? a.id ?? "", b.claimId ?? b.id ?? ""));
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => compareStrings(a.id, b.id));
}

function sortCanonical<T>(items: T[]): T[] {
  return [...items].sort((a, b) => compareStrings(canonicalJson(a), canonicalJson(b)));
}

async function bounded<T>(label: string, timeoutMs: number, controller: AbortController, operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbort = () => {};
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const cancelled = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(controller.signal.reason ?? new Error("audit cancelled"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => controller.signal.removeEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([operation, timeout, cancelled]);
  } finally {
    if (timer) clearTimeout(timer);
    removeAbort();
  }
}
