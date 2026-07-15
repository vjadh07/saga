import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { expect, test } from "vitest";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW } from "../src/verify/fixtures/demo.js";
import { runAudit } from "../src/verify/pipeline.js";
import { renderHostedDemoWorker } from "../src/verify/web/hosted-worker.js";

const demo = runAudit({
  auditId: "hosted-demo",
  document: DEMO_DOCUMENT,
  claims: DEMO_CLAIMS,
  corpus: DEMO_CORPUS,
  now: DEMO_NOW,
});

const landingPage = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");

test("the hosted worker serves the landing page and Live-enabled public workspace", async () => {
  const source = renderHostedDemoWorker(demo, landingPage);
  const sandbox: Record<string, unknown> = { Request, Response, URL };
  new Script(source.replace("export default", "globalThis.__worker =")).runInNewContext(sandbox);
  const worker = sandbox.__worker as { fetch(request: Request): Response };

  const landingResponse = worker.fetch(new Request("https://saga.example/"));
  expect(landingResponse.status).toBe(200);
  const landingHtml = await landingResponse.text();
  expect(landingHtml).toContain("Verify before");
  expect(landingHtml).toContain('href="/demo"');
  expect(landingHtml).not.toContain("127.0.0.1");

  const demoResponse = worker.fetch(new Request("https://saga.example/demo"));
  expect(demoResponse.status).toBe(200);
  const demoHtml = await demoResponse.text();
  expect(demoHtml).toContain("Demo: fixed fictional example.");
  expect(demoHtml).toContain('"hostedLiveEndpoint":"/api/live-audit"');
  expect(demoHtml).toContain('id="view-live" aria-pressed="true"');
  expect(demoResponse.headers.get("content-security-policy")).toContain("connect-src 'self'");
  expect(demoResponse.headers.get("content-security-policy")).toContain("font-src 'self' data:");

  const missing = worker.fetch(new Request("https://saga.example/api/audits"));
  expect(missing.status).toBe(404);
});
