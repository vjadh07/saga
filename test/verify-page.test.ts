import { expect, test } from "vitest";
import { runAudit } from "../src/verify/pipeline.js";
import { renderStudioPage } from "../src/verify/web/page.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW } from "../src/verify/fixtures/demo.js";

const html = renderStudioPage(
  runAudit({ auditId: "aud", document: DEMO_DOCUMENT, claims: DEMO_CLAIMS, corpus: DEMO_CORPUS, now: DEMO_NOW }),
);

test("the page embeds the audit data and key surfaces", () => {
  expect(html).toContain("Materially contradicted");
  expect(html).toContain("Trust Passport");
  expect(html).toContain("Agent Flight Recorder");
  expect(html).toContain("Source lineage");
  expect(html).toContain("Safety Sentinel");
  // the embedded JSON carries the real claim audits
  expect(html).toContain("nw-release");
  expect(html).toContain("reviewspam");
});

test("the page is fully self-contained: no external resources", () => {
  expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)[^"']*\.(?:css|js|woff2?|png|jpg|svg)/);
  expect(html).not.toMatch(/<link[^>]+href=["']https?:/);
  expect(html).not.toMatch(/<script[^>]+src=/);
});

test("no em dashes on the page", () => {
  expect(html.includes("—")).toBe(false);
  expect(html.includes("–")).toBe(false);
});

test("the embedded audit JSON is valid and parseable by the client", () => {
  const m = html.match(/<script id="audit" type="application\/json">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  const raw = m![1]!.replace(/\\u003c/g, "<");
  const parsed = JSON.parse(raw);
  expect(parsed.claimAudits).toHaveLength(5);
  expect(parsed.passport.documentStatus).toBe("materially_contradicted");
});
