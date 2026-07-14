import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runAudit } from "../src/verify/pipeline.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW, demoAuditId } from "../src/verify/fixtures/demo.js";
import { renderHostedDemoPage, renderHostedDemoWorker } from "../src/verify/web/hosted-worker.js";

const demo = runAudit({
  auditId: demoAuditId(),
  document: DEMO_DOCUMENT,
  claims: DEMO_CLAIMS,
  corpus: DEMO_CORPUS,
  now: DEMO_NOW,
});
const landingPage = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");

mkdirSync("dist/server", { recursive: true });
mkdirSync("docs", { recursive: true });
mkdirSync("docs/demo", { recursive: true });
writeFileSync("dist/server/index.js", renderHostedDemoWorker(demo, landingPage), "utf8");
writeFileSync("docs/index.html", landingPage, "utf8");
writeFileSync("docs/demo/index.html", renderHostedDemoPage(demo), "utf8");
console.log("Built the Saga landing page and public deterministic Demo.");
