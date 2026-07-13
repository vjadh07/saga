// The Agent Flight Recorder. It stores real, structured system events (not hidden
// model reasoning) on the same durable append-only substrate the transaction ledger
// uses: WAL-mode SQLite, insert-only, monotonic seq. The recorder makes an audit
// reproducible and debuggable, and drives the live investigation log in the UI.
import { DatabaseSync } from "node:sqlite";
import type { FlightEvent, FlightEventType } from "./types.js";

interface Row {
  seq: number;
  audit_id: string;
  claim_id: string;
  type: string;
  detail: string;
  at: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS flight (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    type TEXT NOT NULL,
    detail TEXT NOT NULL,
    at TEXT NOT NULL
  )
`;

function toEvent(r: Row): FlightEvent {
  return {
    seq: r.seq,
    auditId: r.audit_id,
    claimId: r.claim_id,
    type: r.type as FlightEventType,
    detail: JSON.parse(r.detail) as Record<string, unknown>,
    at: r.at,
  };
}

export interface RecorderOptions {
  clock?: () => string;
}

export class Recorder {
  private db: DatabaseSync;
  private clock: () => string;

  constructor(path: string, opts: RecorderOptions = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);
    this.clock = opts.clock ?? (() => new Date().toISOString());
  }

  record(e: {
    auditId: string;
    claimId?: string;
    type: FlightEventType;
    detail?: Record<string, unknown>;
  }): FlightEvent {
    const at = this.clock();
    const claimId = e.claimId ?? "";
    const detail = e.detail ?? {};
    const result = this.db
      .prepare("INSERT INTO flight (audit_id, claim_id, type, detail, at) VALUES (?, ?, ?, ?, ?)")
      .run(e.auditId, claimId, e.type, JSON.stringify(detail), at);
    return { seq: Number(result.lastInsertRowid), auditId: e.auditId, claimId, type: e.type, detail, at };
  }

  events(auditId?: string): FlightEvent[] {
    const rows = (
      auditId === undefined
        ? this.db.prepare("SELECT * FROM flight ORDER BY seq").all()
        : this.db.prepare("SELECT * FROM flight WHERE audit_id = ? ORDER BY seq").all(auditId)
    ) as unknown as Row[];
    return rows.map(toEvent);
  }

  close(): void {
    this.db.close();
  }
}

// Empty the recorder in place, matching the ledger's wipe so a running viewer keeps
// its connection.
export function wipeRecorder(path: string): void {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  db.exec("DELETE FROM flight");
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'flight'");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}
