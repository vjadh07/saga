import { mkdirSync, writeFileSync } from "node:fs";
import { runAudit } from "../src/verify/pipeline.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW, demoAuditId } from "../src/verify/fixtures/demo.js";
import { renderHostedDemoWorker } from "../src/verify/web/hosted-worker.js";

const demo = runAudit({
  auditId: demoAuditId(),
  document: DEMO_DOCUMENT,
  claims: DEMO_CLAIMS,
  corpus: DEMO_CORPUS,
  now: DEMO_NOW,
});

mkdirSync("dist/server", { recursive: true });
writeFileSync("dist/server/index.js", renderHostedDemoWorker(demo), "utf8");
console.log("Built the public deterministic Saga Demo.");
