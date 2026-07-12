import { afterEach, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { Saga, type StagedAction } from "../src/core/saga.js";
import { SagaExecutionError } from "../src/core/errors.js";
import type { ReconcileVerdict, VendorAdapter } from "../src/vendors/types.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

// always fails, never lands: the abort case
class DeadVendor implements VendorAdapter {
  calls = 0;
  async call(_a: StagedAction): Promise<Record<string, unknown>> {
    this.calls++;
    throw new Error("vendor permanently down");
  }
  async reconcile(_id: string): Promise<ReconcileVerdict> {
    return { landed: false };
  }
  async compensate(_a: StagedAction): Promise<void> {}
}

function setup() {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());
  const vendor = new DeadVendor();
  const saga = new Saga({ ledger, vendors: { v: vendor } });
  const staged = saga.stage({ sagaId: "t", type: "x.do", vendor: "v", params: {} });
  return { ledger, vendor, saga, staged };
}

test("exhausted attempts append ABORTED as the terminal event", async () => {
  const { ledger, saga, staged } = setup();
  await expect(saga.execute(staged.actionId)).rejects.toThrow(SagaExecutionError);
  const events = ledger.events("t").map((e) => e.event);
  expect(events[events.length - 1]).toBe("ABORTED");
  expect(events).not.toContain("COMMITTED");
  const aborted = ledger.events("t").at(-1)!;
  expect(aborted.payload).toEqual({ attempts: 2 });
});

test("ABORTED is terminal: recover does nothing, receipt is not in_flight", async () => {
  const { ledger, vendor, saga, staged } = setup();
  await expect(saga.execute(staged.actionId)).rejects.toThrow(SagaExecutionError);

  const callsBefore = vendor.calls;
  expect(await saga.recover("t")).toEqual([]);
  expect(vendor.calls).toBe(callsBefore);
  expect(ledger.inFlight("t")).toEqual([]);
  expect(saga.receipt("t").status).toBe("mixed");
});

test("cancel ignores ABORTED actions", async () => {
  const { saga, staged } = setup();
  await expect(saga.execute(staged.actionId)).rejects.toThrow(SagaExecutionError);
  expect(await saga.cancel("t")).toEqual([]);
});
