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

test("the hosted worker serves the public Demo and no Live API", async () => {
  const source = renderHostedDemoWorker(demo);
  const sandbox: Record<string, unknown> = { Request, Response, URL };
  new Script(source.replace("export default", "globalThis.__worker =")).runInNewContext(sandbox);
  const worker = sandbox.__worker as { fetch(request: Request): Response };

  const response = worker.fetch(new Request("https://saga.example/demo"));
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("Demo: fixed fictional example.");
  expect(html).toContain('"hostedDemoOnly":true');
  expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");

  const missing = worker.fetch(new Request("https://saga.example/api/audits"));
  expect(missing.status).toBe(404);
});
