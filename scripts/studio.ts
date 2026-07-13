// Serve the Saga audit workspace for the demo document: npm run studio
// The audit runs once at startup (deterministic) and is embedded in the page.
import { createServer } from "node:http";
import { runAudit } from "../src/verify/pipeline.js";
import { renderStudioPage } from "../src/verify/web/page.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW, demoAuditId } from "../src/verify/fixtures/demo.js";

const result = runAudit({
  auditId: demoAuditId(),
  document: DEMO_DOCUMENT,
  claims: DEMO_CLAIMS,
  corpus: DEMO_CORPUS,
  now: DEMO_NOW,
});
const html = "<!doctype html>\n" + renderStudioPage(result);

const port = Number(process.env.STUDIO_PORT ?? 4500);
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(port, "127.0.0.1", () => {
  console.log(`Saga audit workspace on http://127.0.0.1:${port}`);
});
