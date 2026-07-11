// Wipe ledger and vendor state so a rehearsal starts from zero.
import { rmSync } from "node:fs";

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
for (const f of ["data/ledger.db", "data/ledger.db-wal", "data/ledger.db-shm"]) {
  rmSync(f, { force: true });
}
console.log("ledger wiped");
