import { expect, test } from "vitest";
import type { Verdict, VerdictKind } from "../src/verify/types.js";
import { buildPassport } from "../src/verify/passport.js";

const NOW = "2026-07-10T00:00:00.000Z";
function v(verdict: VerdictKind): Verdict {
  const needsFix = !["supported", "not_verifiable"].includes(verdict);
  return {
    claimId: "c",
    verdict,
    confidence: "medium",
    rationale: "",
    supporting: [],
    contradicting: [],
    independentOrigins: 1,
    temporal: null,
    requiredCorrection: needsFix ? "fix it" : null,
  };
}

test("all verifiable claims cleanly supported yields strongly supported", () => {
  const p = buildPassport({ verdicts: [v("supported"), v("supported"), v("supported")], primarySourceCount: 2, independentOrigins: 3, now: NOW });
  expect(p.documentStatus).toBe("strongly_supported");
  expect(p.totalClaims).toBe(3);
  expect(p.supported).toBe(3);
  expect(p.claimsRequiringRevision).toBe(0);
});

test("mostly supported with a qualification and no falsehoods", () => {
  const p = buildPassport({
    verdicts: [v("supported"), v("supported"), v("supported"), v("supported"), v("supported_with_qualifications")],
    primarySourceCount: 3,
    independentOrigins: 4,
    now: NOW,
  });
  expect(p.documentStatus).toBe("mostly_supported");
  expect(p.qualified).toBe(1);
  expect(p.claimsRequiringRevision).toBe(1);
});

test("a contradicted plus outdated claim among few makes the document materially contradicted", () => {
  const p = buildPassport({
    verdicts: [v("supported"), v("contradicted"), v("outdated"), v("supported_with_qualifications"), v("not_verifiable")],
    primarySourceCount: 2,
    independentOrigins: 3,
    now: NOW,
  });
  expect(p.documentStatus).toBe("materially_contradicted");
  expect(p.contradicted).toBe(1);
  expect(p.outdated).toBe(1);
  expect(p.notVerifiable).toBe(1);
  // subjective claims do not count against the verifiable ratio but are still tallied
  expect(p.totalClaims).toBe(5);
});

test("mostly unverifiable evidence yields insufficiently supported", () => {
  const p = buildPassport({
    verdicts: [v("supported"), v("insufficient_evidence"), v("insufficient_evidence"), v("insufficient_evidence")],
    primarySourceCount: 0,
    independentOrigins: 1,
    now: NOW,
  });
  expect(p.documentStatus).toBe("insufficiently_supported");
  expect(p.insufficient).toBe(3);
});

test("passport records provenance metrics and a verification timestamp", () => {
  const p = buildPassport({ verdicts: [v("supported")], primarySourceCount: 4, independentOrigins: 6, now: NOW });
  expect(p.primarySourceCount).toBe(4);
  expect(p.independentOrigins).toBe(6);
  expect(p.lastVerifiedAt).toBe(NOW);
});
