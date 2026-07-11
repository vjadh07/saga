import { expect, test } from "vitest";
import type { StagedAction } from "../src/core/saga.js";
import { calendarVendor, type CalendarClient } from "../src/vendors/calendar.js";

function gaxiosError(status: number): Error {
  const err = new Error(`googleapis said ${status}`);
  (err as unknown as { code: number }).code = status;
  return err;
}

interface FakeOpts {
  getBehavior?: () => Promise<Record<string, unknown>>;
  deleteBehavior?: () => Promise<void>;
}

function fakeClient(opts: FakeOpts = {}) {
  const inserts: Record<string, unknown>[] = [];
  const deletes: Record<string, unknown>[] = [];
  const client: CalendarClient = {
    events: {
      insert: async (params) => {
        inserts.push(params as unknown as Record<string, unknown>);
        return { data: { id: params.requestBody.id, status: "confirmed" } };
      },
      get: async () => {
        if (opts.getBehavior) return { data: await opts.getBehavior() };
        return { data: { id: "whatever", status: "confirmed" } };
      },
      delete: async (params) => {
        deletes.push(params as unknown as Record<string, unknown>);
        if (opts.deleteBehavior) await opts.deleteBehavior();
      },
    },
  };
  return { client, inserts, deletes };
}

const action: StagedAction = {
  actionId: "abc123def456ghi789jkl012mn",
  sagaId: "trip",
  type: "calendar.add",
  vendor: "calendar",
  params: {
    title: "Flight PHX to SFO",
    startIso: "2026-07-17T09:15:00",
    endIso: "2026-07-17T11:05:00",
  },
};

test("call inserts the event with the actionId as the event id", async () => {
  const { client, inserts } = fakeClient();
  const vendor = calendarVendor(client, { calendarId: "primary", timeZone: "America/Phoenix" });

  await vendor.call(action);

  expect(inserts).toHaveLength(1);
  const params = inserts[0] as {
    calendarId: string;
    requestBody: { id: string; summary: string; start: { dateTime: string; timeZone: string } };
  };
  expect(params.calendarId).toBe("primary");
  expect(params.requestBody.id).toBe(action.actionId);
  expect(params.requestBody.summary).toBe("Flight PHX to SFO");
  expect(params.requestBody.start).toEqual({
    dateTime: "2026-07-17T09:15:00",
    timeZone: "America/Phoenix",
  });
});

test("reconcile: existing event means landed, with the record", async () => {
  const { client } = fakeClient({
    getBehavior: async () => ({ id: action.actionId, status: "confirmed" }),
  });
  const vendor = calendarVendor(client, { calendarId: "primary" });

  const verdict = await vendor.reconcile(action.actionId);
  expect(verdict.landed).toBe(true);
  expect(verdict.record).toEqual({ id: action.actionId, status: "confirmed" });
});

test("reconcile: 404 and cancelled both mean not landed", async () => {
  const missing = fakeClient({ getBehavior: () => Promise.reject(gaxiosError(404)) });
  const gone = fakeClient({ getBehavior: async () => ({ id: "x", status: "cancelled" }) });

  const v404 = await calendarVendor(missing.client, { calendarId: "primary" }).reconcile("x");
  const vCancelled = await calendarVendor(gone.client, { calendarId: "primary" }).reconcile("x");
  expect(v404).toEqual({ landed: false });
  expect(vCancelled.landed).toBe(false);
});

test("reconcile surfaces non-404 errors so the engine stays recoverable", async () => {
  const { client } = fakeClient({ getBehavior: () => Promise.reject(gaxiosError(500)) });
  await expect(
    calendarVendor(client, { calendarId: "primary" }).reconcile("x"),
  ).rejects.toThrow("googleapis said 500");
});

test("compensate swallows 404 and 410, so a second compensate is a no-op", async () => {
  let calls = 0;
  const { client, deletes } = fakeClient({
    deleteBehavior: () => {
      calls += 1;
      return calls === 1 ? Promise.resolve() : Promise.reject(gaxiosError(410));
    },
  });
  const vendor = calendarVendor(client, { calendarId: "primary" });

  await vendor.compensate(action);
  await vendor.compensate(action); // already gone: 410 must be swallowed
  expect(deletes).toHaveLength(2);
});

test("compensate surfaces other errors", async () => {
  const { client } = fakeClient({ deleteBehavior: () => Promise.reject(gaxiosError(500)) });
  await expect(
    calendarVendor(client, { calendarId: "primary" }).compensate(action),
  ).rejects.toThrow("googleapis said 500");
});
