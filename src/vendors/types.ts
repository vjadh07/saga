import type { StagedAction } from "../core/saga.js";

export interface ReconcileVerdict {
  landed: boolean;
  record?: Record<string, unknown>;
}

export interface VendorAdapter {
  call(action: StagedAction): Promise<Record<string, unknown>>;
  reconcile(actionId: string): Promise<ReconcileVerdict>;
  // must be idempotent: compensating an already-undone action succeeds
  compensate(action: StagedAction): Promise<void>;
}
