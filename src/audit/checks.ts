// Pure reconciliation: the ledger says what SHOULD be true, the vendor rows
// say what IS true. Every divergence is a named, evidenced finding. No LLM,
// no I/O: the auditor agent narrates these, it never invents its own.
import type { LedgerEvent } from "../ledger/types.js";
import { TERMINAL_STATES } from "../ledger/types.js";

export type BreakKind =
  | "SHADOW_EFFECT"
  | "DUPLICATE_CHARGE"
  | "PHANTOM_COMPENSATION"
  | "WEDGED_SAGA";

export interface OracleRow {
  key: string;
  vendor: string;
  item: Record<string, unknown>;
  createdAt: string;
}

export interface Finding {
  kind: BreakKind;
  vendor: string;
  subject: string;
  summary: string;
  ledgerEvidence: LedgerEvent[];
  vendorEvidence: OracleRow[];
}

interface FoldedAction {
  actionId: string;
  vendor: string;
  state: LedgerEvent["event"];
  events: LedgerEvent[];
}

function fold(events: LedgerEvent[]): Map<string, FoldedAction> {
  const byAction = new Map<string, FoldedAction>();
  for (const e of events) {
    let a = byAction.get(e.actionId);
    if (!a) {
      a = { actionId: e.actionId, vendor: "", state: e.event, events: [] };
      byAction.set(e.actionId, a);
    }
    a.state = e.event;
    a.events.push(e);
    if (e.event === "STAGED") a.vendor = String(e.payload.vendor ?? "");
  }
  return byAction;
}

export function runChecks(events: LedgerEvent[], rows: OracleRow[]): Finding[] {
  const actions = fold(events);
  const findings: Finding[] = [];

  const knownRows = rows.filter((r) => actions.has(r.key));
  const unknownRows = rows.filter((r) => !actions.has(r.key));
  const knownItemIndex = new Map<string, OracleRow>();
  for (const r of knownRows) knownItemIndex.set(`${r.vendor}:${JSON.stringify(r.item)}`, r);

  for (const r of unknownRows) {
    const twin = knownItemIndex.get(`${r.vendor}:${JSON.stringify(r.item)}`);
    if (twin) {
      findings.push({
        kind: "DUPLICATE_CHARGE",
        vendor: r.vendor,
        subject: r.key,
        summary: `vendor ${r.vendor} holds a second booking (key ${r.key}) duplicating authorized booking ${twin.key}`,
        ledgerEvidence: actions.get(twin.key)?.events ?? [],
        vendorEvidence: [twin, r],
      });
    } else {
      findings.push({
        kind: "SHADOW_EFFECT",
        vendor: r.vendor,
        subject: r.key,
        summary: `vendor ${r.vendor} holds booking ${r.key} that no ledger intent ever authorized`,
        ledgerEvidence: [],
        vendorEvidence: [r],
      });
    }
  }

  const rowByKey = new Map(rows.map((r) => [r.key, r]));
  for (const a of actions.values()) {
    if (a.state === "COMPENSATED" && rowByKey.has(a.actionId)) {
      findings.push({
        kind: "PHANTOM_COMPENSATION",
        vendor: a.vendor,
        subject: a.actionId,
        summary: `ledger says ${a.actionId} was compensated but vendor ${a.vendor} still holds the booking`,
        ledgerEvidence: a.events,
        vendorEvidence: [rowByKey.get(a.actionId)!],
      });
    }
    if (!TERMINAL_STATES.has(a.state) || a.state === "ABORTED") {
      const why = a.state === "ABORTED" ? "aborted after exhausting attempts" : `stuck at ${a.state}`;
      findings.push({
        kind: "WEDGED_SAGA",
        vendor: a.vendor,
        subject: a.actionId,
        summary: `action ${a.actionId} is ${why} and needs attention`,
        ledgerEvidence: a.events,
        vendorEvidence: rowByKey.has(a.actionId) ? [rowByKey.get(a.actionId)!] : [],
      });
    }
  }

  return findings;
}
