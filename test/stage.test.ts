import { afterEach, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import type { LedgerEvent } from "../src/ledger/types.js";
import { mintActionId } from "../src/core/ids.js";
import { Saga } from "../src/core/saga.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

test("minted ids are 26 chars of base32hex, calendar-safe", () => {
  const id = mintActionId();
  expect(id).toMatch(/^[a-v0-9]{26}$/);
});

test("1000 minted ids are unique", () => {
  const ids = new Set(Array.from({ length: 1000 }, () => mintActionId()));
  expect(ids.size).toBe(1000);
});

test("stage durably records intent before returning", () => {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());
  const saga = new Saga({ ledger });

  const staged = saga.stage({
    sagaId: "trip1",
    type: "flight.book",
    vendor: "flights",
    params: { flightId: "F1" },
  });

  expect(staged.actionId).toMatch(/^[a-v0-9]{26}$/);
  const events = ledger.events("trip1");
  expect(events).toHaveLength(1);
  expect(events[0]!.event).toBe("STAGED");
  expect(events[0]!.actionId).toBe(staged.actionId);
  expect(events[0]!.payload).toEqual({
    type: "flight.book",
    vendor: "flights",
    params: { flightId: "F1" },
  });
});

test("onEvent hook fires for every append", () => {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());
  const seen: LedgerEvent[] = [];
  const saga = new Saga({ ledger, onEvent: (e) => seen.push(e) });

  saga.stage({ sagaId: "t", type: "x", vendor: "v", params: {} });

  expect(seen).toHaveLength(1);
  expect(seen[0]!.event).toBe("STAGED");
});
