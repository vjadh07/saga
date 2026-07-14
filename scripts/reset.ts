// Wipe ledger and vendor state so a rehearsal starts from zero.
import { mkdirSync, rmSync } from "node:fs";
import { wipeLedger } from "../src/ledger/ledger.js";
import { SqliteAuditStore } from "../src/verify/providers/store-sqlite.js";

const base = process.env.VENDOR_URL ?? "http://127.0.0.1:4100";
try {
  await fetch(`${base}/admin/reset`, { method: "POST" });
  console.log("vendor state reset via admin endpoint");
} catch {
  for (const f of ["data/vendors.db", "data/vendors.db-wal", "data/vendors.db-shm"]) {
    rmSync(f, { force: true });
  }
  console.log("vendor server not running, removed its database files");
}
// in place, never unlink: a running viewer must see the empty ledger
mkdirSync("data", { recursive: true });
wipeLedger(process.env.LEDGER_PATH ?? "data/ledger.db");
console.log("ledger wiped");

const auditStore = new SqliteAuditStore(process.env.AUDIT_DB_PATH ?? "data/audits.db");
auditStore.clearAll();
auditStore.close();
console.log("guest audit history wiped; deterministic Demo fixture remains unchanged");
