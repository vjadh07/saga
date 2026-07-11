import type { LedgerEvent } from "../ledger/types.js";

// CRASH_AFTER="<actionType>:<event>" kills this process dead (SIGKILL, no
// cleanup, no goodbye) the instant that ledger event is durably written.
// The demo and the kill -9 test share this exact code path, so the staged
// crash is the real thing, just deterministic.
export function crashAfter(
  spec: string | undefined,
): (e: LedgerEvent) => void {
  if (!spec) return () => {};
  const [type, event] = spec.split(":");
  const typeOf = new Map<string, string>();

  return (e: LedgerEvent) => {
    if (e.event === "STAGED") typeOf.set(e.actionId, String(e.payload.type));
    if (typeOf.get(e.actionId) === type && e.event === event) {
      process.kill(process.pid, "SIGKILL");
    }
  };
}
