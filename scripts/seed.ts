// Wipe and reseed the demo world: a month of history plus 5 planted breaks.
import { mkdirSync, rmSync } from "node:fs";
import { seed } from "../src/audit/seed.js";
import { wipeLedger } from "../src/ledger/ledger.js";

mkdirSync("data", { recursive: true });
wipeLedger(process.env.LEDGER_PATH ?? "data/ledger.db");
for (const f of ["data/vendors.db", "data/vendors.db-wal", "data/vendors.db-shm"]) {
  rmSync(f, { force: true });
}
const summary = await seed({
  ledgerPath: process.env.LEDGER_PATH ?? "data/ledger.db",
  vendorDbPath: process.env.VENDOR_DB ?? "data/vendors.db",
});
console.log(`seeded ${summary.sagas} sagas, ${summary.actions} actions`);
console.log("planted breaks (keep this list handy for rehearsal):");
for (const p of summary.planted) console.log(`  ${p.kind}  ${p.subject}`);
console.log("note: restart the vendor server if it was running (its db file was replaced)");
