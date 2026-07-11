// Google Calendar as a saga vendor. The client is injected so tests can hand
// in a fake; the real one comes from googleapis in the demo scripts. Action
// ids double as event ids (mintActionId uses a calendar-safe alphabet), which
// is what makes call idempotent: re-inserting the same id cannot duplicate.
import type { StagedAction } from "../core/saga.js";
import type { ReconcileVerdict, VendorAdapter } from "./types.js";

export interface CalendarClient {
  events: {
    insert(params: {
      calendarId: string;
      requestBody: {
        id: string;
        summary: string;
        start: { dateTime: string; timeZone: string };
        end: { dateTime: string; timeZone: string };
      };
    }): Promise<{ data: Record<string, unknown> }>;
    get(params: {
      calendarId: string;
      eventId: string;
    }): Promise<{ data: Record<string, unknown> }>;
    delete(params: { calendarId: string; eventId: string }): Promise<unknown>;
  };
}

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { code?: unknown; response?: { status?: unknown } };
  if (typeof e.code === "number") return e.code;
  if (typeof e.response?.status === "number") return e.response.status;
  return undefined;
}

export function calendarVendor(
  client: CalendarClient,
  opts: { calendarId: string; timeZone?: string },
): VendorAdapter {
  const timeZone = opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    async call(action: StagedAction): Promise<Record<string, unknown>> {
      const p = action.params as { title?: unknown; startIso?: unknown; endIso?: unknown };
      const res = await client.events.insert({
        calendarId: opts.calendarId,
        requestBody: {
          id: action.actionId,
          summary: String(p.title ?? "saga event"),
          start: { dateTime: String(p.startIso), timeZone },
          end: { dateTime: String(p.endIso), timeZone },
        },
      });
      return res.data;
    },

    async reconcile(actionId: string): Promise<ReconcileVerdict> {
      let data: Record<string, unknown>;
      try {
        data = (await client.events.get({ calendarId: opts.calendarId, eventId: actionId })).data;
      } catch (err) {
        if (statusOf(err) === 404) return { landed: false };
        throw err;
      }
      if (data.status === "cancelled") return { landed: false };
      return { landed: true, record: data };
    },

    async compensate(action: StagedAction): Promise<void> {
      try {
        await client.events.delete({ calendarId: opts.calendarId, eventId: action.actionId });
      } catch (err) {
        const status = statusOf(err);
        if (status === 404 || status === 410) return; // already gone
        throw err;
      }
    },
  };
}
