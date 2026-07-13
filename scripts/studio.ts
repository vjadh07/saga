// Serve the Saga audit workspace: npm run studio
// GET  /         the workspace, with a worked audit of the demo report embedded.
// POST /api/map   runs the live Claim Mapper on pasted text and returns the claim map.
// The demo audit runs once at startup (deterministic, no LLM). The input box calls the
// live mapper, which needs a logged-in Claude Code install.
import { createServer, type IncomingMessage } from "node:http";
import { runAudit } from "../src/verify/pipeline.js";
import { renderStudioPage } from "../src/verify/web/page.js";
import { analyzeInput, type AuditMode } from "../src/verify/mapview.js";
import { extractClaims } from "../src/verify/agent/extract.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW, demoAuditId } from "../src/verify/fixtures/demo.js";

try {
  process.loadEnvFile();
} catch {
  // no .env is fine
}

const result = runAudit({
  auditId: demoAuditId(),
  document: DEMO_DOCUMENT,
  claims: DEMO_CLAIMS,
  corpus: DEMO_CORPUS,
  now: DEMO_NOW,
});
const html = "<!doctype html>\n" + renderStudioPage(result);

const MODES = new Set<AuditMode>(["quick", "deep", "high_stakes"]);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 200_000) reject(new Error("input too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const port = Number(process.env.STUDIO_PORT ?? 4500);
createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/map") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}") as { text?: string; mode?: string };
      const text = (body.text ?? "").trim();
      if (!text) throw new Error("no text provided");
      const mode = MODES.has(body.mode as AuditMode) ? (body.mode as AuditMode) : "deep";
      const map = await analyzeInput(text, extractClaims, mode);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(map));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `claim mapping failed: ${message}` }));
    }
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(port, "127.0.0.1", () => {
  console.log(`Saga audit workspace on http://127.0.0.1:${port}`);
});
