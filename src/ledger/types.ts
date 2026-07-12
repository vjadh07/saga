export type EventType =
  | "STAGED"
  | "CALLED"
  | "RECONCILED"
  | "COMMITTED"
  | "COMPENSATION_CALLED"
  | "COMPENSATED"
  | "ABORTED";

export interface LedgerEvent {
  seq: number;
  sagaId: string;
  actionId: string;
  event: EventType;
  payload: Record<string, unknown>;
  at: string;
}

export interface ActionState {
  actionId: string;
  sagaId: string;
  state: EventType;
  staged: Record<string, unknown>;
  events: LedgerEvent[];
}

export const TERMINAL_STATES: ReadonlySet<EventType> = new Set([
  "COMMITTED",
  "COMPENSATED",
  "ABORTED",
]);
