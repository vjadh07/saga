import { expect, test } from "vitest";
import type { LedgerEvent } from "../src/ledger/types.js";
import { runChecks, type OracleRow } from "../src/audit/checks.js";

let seq = 0;
function ev(
  actionId: string,
  event: LedgerEvent["event"],
  payload: Record<string, unknown> = {},
  sagaId = "s1",
): LedgerEvent {
  return { seq: ++seq, sagaId, actionId, event, payload, at: `2026-07-0${(seq % 9) + 1}T00:00:00.000Z` };
}
function committed(actionId: string, vendor: string, params: Record<string, unknown>): LedgerEvent[] {
  return [
    ev(actionId, "STAGED", { type: "hotel.book", vendor, params }),
    ev(actionId, "CALLED", { attempt: 1 }),
    ev(actionId, "RECONCILED", { landed: true }),
    ev(actionId, "COMMITTED"),
  ];
}
function row(key: string, vendor: string, item: Record<string, unknown>): OracleRow {
  return { key, vendor, item, createdAt: "2026-07-01T00:00:00.000Z" };
}

test("clean history yields zero findings", () => {
  const events = committed("aaa", "hotels", { hotelId: "H100" });
  const rows = [row("aaa", "hotels", { hotelId: "H100" })];
  expect(runChecks(events, rows)).toEqual([]);
});

test("vendor row with no staged intent is a SHADOW_EFFECT", () => {
  const events = committed("aaa", "hotels", { hotelId: "H100" });
  const rows = [row("aaa", "hotels", { hotelId: "H100" }), row("zzz", "hotels", { hotelId: "H300" })];
  const findings = runChecks(events, rows);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.kind).toBe("SHADOW_EFFECT");
  expect(findings[0]!.subject).toBe("zzz");
  expect(findings[0]!.vendorEvidence).toHaveLength(1);
});

test("unknown row duplicating a known booking's item is a DUPLICATE_CHARGE", () => {
  const events = committed("aaa", "hotels", { hotelId: "H100" });
  const rows = [row("aaa", "hotels", { hotelId: "H100" }), row("zzz", "hotels", { hotelId: "H100" })];
  const findings = runChecks(events, rows);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.kind).toBe("DUPLICATE_CHARGE");
  // evidence carries both the legit row and the duplicate
  expect(findings[0]!.vendorEvidence).toHaveLength(2);
});

test("COMPENSATED on ledger but row still at vendor is a PHANTOM_COMPENSATION", () => {
  const events = [
    ...committed("aaa", "hotels", { hotelId: "H100" }),
    ev("aaa", "COMPENSATION_CALLED"),
    ev("aaa", "COMPENSATED"),
  ];
  const rows = [row("aaa", "hotels", { hotelId: "H100" })];
  const findings = runChecks(events, rows);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.kind).toBe("PHANTOM_COMPENSATION");
  expect(findings[0]!.subject).toBe("aaa");
});

test("non-terminal and ABORTED actions are WEDGED_SAGA findings", () => {
  const events = [
    ev("stuck", "STAGED", { type: "hotel.book", vendor: "hotels", params: {} }),
    ev("stuck", "CALLED", { attempt: 1 }),
    ev("dead", "STAGED", { type: "flight.book", vendor: "flights", params: {} }),
    ev("dead", "CALLED", { attempt: 1 }),
    ev("dead", "RECONCILED", { landed: false }),
    ev("dead", "CALLED", { attempt: 2 }),
    ev("dead", "RECONCILED", { landed: false }),
    ev("dead", "ABORTED", { attempts: 2 }),
  ];
  const findings = runChecks(events, []);
  expect(findings.map((f) => f.kind)).toEqual(["WEDGED_SAGA", "WEDGED_SAGA"]);
  expect(findings.map((f) => f.subject).sort()).toEqual(["dead", "stuck"]);
});
