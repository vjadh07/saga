import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { Saga } from "../src/core/saga.js";
import { httpVendor } from "../src/vendors/http-adapter.js";
import { startVendorServer, type VendorServer } from "../src/vendors/server.js";

let server: VendorServer;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "saga-integration-"));
  server = await startVendorServer({ dbPath: join(dir, "vendors.db"), port: 0 });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

function freshSaga(sagaId: string) {
  const ledger = new Ledger(":memory:");
  const saga = new Saga({
    ledger,
    vendors: {
      flights: httpVendor(base, "flights"),
      hotels: httpVendor(base, "hotels"),
    },
  });
  return { ledger, saga, sagaId };
}

async function oracle(): Promise<{ key: string; vendor: string }[]> {
  return (await (await fetch(`${base}/admin/bookings`)).json()) as {
    key: string;
    vendor: string;
  }[];
}

test("a staged booking lands on the real vendor and commits", async () => {
  const { saga } = freshSaga("trip-a");
  const staged = saga.stage({
    sagaId: "trip-a",
    type: "flight.book",
    vendor: "flights",
    params: { flightId: "F100" },
  });

  const result = await saga.execute(staged.actionId);

  expect(result.state).toBe("COMMITTED");
  const rows = await oracle();
  expect(rows.filter((r) => r.key === staged.actionId)).toHaveLength(1);
});

test("ambiguous 500 from the vendor still ends in exactly one committed booking", async () => {
  const { ledger, saga } = freshSaga("trip-b");
  const staged = saga.stage({
    sagaId: "trip-b",
    type: "hotel.book",
    vendor: "hotels",
    params: { hotelId: "H100" },
  });
  await fetch(`${base}/admin/failures`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: staged.actionId, mode: "ambiguous_500" }),
  });

  const result = await saga.execute(staged.actionId);

  expect(result.state).toBe("COMMITTED");
  const rows = await oracle();
  expect(rows.filter((r) => r.key === staged.actionId)).toHaveLength(1);
  // the lie is on the record: call failed, ground truth said landed
  const reconciled = ledger.events("trip-b").find((e) => e.event === "RECONCILED")!;
  expect(reconciled.payload.landed).toBe(true);
  expect(String(reconciled.payload.callError)).toContain("500");
});

test("cancel empties the vendor world and the receipt says compensated", async () => {
  const { saga } = freshSaga("trip-c");
  const flight = saga.stage({ sagaId: "trip-c", type: "flight.book", vendor: "flights", params: { flightId: "F200" } });
  await saga.execute(flight.actionId);
  const hotel = saga.stage({ sagaId: "trip-c", type: "hotel.book", vendor: "hotels", params: { hotelId: "H200" } });
  await saga.execute(hotel.actionId);

  await saga.cancel("trip-c");

  const rows = await oracle();
  expect(rows.filter((r) => r.key === flight.actionId || r.key === hotel.actionId)).toHaveLength(0);
  expect(saga.receipt("trip-c").status).toBe("compensated");
});
