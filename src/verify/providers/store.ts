// Audit store abstraction. The in-memory implementation here keeps the workflow testable
// and drives local development; a SQLite implementation (phase 19) and a hosted relational
// store later use the same interface. Every stored object belongs to a workspace so
// authorization can be enforced (phase 21).
import type { Claim, Evidence, FlightEvent } from "../types.js";
import type { ExecutionMode } from "../mode.js";
import type { AuditMode } from "../mapview.js";

// The audit state machine (phase 19 drives transitions; defined here so the store types are
// shared).
export const AUDIT_STATES = [
  "created",
  "mapping_claims",
  "planning_research",
  "researching_support",
  "researching_counterevidence",
  "validating_evidence",
  "analyzing_lineage",
  "validating_temporal",
  "validating_numeric",
  "arbitrating",
  "generating_revision",
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
] as const;
export type AuditStatus = (typeof AUDIT_STATES)[number];

export interface CreateAuditInput {
  auditId?: string;
  mode: ExecutionMode;
  auditMode?: AuditMode;
  document: string;
  workspaceId: string;
}

export interface AuditRecord {
  id: string;
  mode: ExecutionMode;
  auditMode: AuditMode;
  document: string;
  workspaceId: string;
  status: AuditStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditUpdate {
  status?: AuditStatus;
  error?: string | null;
}

export interface StoredAudit {
  record: AuditRecord;
  claims: Claim[];
  evidence: Evidence[];
  events: FlightEvent[];
  result: unknown | null; // the full LiveAuditResult once complete
}

export interface AuditStore {
  createAudit(input: CreateAuditInput): Promise<AuditRecord>;
  updateAudit(id: string, update: AuditUpdate): Promise<void>;
  clearAuditOutput(id: string): Promise<void>;
  saveClaim(auditId: string, claim: Claim): Promise<void>;
  saveEvidence(auditId: string, evidence: Evidence): Promise<void>;
  appendEvent(event: FlightEvent): Promise<void>;
  saveResult(auditId: string, result: unknown): Promise<void>;
  loadAudit(id: string): Promise<StoredAudit>;
}

let counter = 0;
function mintAuditId(): string {
  counter += 1;
  return `aud_${Date.now().toString(36)}_${counter}`;
}

export class InMemoryAuditStore implements AuditStore {
  private records = new Map<string, AuditRecord>();
  private claims = new Map<string, Claim[]>();
  private evidence = new Map<string, Evidence[]>();
  private events = new Map<string, FlightEvent[]>();
  private results = new Map<string, unknown>();
  private now: () => string;

  constructor(now: () => string = () => new Date().toISOString()) {
    this.now = now;
  }

  async createAudit(input: CreateAuditInput): Promise<AuditRecord> {
    const id = input.auditId ?? mintAuditId();
    const at = this.now();
    const record: AuditRecord = {
      id,
      mode: input.mode,
      auditMode: input.auditMode ?? "deep",
      document: input.document,
      workspaceId: input.workspaceId,
      status: "created",
      error: null,
      createdAt: at,
      updatedAt: at,
    };
    this.records.set(id, record);
    this.claims.set(id, []);
    this.evidence.set(id, []);
    this.events.set(id, []);
    return structuredClone(record);
  }

  private require(id: string): AuditRecord {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`audit not found: ${id}`);
    return rec;
  }

  async updateAudit(id: string, update: AuditUpdate): Promise<void> {
    const rec = this.require(id);
    if (update.status !== undefined) rec.status = update.status;
    if (update.error !== undefined) rec.error = update.error;
    rec.updatedAt = this.now();
  }

  async clearAuditOutput(id: string): Promise<void> {
    this.require(id);
    this.claims.set(id, []);
    this.evidence.set(id, []);
    this.events.set(id, []);
    this.results.delete(id);
  }

  async saveClaim(auditId: string, claim: Claim): Promise<void> {
    this.require(auditId);
    const claims = this.claims.get(auditId)!;
    const index = claims.findIndex((item) => item.id === claim.id);
    if (index === -1) claims.push(structuredClone(claim));
    else claims[index] = structuredClone(claim);
  }

  async saveEvidence(auditId: string, evidence: Evidence): Promise<void> {
    this.require(auditId);
    const entries = this.evidence.get(auditId)!;
    const index = entries.findIndex((item) => item.id === evidence.id);
    if (index === -1) entries.push(structuredClone(evidence));
    else entries[index] = structuredClone(evidence);
  }

  async appendEvent(event: FlightEvent): Promise<void> {
    this.require(event.auditId);
    const events = this.events.get(event.auditId)!;
    const existing = events.find((item) => item.seq === event.seq);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(event)) {
        throw new Error(`flight event sequence ${event.seq} already exists for audit ${event.auditId}`);
      }
      return;
    }
    events.push(structuredClone(event));
  }

  async saveResult(auditId: string, result: unknown): Promise<void> {
    this.require(auditId);
    this.results.set(auditId, structuredClone(result));
  }

  async loadAudit(id: string): Promise<StoredAudit> {
    const record = this.require(id);
    return {
      record: structuredClone(record),
      claims: structuredClone(this.claims.get(id)!),
      evidence: structuredClone(this.evidence.get(id)!),
      events: structuredClone(this.events.get(id)!),
      result: this.results.has(id) ? structuredClone(this.results.get(id)) : null,
    };
  }
}
