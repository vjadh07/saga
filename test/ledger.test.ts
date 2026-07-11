import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "saga-ledger-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "ledger.db");
}

test("append returns the stored event with seq and timestamp", () => {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());

  const e = ledger.append({
    sagaId: "trip1",
    actionId: "a1",
    event: "STAGED",
    payload: { type: "flight.book" },
  });

  expect(e.seq).toBe(1);
  expect(e.sagaId).toBe("trip1");
  expect(e.event).toBe("STAGED");
  expect(e.payload).toEqual({ type: "flight.book" });
  expect(Date.parse(e.at)).not.toBeNaN();
});

test("events come back in append order, filterable by saga", () => {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());

  ledger.append({ sagaId: "t1", actionId: "a1", event: "STAGED", payload: {} });
  ledger.append({ sagaId: "t2", actionId: "b1", event: "STAGED", payload: {} });
  ledger.append({ sagaId: "t1", actionId: "a1", event: "CALLED", payload: {} });

  expect(ledger.events().map((e) => e.seq)).toEqual([1, 2, 3]);
  expect(ledger.events("t1").map((e) => e.event)).toEqual(["STAGED", "CALLED"]);
});

test("actions folds to last event per action and keeps staged payload", () => {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());

  ledger.append({ sagaId: "t1", actionId: "a1", event: "STAGED", payload: { type: "flight.book", params: { id: "F1" } } });
  ledger.append({ sagaId: "t1", actionId: "a1", event: "CALLED", payload: {} });
  ledger.append({ sagaId: "t1", actionId: "a2", event: "STAGED", payload: { type: "hotel.book" } });

  const actions = ledger.actions("t1");
  expect(actions).toHaveLength(2);
  const a1 = actions.find((a) => a.actionId === "a1")!;
  expect(a1.state).toBe("CALLED");
  expect(a1.staged).toEqual({ type: "flight.book", params: { id: "F1" } });
  expect(a1.events).toHaveLength(2);
  const a2 = actions.find((a) => a.actionId === "a2")!;
  expect(a2.state).toBe("STAGED");
});

test("inFlight excludes terminal states", () => {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());

  ledger.append({ sagaId: "t1", actionId: "done", event: "STAGED", payload: {} });
  ledger.append({ sagaId: "t1", actionId: "done", event: "COMMITTED", payload: {} });
  ledger.append({ sagaId: "t1", actionId: "undone", event: "STAGED", payload: {} });
  ledger.append({ sagaId: "t1", actionId: "undone", event: "COMPENSATED", payload: {} });
  ledger.append({ sagaId: "t1", actionId: "open", event: "CALLED", payload: {} });

  expect(ledger.inFlight("t1").map((a) => a.actionId)).toEqual(["open"]);
});

test("events survive close and reopen of the same file", () => {
  const path = tempDb();
  const first = new Ledger(path);
  first.append({ sagaId: "t1", actionId: "a1", event: "STAGED", payload: { p: 1 } });
  first.close();

  const second = new Ledger(path);
  cleanups.push(() => second.close());
  const events = second.events("t1");
  expect(events).toHaveLength(1);
  expect(events[0]!.payload).toEqual({ p: 1 });
});

test("appends are visible to a second open handle on the same file", () => {
  const path = tempDb();
  const writer = new Ledger(path);
  const reader = new Ledger(path);
  cleanups.push(() => writer.close(), () => reader.close());

  writer.append({ sagaId: "t1", actionId: "a1", event: "STAGED", payload: {} });
  expect(reader.events("t1")).toHaveLength(1);
});
