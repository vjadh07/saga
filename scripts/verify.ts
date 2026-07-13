// Run Saga's evidence audit over the deterministic demo document: npm run verify
// Add --json to print the raw result. The flight-recorder events are persisted to
// data/flight.db so the viewer and UI can replay them.
import { mkdirSync } from "node:fs";
import { runAudit } from "../src/verify/pipeline.js";
import { Recorder, wipeRecorder } from "../src/verify/recorder.js";
import { flightMarker, flightLine, renderMarkdown } from "../src/verify/render.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW, demoAuditId } from "../src/verify/fixtures/demo.js";

const asJson = process.argv.includes("--json");

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};
const markerColor = (m: string, s: string) => (m === "+" ? C.green(s) : m === "!" ? C.red(s) : C.dim(s));

const flightPath = process.env.FLIGHT_PATH ?? "data/flight.db";
mkdirSync("data", { recursive: true });
wipeRecorder(flightPath);
const recorder = new Recorder(flightPath);

const auditId = demoAuditId();
const result = runAudit({
  auditId,
  document: DEMO_DOCUMENT,
  claims: DEMO_CLAIMS,
  corpus: DEMO_CORPUS,
  now: DEMO_NOW,
  recorder,
});
recorder.close();

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log(C.bold("\nSaga: verifying the Northwind Energy 2026 Market Brief\n"));
console.log(C.dim("Submitted document:"));
for (const line of DEMO_DOCUMENT.split("\n")) console.log(C.dim(line ? `  ${line}` : ""));

console.log(C.bold("\nAgent Flight Recorder\n"));
for (const e of result.flight) {
  const m = flightMarker(e.type);
  console.log(`  ${markerColor(m, m)} ${flightLine(e)}`);
}

console.log("");
console.log(renderMarkdown(result));

const p = result.passport;
const statusColor = p.documentStatus === "strongly_supported" || p.documentStatus === "mostly_supported" ? C.green : C.red;
console.log(statusColor(C.bold(`Document status: ${p.documentStatus.replace(/_/g, " ")}`)));
console.log(C.dim(`${result.lineage.sourceCount} sources cited, ${result.lineage.independentOrigins} independent origins. ${p.claimsRequiringRevision} claim(s) need revision.`));
console.log(C.dim(`Flight log persisted to ${flightPath} (${result.flight.length} events).\n`));
