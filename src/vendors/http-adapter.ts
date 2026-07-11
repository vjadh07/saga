import type { StagedAction } from "../core/saga.js";
import type { ReconcileVerdict, VendorAdapter } from "./types.js";

export function httpVendor(baseUrl: string, vendorName: string): VendorAdapter {
  const bookings = `${baseUrl}/${vendorName}/bookings`;

  return {
    async call(action: StagedAction): Promise<Record<string, unknown>> {
      const res = await fetch(bookings, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: action.actionId, item: action.params }),
      });
      if (!res.ok) {
        throw new Error(`${vendorName} booking answered ${res.status}`);
      }
      return (await res.json()) as Record<string, unknown>;
    },

    async reconcile(actionId: string): Promise<ReconcileVerdict> {
      const res = await fetch(`${bookings}/${actionId}`);
      if (res.status === 404) return { landed: false };
      if (!res.ok) {
        throw new Error(`${vendorName} reconcile answered ${res.status}`);
      }
      return { landed: true, record: (await res.json()) as Record<string, unknown> };
    },

    async compensate(action: StagedAction): Promise<void> {
      const res = await fetch(`${bookings}/${action.actionId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new Error(`${vendorName} compensate answered ${res.status}`);
      }
    },
  };
}
