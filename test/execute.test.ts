import { afterEach, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { Saga, type StagedAction } from "../src/core/saga.js";
import { SagaExecutionError } from "../src/core/errors.js";
import type { VendorAdapter } from "../src/vendors/types.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

class FakeVendor implements VendorAdapter {
  calls: StagedAction[] = [];
  booked = new Set<string>();

  async call(action: StagedAction): Promise<Record<string, unknown>> {
    this.calls.push(action);
    this.booked.add(action.actionId);
    return { confirmation: `ok-${action.actionId}` };
  }

  async reconcile(actionId: string): Promise<{ landed: boolean }> {
    return { landed: this.booked.has(actionId) };
  }

  async compensate(action: StagedAction): Promise<void> {
    this.booked.delete(action.actionId);
  }
}

class NeverLandsVendor extends FakeVendor {
  override async reconcile(): Promise<{ landed: boolean }> {
    return { landed: false };
  }
}

function setup(vendor: VendorAdapter) {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());
  const saga = new Saga({ ledger, vendors: { flights: vendor } });
  return { ledger, saga };
}

test("execute walks STAGED, CALLED, RECONCILED, COMMITTED with one vendor call", async () => {
  const vendor = new FakeVendor();
  const { ledger, saga } = setup(vendor);

  const staged = saga.stage({
    sagaId: "trip1",
    type: "flight.book",
    vendor: "flights",
    params: { flightId: "F1" },
  });
  const result = await saga.execute(staged.actionId);

  expect(ledger.events("trip1").map((e) => e.event)).toEqual([
    "STAGED",
    "CALLED",
    "RECONCILED",
    "COMMITTED",
  ]);
  expect(vendor.calls).toHaveLength(1);
  expect(vendor.calls[0]!.actionId).toBe(staged.actionId);
  expect(vendor.calls[0]!.params).toEqual({ flightId: "F1" });

  const reconciled = ledger.events("trip1").find((e) => e.event === "RECONCILED")!;
  expect(reconciled.payload.landed).toBe(true);
  expect(result.state).toBe("COMMITTED");
});

test("execute refuses to commit when ground truth never confirms", async () => {
  const vendor = new NeverLandsVendor();
  const { ledger, saga } = setup(vendor);

  const staged = saga.stage({
    sagaId: "trip1",
    type: "flight.book",
    vendor: "flights",
    params: {},
  });

  await expect(saga.execute(staged.actionId)).rejects.toThrow(SagaExecutionError);
  const events = ledger.events("trip1").map((e) => e.event);
  expect(events).not.toContain("COMMITTED");
});
