import { expect, test } from "vitest";
import { runAudit } from "../src/verify/pipeline.js";
import { renderStudioRoute } from "../src/verify/web/studio-server.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW } from "../src/verify/fixtures/demo.js";

const demo = runAudit({
  auditId: "demo-studio",
  document: DEMO_DOCUMENT,
  claims: DEMO_CLAIMS,
  corpus: DEMO_CORPUS,
  now: DEMO_NOW,
});

function bootstrap(body: string): { initialView: string; activeAuditId: string | null; embeddedResult: { mode: string } } {
  const match = body.match(/<script id="studio-bootstrap" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Studio bootstrap was not rendered");
  return JSON.parse(match[1]!);
}

test("the Studio root defaults to Live and restores a valid persisted audit id", () => {
  const response = renderStudioRoute("/?audit=aud_123-safe", "GET", demo);

  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(bootstrap(response.body)).toMatchObject({
    initialView: "live",
    activeAuditId: "aud_123-safe",
    embeddedResult: { mode: "demo" },
  });
});

test("the guest demo route is explicit and deterministic", () => {
  const first = renderStudioRoute("/demo", "GET", demo);
  const second = renderStudioRoute("/demo", "GET", demo);

  expect(first.body).toBe(second.body);
  expect(bootstrap(first.body)).toMatchObject({
    initialView: "demo",
    activeAuditId: null,
    embeddedResult: { mode: "demo" },
  });
});

test("invalid audit ids are not embedded and unsupported routes fail closed", () => {
  expect(bootstrap(renderStudioRoute("/?audit=../../demo", "GET", demo).body).activeAuditId).toBeNull();
  expect(renderStudioRoute("/unknown", "GET", demo).status).toBe(404);
  expect(renderStudioRoute("/", "POST", demo)).toMatchObject({ status: 405, headers: { allow: "GET, HEAD" } });
});
