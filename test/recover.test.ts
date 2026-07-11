// Crash simulation: every ledger append is synchronous and durable, so the
// state after kill -9 is exactly (ledger events so far, vendor world state).
// These tests construct that state directly, then run a fresh engine's
// recover() against the same ledger and the same vendor world.
// Task 9 covers a real SIGKILL of a live process on top of this.
import { afterEach, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { Saga, type StagedAction } from "../src/core/saga.js";
import type { ReconcileVerdict, VendorAdapter } from "../src/vendors/types.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

class WorldVendor implements VendorAdapter {
  calls = 0;
  booked = new Set<string>();

  async call(action: StagedAction): Promise<Record<string, unknown>> {
    this.calls++;
    this.booked.add(action.actionId);
    return { ok: true };
  }

  async reconcile(actionId: string): Promise<ReconcileVerdict> {
    return { landed: this.booked.has(actionId) };
  }

  async compensate(action: StagedAction): Promise<void> {
    this.booked.delete(action.actionId);
  }
}

function crashScene() {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());
  const world = new WorldVendor();
  const before = new Saga({ ledger, vendors: { v: world } });
  const staged = before.stage({ sagaId: "t", type: "x.do", vendor: "v", params: {} });
  // fresh engine after the "crash", same ledger, same world
  const after = new Saga({ ledger, vendors: { v: world } });
  return { ledger, world, staged, after };
}

test("crash after STAGED: recovery executes the declared intent once", async () => {
  const { ledger, world, staged, after } = crashScene();

  const recovered = await after.recover("t");

  expect(world.calls).toBe(1);
  expect(world.booked.has(staged.actionId)).toBe(true);
  expect(recovered.map((a) => a.state)).toEqual(["COMMITTED"]);
  expect(ledger.events("t").at(-1)!.event).toBe("COMMITTED");
});

test("crash after CALLED, call never sent: recovery reconciles then completes once", async () => {
  const { ledger, world, staged, after } = crashScene();
  ledger.append({ sagaId: "t", actionId: staged.actionId, event: "CALLED", payload: { attempt: 1 } });

  await after.recover("t");

  expect(world.calls).toBe(1);
  const events = ledger.events("t").map((e) => e.event);
  expect(events.at(-1)).toBe("COMMITTED");
  // ground truth checked before any re-call
  expect(events).toEqual(["STAGED", "CALLED", "RECONCILED", "CALLED", "RECONCILED", "COMMITTED"]);
});

test("crash after CALLED, call landed: recovery must NOT call again (no double booking)", async () => {
  const { ledger, world, staged, after } = crashScene();
  ledger.append({ sagaId: "t", actionId: staged.actionId, event: "CALLED", payload: { attempt: 1 } });
  world.booked.add(staged.actionId); // the world already has the booking

  await after.recover("t");

  expect(world.calls).toBe(0);
  expect(ledger.events("t").at(-1)!.event).toBe("COMMITTED");
});

test("crash after RECONCILED, before COMMITTED: recovery commits without re-calling", async () => {
  const { ledger, world, staged, after } = crashScene();
  ledger.append({ sagaId: "t", actionId: staged.actionId, event: "CALLED", payload: { attempt: 1 } });
  world.booked.add(staged.actionId);
  ledger.append({ sagaId: "t", actionId: staged.actionId, event: "RECONCILED", payload: { landed: true } });

  await after.recover("t");

  expect(world.calls).toBe(0);
  expect(ledger.events("t").at(-1)!.event).toBe("COMMITTED");
});

test("recover is idempotent: nothing in flight means nothing to do", async () => {
  const { after } = crashScene();
  await after.recover("t");
  const second = await after.recover("t");
  expect(second).toEqual([]);
});
