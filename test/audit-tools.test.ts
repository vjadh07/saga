import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { seed } from "../src/audit/seed.js";
import { startVendorServer, type VendorServer } from "../src/vendors/server.js";
import {
  actionTimeline,
  listVendors,
  runReconciliation,
  saveReport,
  type AuditContext,
} from "../src/agent/audit-tools.js";

let dir: string;
let server: VendorServer;
let ctx: AuditContext;
let ledger: Ledger;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "saga-audit-tools-"));
  const ledgerPath = join(dir, "ledger.db");
  const vendorDbPath = join(dir, "vendors.db");
  await seed({ ledgerPath, vendorDbPath });
  server = await startVendorServer({ dbPath: vendorDbPath, port: 0 });
  ledger = new Ledger(ledgerPath);
  ctx = { ledger, vendorBase: `http://127.0.0.1:${server.port}`, reportsDir: join(dir, "reports") };
});

afterAll(async () => {
  ledger.close();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

test("listVendors reports row and action counts per vendor", async () => {
  const vendors = await listVendors(ctx);
  const names = vendors.map((v) => v.vendor).sort();
  expect(names).toContain("hotels");
  expect(names).toContain("flights");
  const hotels = vendors.find((v) => v.vendor === "hotels")!;
  expect(hotels.vendorRows).toBeGreaterThan(0);
  expect(hotels.ledgerActions).toBeGreaterThan(0);
});

test("runReconciliation surfaces exactly the five planted breaks", async () => {
  const result = await runReconciliation(ctx, {});
  expect(result.findings).toHaveLength(5);
  expect(result.checkedEvents).toBeGreaterThan(100);
  const kinds = result.findings.map((f) => f.kind).sort();
  expect(kinds).toEqual([
    "DUPLICATE_CHARGE",
    "PHANTOM_COMPENSATION",
    "SHADOW_EFFECT",
    "SHADOW_EFFECT",
    "WEDGED_SAGA",
  ]);
});

test("runReconciliation can scope to one vendor", async () => {
  const flightsOnly = await runReconciliation(ctx, { vendor: "flights" });
  expect(flightsOnly.findings).toHaveLength(0); // all breaks are planted on hotels
});

test("actionTimeline returns the full event history for one action", async () => {
  const { findings } = await runReconciliation(ctx, {});
  const phantom = findings.find((f) => f.kind === "PHANTOM_COMPENSATION")!;
  const timeline = actionTimeline(ctx, { actionId: phantom.subject });
  const events = timeline.events.map((e) => e.event);
  expect(events[0]).toBe("STAGED");
  expect(events[events.length - 1]).toBe("COMPENSATED");
});

test("saveReport writes markdown under the reports dir", () => {
  const { path } = saveReport(ctx, { markdown: "# audit\nno findings" });
  expect(readFileSync(path, "utf8")).toContain("# audit");
  expect(path).toContain("reports");
});
