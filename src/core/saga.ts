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

  // decision table: the vendor call's response is never trusted on its own.
  // Only a reconcile against ground truth can produce COMMITTED.
  private static readonly MAX_ATTEMPTS = 2;

  async execute(actionId: string): Promise<ActionState> {
    const action = this.findAction(actionId);
    const vendor = this.vendorFor(action);
    return this.attemptLoop(action, vendor, 1);
  }

  // recovery: finish every in-flight action of a saga, exactly-once.
  // STAGED is declared intent, so it executes. CALLED or beyond means side
  // effects may exist in the world, so ground truth is consulted before any
  // re-call.
  async recover(sagaId: string): Promise<ActionState[]> {
    const recovered: ActionState[] = [];
    for (const inFlight of this.ledger.inFlight(sagaId)) {
      recovered.push(await this.recoverAction(inFlight));
    }
    return recovered;
  }

  private async recoverAction(inFlight: ActionState): Promise<ActionState> {
    const action = this.findAction(inFlight.actionId);
    const vendor = this.vendorFor(action);

    if (inFlight.state === "STAGED") {
      return this.execute(action.actionId);
    }

    // CALLED or RECONCILED: ask the world what actually happened first
    const landed = await this.reconcileOrPark(action, vendor);
    this.record({
      sagaId: action.sagaId,
      actionId: action.actionId,
      event: "RECONCILED",
      payload: { landed, recovered: true },
    });
    if (landed) {
      this.record({
        sagaId: action.sagaId,
        actionId: action.actionId,
        event: "COMMITTED",
        payload: {},
      });
      return this.actionState(action.actionId, action.sagaId);
    }

    const attemptsUsed = inFlight.events.filter((e) => e.event === "CALLED").length;
    return this.attemptLoop(action, vendor, attemptsUsed + 1);
  }

  private async reconcileOrPark(
    action: StagedAction,
    vendor: VendorAdapter,
  ): Promise<boolean> {
    try {
      return (await vendor.reconcile(action.actionId)).landed;
    } catch (err) {
      // no ground truth means no verdict: park at CALLED, recoverable later
      const msg = err instanceof Error ? err.message : String(err);
      throw new SagaExecutionError(
        `ground truth unavailable for ${action.actionId}: ${msg}`,
        action.actionId,
      );
    }
  }

  private async attemptLoop(
    action: StagedAction,
    vendor: VendorAdapter,
    startAttempt: number,
  ): Promise<ActionState> {
    const actionId = action.actionId;
    for (let attempt = startAttempt; attempt <= Saga.MAX_ATTEMPTS; attempt++) {
      this.record({
        sagaId: action.sagaId,
        actionId,
        event: "CALLED",
        payload: { attempt },
      });

      let callError: string | undefined;
      try {
        await vendor.call(action);
      } catch (err) {
        callError = err instanceof Error ? err.message : String(err);
      }

      const landed = await this.reconcileOrPark(action, vendor);

      this.record({
        sagaId: action.sagaId,
        actionId,
        event: "RECONCILED",
        payload: callError === undefined ? { landed } : { landed, callError },
      });

      if (landed) {
        this.record({
          sagaId: action.sagaId,
          actionId,
          event: "COMMITTED",
          payload: {},
        });
        return this.actionState(actionId, action.sagaId);
      }
    }

    throw new SagaExecutionError(
      `action ${actionId} did not land after ${Saga.MAX_ATTEMPTS} attempts`,
      actionId,
    );
  }
}
