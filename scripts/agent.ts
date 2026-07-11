// Run the booking agent against the local vendors. Recovery always runs
// before the model starts, so a restart after kill -9 picks up cleanly.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { Ledger } from "../src/ledger/ledger.js";
import { Saga } from "../src/core/saga.js";
import { crashAfter } from "../src/core/crash.js";
import { httpVendor } from "../src/vendors/http-adapter.js";
import { calendarVendor, type CalendarClient } from "../src/vendors/calendar.js";
import { runAgent } from "../src/agent/run.js";
import type { TripContext } from "../src/agent/tools.js";
import type { VendorAdapter } from "../src/vendors/types.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file is fine
}

const vendorBase = process.env.VENDOR_URL ?? "http://127.0.0.1:4100";
const ledgerPath = process.env.LEDGER_PATH ?? "data/ledger.db";
const sagaId = process.env.SAGA_ID ?? "trip";
mkdirSync("data", { recursive: true });

// the one real integration: Google Calendar, used only when the one-time
// OAuth has been done (see scripts/gcal-auth.ts); otherwise the mock stands in
const TOKEN_PATH = ".secrets/gcal-token.json";
async function pickCalendar(): Promise<VendorAdapter> {
  const { GCAL_CLIENT_ID, GCAL_CLIENT_SECRET } = process.env;
  if (!GCAL_CLIENT_ID || !GCAL_CLIENT_SECRET || !existsSync(TOKEN_PATH)) {
    console.log("[calendar] mock vendor (run npm run gcal-auth to go real)");
    return httpVendor(vendorBase, "calendar");
  }
  const { google } = await import("googleapis");
  const auth = new google.auth.OAuth2(GCAL_CLIENT_ID, GCAL_CLIENT_SECRET);
  auth.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, "utf8")));
  console.log("[calendar] real Google Calendar");
  // googleapis method overloads do not structurally match the narrow injected
  // interface; the runtime shape does (params object in, { data } out)
  const client = google.calendar({ version: "v3", auth }) as unknown as CalendarClient;
  return calendarVendor(client, {
    calendarId: process.env.GCAL_CALENDAR_ID ?? "primary",
  });
}

const ledger = new Ledger(ledgerPath);
const saga = new Saga({
  ledger,
  vendors: {
    flights: httpVendor(vendorBase, "flights"),
    hotels: httpVendor(vendorBase, "hotels"),
    calendar: await pickCalendar(),
  },
  onEvent: crashAfter(process.env.CRASH_AFTER),
});

const recovered = await saga.recover(sagaId);
if (recovered.length > 0) {
  console.log(
    `[recovery] reconciled ${recovered.length} in-flight action(s) left by a previous life:`,
  );
  for (const a of recovered) console.log(`  ${a.actionId} -> ${a.state}`);
}

const promptText = process.argv.slice(2).join(" ").trim();
if (!promptText) {
  console.error('usage: npm run agent -- "book me a trip to SF next weekend"');
  process.exit(2);
}

const ctx: TripContext = { saga, sagaId, vendorBase };
await runAgent(ctx, promptText);

console.log("\n=== ledger receipt ===");
const receipt = saga.receipt(sagaId);
console.log(`trip ${receipt.sagaId}: ${receipt.status}`);
for (const a of receipt.actions) {
  console.log(`  ${a.type.padEnd(14)} ${a.state.padEnd(12)} ${a.actionId}`);
}
ledger.close();
