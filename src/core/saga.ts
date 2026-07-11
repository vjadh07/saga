import type { Ledger } from "../ledger/ledger.js";
import type { LedgerEvent } from "../ledger/types.js";
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
  onEvent?: (e: LedgerEvent) => void;
}

export class Saga {
  private ledger: Ledger;
  private onEvent?: (e: LedgerEvent) => void;

  constructor(opts: SagaOptions) {
    this.ledger = opts.ledger;
    this.onEvent = opts.onEvent;
  }

  protected record(e: Omit<LedgerEvent, "seq" | "at">): LedgerEvent {
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
}
