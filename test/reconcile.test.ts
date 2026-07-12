import { afterEach, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { Saga, type StagedAction } from "../src/core/saga.js";
import { SagaExecutionError } from "../src/core/errors.js";
import type { ReconcileVerdict, VendorAdapter } from "../src/vendors/types.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

// scriptable vendor: per-call behavior list, ground truth as a set
class ScriptedVendor implements VendorAdapter {
  calls = 0;
  reconciles = 0;
  booked = new Set<string>();

  constructor(
    private script: Array<"ok" | "throw" | "book_then_throw">,
    private reconcileMode: "truth" | "throw" = "truth",
  ) {}

  async call(action: StagedAction): Promise<Record<string, unknown>> {
    const behavior = this.script[this.calls] ?? "ok";
    this.calls++;
    if (behavior === "ok") {
      this.booked.add(action.actionId);
      return { ok: true };
    }
    if (behavior === "book_then_throw") {
      this.booked.add(action.actionId);
      throw new Error("network dropped after vendor did the work");
    }
    throw new Error("vendor call failed cleanly");
  }

  async reconcile(actionId: string): Promise<ReconcileVerdict> {
    this.reconciles++;
    if (this.reconcileMode === "throw") throw new Error("vendor unreachable");
    return { landed: this.booked.has(actionId) };
  }

  async compensate(action: StagedAction): Promise<void> {
    this.booked.delete(action.actionId);
  }
}

function setup(vendor: VendorAdapter) {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());
  const saga = new Saga({ ledger, vendors: { v: vendor } });
  const staged = saga.stage({ sagaId: "t", type: "x.do", vendor: "v", params: {} });
  return { ledger, saga, staged };
}

test("call throws but ground truth says landed: commit, no second call", async () => {
  const vendor = new ScriptedVendor(["book_then_throw"]);
  const { ledger, saga, staged } = setup(vendor);

  const result = await saga.execute(staged.actionId);

  expect(result.state).toBe("COMMITTED");
  expect(vendor.calls).toBe(1);
  expect(ledger.events("t").map((e) => e.event)).toEqual([
    "STAGED",
    "CALLED",
    "RECONCILED",
    "COMMITTED",
  ]);
});

test("call throws and did not land: retries once then commits", async () => {
  const vendor = new ScriptedVendor(["throw", "ok"]);
  const { ledger, saga, staged } = setup(vendor);

  const result = await saga.execute(staged.actionId);

  expect(result.state).toBe("COMMITTED");
  expect(vendor.calls).toBe(2);
  expect(ledger.events("t").map((e) => e.event)).toEqual([
    "STAGED",
    "CALLED",
    "RECONCILED",
    "CALLED",
    "RECONCILED",
    "COMMITTED",
  ]);
});

test("never lands within two attempts: aborts without COMMITTED", async () => {
  const vendor = new ScriptedVendor(["throw", "throw"]);
  const { ledger, saga, staged } = setup(vendor);

  await expect(saga.execute(staged.actionId)).rejects.toThrow(SagaExecutionError);
  expect(vendor.calls).toBe(2);
  const events = ledger.events("t").map((e) => e.event);
  expect(events).not.toContain("COMMITTED");
  expect(events[events.length - 1]).toBe("ABORTED");
});

test("reconcile unreachable: action parks at CALLED for later recovery", async () => {
  const vendor = new ScriptedVendor(["ok"], "throw");
  const { ledger, saga, staged } = setup(vendor);

  await expect(saga.execute(staged.actionId)).rejects.toThrow(SagaExecutionError);
  const events = ledger.events("t").map((e) => e.event);
  expect(events[events.length - 1]).toBe("CALLED");
  expect(events).not.toContain("COMMITTED");
});
