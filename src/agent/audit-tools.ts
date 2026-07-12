// The auditor's hands. Everything here is read-only toward the world: the
// only write is a local markdown report. Findings come from runChecks and
// nowhere else, so the model can narrate but never invent.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ledger } from "../ledger/ledger.js";
import { runChecks, type Finding, type OracleRow } from "../audit/checks.js";

export interface AuditContext {
  ledger: Ledger;
  vendorBase: string;
  reportsDir?: string;
}

interface AdminBooking {
  key: string;
  vendor: string;
  item: Record<string, unknown>;
  createdAt: string;
}

async function oracleRows(ctx: AuditContext): Promise<OracleRow[]> {
  const res = await fetch(`${ctx.vendorBase}/admin/bookings`);
  if (!res.ok) throw new Error(`vendor oracle answered ${res.status}`);
  const rows = (await res.json()) as AdminBooking[];
  return rows.map((r) => ({ key: r.key, vendor: r.vendor, item: r.item, createdAt: r.createdAt }));
}

export interface CompactFinding {
  kind: Finding["kind"];
  vendor: string;
  subject: string;
  summary: string;
  ledgerEvents: { event: string; at: string }[];
  vendorRows: { key: string; createdAt: string; item: Record<string, unknown> }[];
}

function compact(f: Finding): CompactFinding {
  return {
    kind: f.kind,
    vendor: f.vendor,
    subject: f.subject,
    summary: f.summary,
    ledgerEvents: f.ledgerEvidence.map((e) => ({ event: e.event, at: e.at })),
    vendorRows: f.vendorEvidence.map((r) => ({ key: r.key, createdAt: r.createdAt, item: r.item })),
  };
}

export async function listVendors(
  ctx: AuditContext,
): Promise<{ vendor: string; vendorRows: number; ledgerActions: number }[]> {
  const rows = await oracleRows(ctx);
  const events = ctx.ledger.events();
  const vendors = new Map<string, { vendorRows: number; ledgerActions: number }>();
  const bump = (name: string, field: "vendorRows" | "ledgerActions") => {
    const v = vendors.get(name) ?? { vendorRows: 0, ledgerActions: 0 };
    v[field]++;
    vendors.set(name, v);
  };
  for (const r of rows) bump(r.vendor, "vendorRows");
  for (const e of events) {
    if (e.event === "STAGED") bump(String(e.payload.vendor ?? "unknown"), "ledgerActions");
  }
  return [...vendors.entries()].map(([vendor, v]) => ({ vendor, ...v }));
}

export async function runReconciliation(
  ctx: AuditContext,
  args: { vendor?: string },
): Promise<{ checkedEvents: number; checkedRows: number; findings: CompactFinding[] }> {
  const rows = await oracleRows(ctx);
  const events = ctx.ledger.events();
  let findings = runChecks(events, rows);
  if (args.vendor) findings = findings.filter((f) => f.vendor === args.vendor);
  return { checkedEvents: events.length, checkedRows: rows.length, findings: findings.map(compact) };
}

export function actionTimeline(
  ctx: AuditContext,
  args: { actionId: string },
): { events: { event: string; at: string; payload: Record<string, unknown> }[] } {
  const events = ctx.ledger
    .events()
    .filter((e) => e.actionId === args.actionId)
    .map((e) => ({ event: e.event, at: e.at, payload: e.payload }));
  return { events };
}

export function saveReport(ctx: AuditContext, args: { markdown: string }): { path: string } {
  const dir = ctx.reportsDir ?? "reports";
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  const path = join(dir, `audit-${stamp}.md`);
  writeFileSync(path, args.markdown);
  return { path };
}
