import type { Ledger } from "../ledger/ledger.js";
import type { ActionState, EventType, LedgerEvent } from "../ledger/types.js";
import { TERMINAL_STATES } from "../ledger/types.js";
import type { VendorAdapter } from "../vendors/types.js";
import { CompensationError, SagaExecutionError } from "./errors.js";
import { mintActionId } from "./ids.js";

export interface Receipt {
  sagaId: string;
  status: "committed" | "compensated" | "mixed" | "in_flight";
  actions: {
    actionId: string;
    type: string;
    params: Record<string, unknown>;
    state: EventType;
    timeline: { event: EventType; at: string }[];
  }[];
}

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

    if (inFlight.state === "COMPENSATION_CALLED") {
      return this.compensateAction(inFlight);
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

    // deterministic verdict after all attempts: the action is dead, say so
    // durably instead of wedging the saga in a non-terminal state forever
    this.record({
      sagaId: action.sagaId,
      actionId,
      event: "ABORTED",
      payload: { attempts: Saga.MAX_ATTEMPTS },
    });
    throw new SagaExecutionError(
      `action ${actionId} did not land after ${Saga.MAX_ATTEMPTS} attempts`,
      actionId,
    );
  }

  // unwind: newest commit first, and every COMPENSATED needs ground truth
  // confirming the effect is gone. Resumable: rerunning cancel picks up
  // parked COMPENSATION_CALLED actions and untouched COMMITTED ones.
  async cancel(sagaId: string): Promise<ActionState[]> {
    const commitSeq = (a: ActionState) =>
      a.events.find((e) => e.event === "COMMITTED")?.seq ?? 0;
    const targets = this.ledger
      .actions(sagaId)
      .filter((a) => a.state === "COMMITTED" || a.state === "COMPENSATION_CALLED")
      .sort((x, y) => commitSeq(y) - commitSeq(x));

    const done: ActionState[] = [];
    for (const target of targets) {
      done.push(await this.compensateAction(target));
    }
    return done;
  }

  private async compensateAction(state: ActionState): Promise<ActionState> {
    const action = this.findAction(state.actionId);
    const vendor = this.vendorFor(action);

    if (state.state !== "COMPENSATION_CALLED") {
      this.record({
        sagaId: action.sagaId,
        actionId: action.actionId,
        event: "COMPENSATION_CALLED",
        payload: {},
      });
    }

    try {
      await vendor.compensate(action);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CompensationError(
        `compensation failed for ${action.actionId}: ${msg}`,
        action.actionId,
      );
    }

    const landed = await this.reconcileOrPark(action, vendor);
    if (landed) {
      throw new CompensationError(
        `world still shows the effect of ${action.actionId} after compensation`,
        action.actionId,
      );
    }

    this.record({
      sagaId: action.sagaId,
      actionId: action.actionId,
      event: "COMPENSATED",
      payload: {},
    });
    return this.actionState(action.actionId, action.sagaId);
  }

  receipt(sagaId: string): Receipt {
    const actions = this.ledger.actions(sagaId);
    const states = actions.map((a) => a.state);
    let status: Receipt["status"];
    if (states.some((s) => !TERMINAL_STATES.has(s))) status = "in_flight";
    else if (states.every((s) => s === "COMMITTED")) status = "committed";
    else if (states.every((s) => s === "COMPENSATED")) status = "compensated";
    else status = "mixed";

    return {
      sagaId,
      status,
      actions: actions.map((a) => ({
        actionId: a.actionId,
        type: String(a.staged.type ?? ""),
        params: (a.staged.params ?? {}) as Record<string, unknown>,
        state: a.state,
        timeline: a.events.map((e) => ({ event: e.event, at: e.at })),
      })),
    };
  }
}
