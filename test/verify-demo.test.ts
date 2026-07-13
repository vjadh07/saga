import { expect, test } from "vitest";
import { runAudit } from "../src/verify/pipeline.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW } from "../src/verify/fixtures/demo.js";

function run() {
  return runAudit({ auditId: "aud-demo", document: DEMO_DOCUMENT, claims: DEMO_CLAIMS, corpus: DEMO_CORPUS, now: DEMO_NOW });
}
const verdictOf = (r: ReturnType<typeof run>, id: string) => r.claimAudits.find((a) => a.claim.id === id)!.verdict;

test("the demo produces the five designed verdicts", () => {
  const r = run();
  expect(r.claimAudits).toHaveLength(5);
  expect(verdictOf(r, "shipments").verdict).toBe("supported");
  expect(verdictOf(r, "shipments").confidence).toBe("high");
  expect(verdictOf(r, "lifespan").verdict).toBe("contradicted");
  expect(verdictOf(r, "market_lead").verdict).toBe("outdated");
  expect(verdictOf(r, "recyclable").verdict).toBe("supported_with_qualifications");
  expect(verdictOf(r, "experience").verdict).toBe("not_verifiable");
});

test("the injection is quarantined and never becomes evidence", () => {
  const r = run();
  expect(r.safetyEvents.some((e) => e.sourceId === "reviewspam" && e.action === "quarantined")).toBe(true);
  expect(r.flight.some((e) => e.type === "INJECTION_QUARANTINED")).toBe(true);
  expect(r.flight.some((e) => e.type === "SOURCE_REJECTED")).toBe(true);
  // the false lifespan claim gets no support from the poisoned page
  expect(verdictOf(r, "lifespan").supporting).toHaveLength(0);
});

test("the marquee moment: five syndicated sources resolve to one origin", () => {
  const r = run();
  const group = r.lineage.groups.find((g) => g.sourceIds.includes("nw-release"));
  expect(group).toBeDefined();
  expect(group!.sourceIds).toEqual(["nw-release", "wire-daily", "wire-energy", "wire-tech", "wire-watch"]);
  expect(group!.representativeSourceId).toBe("nw-release");
  // and the apparent support behind the market-lead claim collapses to a single origin
  expect(verdictOf(r, "market_lead").independentOrigins).toBe(1);
  expect(r.flight.some((e) => e.type === "TEMPORAL_FLAGGED" && e.claimId === "market_lead")).toBe(true);
});

test("the trust passport reports the document as materially contradicted", () => {
  const r = run();
  expect(r.passport.documentStatus).toBe("materially_contradicted");
  expect(r.passport.totalClaims).toBe(5);
  expect(r.passport.supported).toBe(1);
  expect(r.passport.contradicted).toBe(1);
  expect(r.passport.outdated).toBe(1);
  expect(r.passport.qualified).toBe(1);
  expect(r.passport.notVerifiable).toBe(1);
  expect(r.passport.primarySourceCount).toBeGreaterThanOrEqual(3);
});

test("the corrected draft changes exactly the three claims that need revision", () => {
  const r = run();
  expect(r.correctedDraft.changes.map((c) => c.claimId).sort()).toEqual(["lifespan", "market_lead", "recyclable"]);
  expect(r.correctedDraft.original).toBe(DEMO_DOCUMENT);
  expect(r.correctedDraft.draft).not.toContain("last 40 years with no loss of capacity");
});

test("the run is deterministic", () => {
  const a = run();
  const b = run();
  expect(JSON.stringify(a.claimAudits)).toBe(JSON.stringify(b.claimAudits));
  expect(JSON.stringify(a.passport)).toBe(JSON.stringify(b.passport));
});
