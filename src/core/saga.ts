import type { Ledger } from "../ledger/ledger.js";
import type { ActionState, LedgerEvent } from "../ledger/types.js";
import type { VendorAdapter } from "../vendors/types.js";
import { SagaExecutionError } from "./errors.js";
import { mintActionId } from "./ids.js";

export interface StagedAction {
  actionId: string;
  sagaId: string;
  type: string;
  vendor: string;
  params: Record<string, unknown>;
}

export interface SagaOptions {
  ledger: Ledger;
  vendors?: Record<string, VendorAdapter>;
  onEvent?: (e: LedgerEvent) => void;
}

export class Saga {
  private ledger: Ledger;
  private vendors: Record<string, VendorAdapter>;
  private onEvent?: (e: LedgerEvent) => void;

  constructor(opts: SagaOptions) {
    this.ledger = opts.ledger;
    this.vendors = opts.vendors ?? {};
    this.onEvent = opts.onEvent;
  }

  private record(e: Omit<LedgerEvent, "seq" | "at">): LedgerEvent {
    const stored = this.ledger.append(e);
    this.onEvent?.(stored);
    return stored;
  }

  stage(a: {
    sagaId: string;
    type: string;
    vendor: string;
    params: Record<string, unknown>;
  }): StagedAction {
    const actionId = mintActionId();
    this.record({
      sagaId: a.sagaId,
      actionId,
      event: "STAGED",
      payload: { type: a.type, vendor: a.vendor, params: a.params },
    });
    return { actionId, ...a };
  }

  private findAction(actionId: string): StagedAction {
    const stagedEvent = this.ledger
      .events()
      .find((e) => e.actionId === actionId && e.event === "STAGED");
    if (!stagedEvent) {
      throw new SagaExecutionError(`unknown action ${actionId}`, actionId);
    }
    const p = stagedEvent.payload;
    return {
      actionId,
      sagaId: stagedEvent.sagaId,
      type: p.type as string,
      vendor: p.vendor as string,
      params: (p.params ?? {}) as Record<string, unknown>,
    };
  }

  private vendorFor(action: StagedAction): VendorAdapter {
    const vendor = this.vendors[action.vendor];
    if (!vendor) {
      throw new SagaExecutionError(
        `no adapter for vendor ${action.vendor}`,
        action.actionId,
      );
    }
    return vendor;
  }

  private actionState(actionId: string, sagaId: string): ActionState {
    const state = this.ledger
      .actions(sagaId)
      .find((a) => a.actionId === actionId);
    if (!state) {
      throw new SagaExecutionError(`no state for action ${actionId}`, actionId);
    }
    return state;
  }

  async execute(actionId: string): Promise<ActionState> {
    const action = this.findAction(actionId);
    const vendor = this.vendorFor(action);

    this.record({
      sagaId: action.sagaId,
      actionId,
      event: "CALLED",
      payload: {},
    });
    await vendor.call(action);
    const verdict = await vendor.reconcile(actionId);
    this.record({
      sagaId: action.sagaId,
      actionId,
      event: "RECONCILED",
      payload: { landed: verdict.landed },
    });
    if (!verdict.landed) {
      throw new SagaExecutionError(
        `action ${actionId} did not land and cannot be committed`,
        actionId,
      );
    }
    this.record({
      sagaId: action.sagaId,
      actionId,
      event: "COMMITTED",
      payload: {},
    });
    return this.actionState(actionId, action.sagaId);
  }
}
