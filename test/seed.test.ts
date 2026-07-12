import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { seed } from "../src/audit/seed.js";
import { runChecks, type OracleRow } from "../src/audit/checks.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function scene() {
  const dir = mkdtempSync(join(tmpdir(), "saga-seed-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return { ledgerPath: join(dir, "ledger.db"), vendorDbPath: join(dir, "vendors.db") };
}

function oracleRows(vendorDbPath: string): OracleRow[] {
  const db = new DatabaseSync(vendorDbPath);
  const rows = db.prepare("SELECT * FROM bookings").all() as unknown as {
    key: string; vendor: string; item: string; created_at: string;
  }[];
  db.close();
  return rows.map((r) => ({
    key: r.key,
    vendor: r.vendor,
    item: JSON.parse(r.item) as Record<string, unknown>,
    createdAt: r.created_at,
  }));
}

test("seed produces a substantial history with exactly the planted breaks", async () => {
  const { ledgerPath, vendorDbPath } = scene();
  const summary = await seed({ ledgerPath, vendorDbPath });

  expect(summary.actions).toBeGreaterThanOrEqual(100);
  expect(summary.planted).toHaveLength(5);

  const ledger = new Ledger(ledgerPath);
  cleanups.push(() => ledger.close());
  const findings = runChecks(ledger.events(), oracleRows(vendorDbPath));

  const byKind = (k: string) => findings.filter((f) => f.kind === k);
  expect(byKind("SHADOW_EFFECT")).toHaveLength(2);
  expect(byKind("DUPLICATE_CHARGE")).toHaveLength(1);
  expect(byKind("PHANTOM_COMPENSATION")).toHaveLength(1);
  expect(byKind("WEDGED_SAGA")).toHaveLength(1);
  expect(findings).toHaveLength(5);
  // deterministic: planted subjects match what runChecks finds
  expect(findings.map((f) => f.subject).sort()).toEqual(summary.planted.map((p) => p.subject).sort());
});

test("seeding twice from scratch is deterministic", async () => {
  const a = scene();
  const b = scene();
  const s1 = await seed({ ledgerPath: a.ledgerPath, vendorDbPath: a.vendorDbPath });
  const s2 = await seed({ ledgerPath: b.ledgerPath, vendorDbPath: b.vendorDbPath });
  expect(s1.actions).toBe(s2.actions);
  expect(s1.planted.map((p) => p.kind)).toEqual(s2.planted.map((p) => p.kind));
});
