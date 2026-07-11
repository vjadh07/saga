import { DatabaseSync } from "node:sqlite";
import type { ActionState, EventType, LedgerEvent } from "./types.js";
import { TERMINAL_STATES } from "./types.js";

interface Row {
  seq: number;
  saga_id: string;
  action_id: string;
  event: string;
  payload: string;
  at: string;
}

function toEvent(r: Row): LedgerEvent {
  return {
    seq: r.seq,
    sagaId: r.saga_id,
    actionId: r.action_id,
    event: r.event as EventType,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
    at: r.at,
  };
}

export class Ledger {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        saga_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        event TEXT NOT NULL,
        payload TEXT NOT NULL,
        at TEXT NOT NULL
      )
    `);
  }

  append(e: Omit<LedgerEvent, "seq" | "at">): LedgerEvent {
    const at = new Date().toISOString();
    const result = this.db
      .prepare(
        "INSERT INTO events (saga_id, action_id, event, payload, at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(e.sagaId, e.actionId, e.event, JSON.stringify(e.payload), at);
    return { ...e, seq: Number(result.lastInsertRowid), at };
  }

  events(sagaId?: string): LedgerEvent[] {
    const rows = (
      sagaId === undefined
        ? this.db.prepare("SELECT * FROM events ORDER BY seq").all()
        : this.db
            .prepare("SELECT * FROM events WHERE saga_id = ? ORDER BY seq")
            .all(sagaId)
    ) as unknown as Row[];
    return rows.map(toEvent);
  }

  actions(sagaId: string): ActionState[] {
    const byAction = new Map<string, ActionState>();
    for (const e of this.events(sagaId)) {
      let a = byAction.get(e.actionId);
      if (!a) {
        a = { actionId: e.actionId, sagaId, state: e.event, staged: {}, events: [] };
        byAction.set(e.actionId, a);
      }
      a.state = e.event;
      a.events.push(e);
      if (e.event === "STAGED") a.staged = e.payload;
    }
    return [...byAction.values()];
  }

  inFlight(sagaId: string): ActionState[] {
    return this.actions(sagaId).filter((a) => !TERMINAL_STATES.has(a.state));
  }

  close(): void {
    this.db.close();
  }
}
