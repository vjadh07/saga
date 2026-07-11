import { afterEach, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { Saga, type StagedAction } from "../src/core/saga.js";
import { CompensationError } from "../src/core/errors.js";
import type { ReconcileVerdict, VendorAdapter } from "../src/vendors/types.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

class WorldVendor implements VendorAdapter {
  compensations: string[] = [];
  booked = new Set<string>();

  async call(action: StagedAction): Promise<Record<string, unknown>> {
    this.booked.add(action.actionId);
    return { ok: true };
  }

  async reconcile(actionId: string): Promise<ReconcileVerdict> {
    return { landed: this.booked.has(actionId) };
  }

  async compensate(action: StagedAction): Promise<void> {
    this.compensations.push(action.actionId);
    this.booked.delete(action.actionId);
  }
}

// compensate "succeeds" but the world still shows the effect
class LyingCompensator extends WorldVendor {
  override async compensate(action: StagedAction): Promise<void> {
    this.compensations.push(action.actionId);
  }
}

class FailOnceCompensator extends WorldVendor {
  constructor(private failFor: string[]) {
    super();
  }

  override async compensate(action: StagedAction): Promise<void> {
    const i = this.failFor.indexOf(action.actionId);
    if (i >= 0) {
      this.failFor.splice(i, 1);
      throw new Error("compensation endpoint timed out");
    }
    await super.compensate(action);
  }
}

async function committedTrip(vendor: WorldVendor, count: number) {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());
  const saga = new Saga({ ledger, vendors: { v: vendor } });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const staged = saga.stage({ sagaId: "t", type: `step${i}.do`, vendor: "v", params: {} });
    await saga.execute(staged.actionId);
    ids.push(staged.actionId);
  }
  return { ledger, saga, ids };
}

test("cancel unwinds in reverse commit order and empties the world", async () => {
  const world = new WorldVendor();
  const { ledger, saga, ids } = await committedTrip(world, 3);

  const done = await saga.cancel("t");

  expect(world.compensations).toEqual([ids[2], ids[1], ids[0]]);
  expect(world.booked.size).toBe(0);
  expect(done.map((a) => a.state)).toEqual(["COMPENSATED", "COMPENSATED", "COMPENSATED"]);
  expect(ledger.inFlight("t")).toEqual([]);
});

test("COMPENSATED requires ground truth confirming the effect is gone", async () => {
  const world = new LyingCompensator();
  const { ledger, saga } = await committedTrip(world, 1);

  await expect(saga.cancel("t")).rejects.toThrow(CompensationError);
  const events = ledger.events("t").map((e) => e.event);
  expect(events.at(-1)).toBe("COMPENSATION_CALLED");
  expect(events).not.toContain("COMPENSATED");
});

test("a mid-list compensation failure is resumable by rerunning cancel", async () => {
  const world = new FailOnceCompensator([]);
  const { ledger, saga, ids } = await committedTrip(world, 3);
  world["failFor"].push(ids[1]!); // arm the middle action after booking

  await expect(saga.cancel("t")).rejects.toThrow(CompensationError);

  const stateOf = (id: string) =>
    ledger.actions("t").find((a) => a.actionId === id)!.state;
  expect(stateOf(ids[2]!)).toBe("COMPENSATED");
  expect(stateOf(ids[1]!)).toBe("COMPENSATION_CALLED");
  expect(stateOf(ids[0]!)).toBe("COMMITTED");

  await saga.cancel("t");

  expect(world.booked.size).toBe(0);
  expect(ledger.actions("t").every((a) => a.state === "COMPENSATED")).toBe(true);
  // unwind order held across both runs: newest first overall
  expect(world.compensations).toEqual([ids[2], ids[1], ids[0]]);
});

test("recover resumes an interrupted compensation", async () => {
  const world = new WorldVendor();
  const { ledger, ids } = await committedTrip(world, 1);
  // crash happened right after COMPENSATION_CALLED was recorded
  ledger.append({ sagaId: "t", actionId: ids[0]!, event: "COMPENSATION_CALLED", payload: {} });

  const fresh = new Saga({ ledger, vendors: { v: world } });
  await fresh.recover("t");

  expect(world.booked.size).toBe(0);
  expect(ledger.actions("t")[0]!.state).toBe("COMPENSATED");
});

test("receipt summarizes saga status, action states, and timelines", async () => {
  const world = new WorldVendor();
  const { saga, ids } = await committedTrip(world, 2);

  const before = saga.receipt("t");
  expect(before.status).toBe("committed");
  expect(before.actions).toHaveLength(2);
  expect(before.actions[0]!.type).toBe("step0.do");
  expect(before.actions[0]!.timeline.map((t) => t.event)).toEqual([
    "STAGED",
    "CALLED",
    "RECONCILED",
    "COMMITTED",
  ]);

  await saga.cancel("t");
  const after = saga.receipt("t");
  expect(after.status).toBe("compensated");
  expect(after.actions.map((a) => a.state)).toEqual(["COMPENSATED", "COMPENSATED"]);
  expect(after.actions.map((a) => a.actionId)).toEqual(ids);
});
