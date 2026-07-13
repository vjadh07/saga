import { expect, test } from "vitest";
import { runAudit } from "../src/verify/pipeline.js";
import { renderFlightLog, renderMarkdown } from "../src/verify/render.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW } from "../src/verify/fixtures/demo.js";

const r = runAudit({ auditId: "aud", document: DEMO_DOCUMENT, claims: DEMO_CLAIMS, corpus: DEMO_CORPUS, now: DEMO_NOW });

test("markdown report carries the passport, lineage headline, and claim verdicts", () => {
  const md = renderMarkdown(r);
  expect(md).toContain("Document status: **Materially contradicted**");
  expect(md).toContain("independent evidence origins");
  expect(md).toMatch(/sources cited, but only \d+ independent evidence origins/);
  expect(md).toContain("Contradicted");
  expect(md).toContain("Not objectively verifiable");
  expect(md).toContain("Corrected draft (proposed, pending approval)");
  expect(md).not.toContain("—"); // no em dash
});

test("flight log renders one readable line per event", () => {
  const log = renderFlightLog(r);
  expect(log).toMatch(/Extracted 5 verifiable claims/);
  expect(log).toMatch(/Prompt injection quarantined from reviewspam/);
  expect(log).toMatch(/sources traced to one origin/);
  expect(log.split("\n").length).toBe(r.flight.length);
});
