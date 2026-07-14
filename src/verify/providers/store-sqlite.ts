// Durable AuditStore implementation for local and single-node deployments. Audit artifacts
// are stored as JSON so the provider boundary preserves the same typed graph as the in-memory
// store, while normalized keys keep claim, evidence, and event writes independently idempotent.
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import type { AuditMode } from "../mapview.js";
import type { ExecutionMode } from "../mode.js";
import type { Claim, Evidence, FlightEvent } from "../types.js";
import type {
  AuditRecord,
  AuditStatus,
  AuditStore,
  AuditUpdate,
  CreateAuditInput,
  StoredAudit,
} from "./store.js";

interface AuditRow {
  id: string;
  mode: string;
  audit_mode: string;
  document: string;
  workspace_id: string;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  result_json: string | null;
}

interface JsonRow {
  payload: string;
}

interface PositionRow {
  position: number;
}

interface NextPositionRow {
  next_position: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS audits (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL CHECK (mode IN ('live', 'demo')),
    audit_mode TEXT NOT NULL CHECK (audit_mode IN ('quick', 'deep', 'high_stakes')),
    document TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
      'created', 'mapping_claims', 'planning_research', 'researching_support',
      'researching_counterevidence', 'validating_evidence', 'analyzing_lineage',
      'validating_temporal', 'validating_numeric', 'arbitrating', 'generating_revision',
      'completed', 'partially_completed', 'failed', 'cancelled'
    )),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    result_json TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_claims (
    audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    claim_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (audit_id, claim_id),
    UNIQUE (audit_id, position)
  );

  CREATE TABLE IF NOT EXISTS audit_evidence (
    audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (audit_id, evidence_id),
    UNIQUE (audit_id, position)
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (audit_id, seq)
  );
`;

function encode(value: unknown, label: string): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("value has no JSON representation");
    if (!isDeepStrictEqual(value, JSON.parse(encoded))) {
      throw new Error("value would change during JSON serialization");
    }
    return encoded;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not JSON serializable: ${message}`);
  }
}

function decode<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} contains invalid JSON: ${message}`);
  }
}

function toRecord(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    mode: row.mode as ExecutionMode,
    auditMode: row.audit_mode as AuditMode,
    document: row.document,
    workspaceId: row.workspace_id,
    status: row.status as AuditStatus,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteAuditStore implements AuditStore {
  private db: DatabaseSync;
  private now: () => string;

  constructor(path: string, now: () => string = () => new Date().toISOString()) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(SCHEMA);
    this.now = now;
  }

  async createAudit(input: CreateAuditInput): Promise<AuditRecord> {
    const id = input.auditId ?? `aud_${randomUUID()}`;
    const at = this.now();
    this.db.prepare(`
      INSERT INTO audits (
        id, mode, audit_mode, document, workspace_id, status, error,
        created_at, updated_at, result_json
      ) VALUES (?, ?, ?, ?, ?, 'created', NULL, ?, ?, NULL)
    `).run(id, input.mode, input.auditMode ?? "deep", input.document, input.workspaceId, at, at);
    return {
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
  }

  private require(id: string): AuditRow {
    const row = this.db.prepare("SELECT * FROM audits WHERE id = ?").get(id) as unknown as AuditRow | undefined;
    if (!row) throw new Error(`audit not found: ${id}`);
    return row;
  }

  async updateAudit(id: string, update: AuditUpdate): Promise<void> {
    const current = this.require(id);
    const status = update.status ?? current.status;
    const error = update.error === undefined ? current.error : update.error;
    this.db.prepare("UPDATE audits SET status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(status, error, this.now(), id);
  }

  async clearAuditOutput(id: string): Promise<void> {
    this.require(id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM audit_claims WHERE audit_id = ?").run(id);
      this.db.prepare("DELETE FROM audit_evidence WHERE audit_id = ?").run(id);
      this.db.prepare("DELETE FROM audit_events WHERE audit_id = ?").run(id);
      this.db.prepare("UPDATE audits SET result_json = NULL WHERE id = ?").run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private saveOrdered(
    table: "audit_claims" | "audit_evidence",
    idColumn: "claim_id" | "evidence_id",
    auditId: string,
    artifactId: string,
    value: unknown,
  ): void {
    this.require(auditId);
    const payload = encode(value, `${idColumn} ${artifactId}`);
    const existing = this.db.prepare(`SELECT position FROM ${table} WHERE audit_id = ? AND ${idColumn} = ?`)
      .get(auditId, artifactId) as unknown as PositionRow | undefined;
    if (existing) {
      this.db.prepare(`UPDATE ${table} SET payload = ? WHERE audit_id = ? AND ${idColumn} = ?`)
        .run(payload, auditId, artifactId);
      return;
    }
    const next = this.db.prepare(`SELECT COALESCE(MAX(position) + 1, 0) AS next_position FROM ${table} WHERE audit_id = ?`)
      .get(auditId) as unknown as NextPositionRow;
    this.db.prepare(`INSERT INTO ${table} (audit_id, ${idColumn}, position, payload) VALUES (?, ?, ?, ?)`)
      .run(auditId, artifactId, next.next_position, payload);
  }

  async saveClaim(auditId: string, claim: Claim): Promise<void> {
    this.saveOrdered("audit_claims", "claim_id", auditId, claim.id, claim);
  }

  async saveEvidence(auditId: string, evidence: Evidence): Promise<void> {
    this.saveOrdered("audit_evidence", "evidence_id", auditId, evidence.id, evidence);
  }

  async appendEvent(event: FlightEvent): Promise<void> {
    this.require(event.auditId);
    const payload = encode(event, `flight event ${event.seq}`);
    const existing = this.db.prepare("SELECT payload FROM audit_events WHERE audit_id = ? AND seq = ?")
      .get(event.auditId, event.seq) as unknown as JsonRow | undefined;
    if (existing) {
      if (!isDeepStrictEqual(decode<FlightEvent>(existing.payload, `flight event ${event.seq}`), decode<FlightEvent>(payload, `flight event ${event.seq}`))) {
        throw new Error(`flight event sequence ${event.seq} already exists for audit ${event.auditId}`);
      }
      return;
    }
    this.db.prepare("INSERT INTO audit_events (audit_id, seq, payload) VALUES (?, ?, ?)")
      .run(event.auditId, event.seq, payload);
  }

  async saveResult(auditId: string, result: unknown): Promise<void> {
    this.require(auditId);
    this.db.prepare("UPDATE audits SET result_json = ? WHERE id = ?")
      .run(encode(result, `audit ${auditId} result`), auditId);
  }

  async loadAudit(id: string): Promise<StoredAudit> {
    const row = this.require(id);
    const claims = this.db.prepare("SELECT payload FROM audit_claims WHERE audit_id = ? ORDER BY position")
      .all(id) as unknown as JsonRow[];
    const evidence = this.db.prepare("SELECT payload FROM audit_evidence WHERE audit_id = ? ORDER BY position")
      .all(id) as unknown as JsonRow[];
    const events = this.db.prepare("SELECT payload FROM audit_events WHERE audit_id = ? ORDER BY seq")
      .all(id) as unknown as JsonRow[];
    return {
      record: toRecord(row),
      claims: claims.map((item) => decode<Claim>(item.payload, `audit ${id} claim`)),
      evidence: evidence.map((item) => decode<Evidence>(item.payload, `audit ${id} evidence`)),
      events: events.map((item) => decode<FlightEvent>(item.payload, `audit ${id} event`)),
      result: row.result_json === null ? null : decode<unknown>(row.result_json, `audit ${id} result`),
    };
  }

  clearAll(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM audits");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
