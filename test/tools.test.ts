import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { Saga } from "../src/core/saga.js";
import { httpVendor } from "../src/vendors/http-adapter.js";
import { startVendorServer, type VendorServer } from "../src/vendors/server.js";
import {
  bookFlight,
  bookHotel,
  addCalendarEvent,
  cancelTrip,
  searchFlights,
  searchHotels,
  tripStatus,
  type TripContext,
} from "../src/agent/tools.js";

let server: VendorServer;
let dir: string;
let ctx: TripContext;
let ledger: Ledger;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "saga-tools-"));
  server = await startVendorServer({ dbPath: join(dir, "vendors.db"), port: 0 });
  const vendorBase = `http://127.0.0.1:${server.port}`;
  ledger = new Ledger(":memory:");
  const saga = new Saga({
    ledger,
    vendors: {
      flights: httpVendor(vendorBase, "flights"),
      hotels: httpVendor(vendorBase, "hotels"),
      calendar: httpVendor(vendorBase, "calendar"),
    },
  });
  ctx = { saga, sagaId: "trip-tools", vendorBase };
});

afterAll(async () => {
  ledger.close();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

test("searches return the fixed fixture world", async () => {
  const flights = await searchFlights(ctx, { from: "PHX", to: "SFO", date: "2026-07-17" });
  expect(flights.map((f) => f.id)).toEqual(["F100", "F200", "F300"]);
  const hotels = await searchHotels(ctx, { city: "San Francisco", checkin: "2026-07-17", checkout: "2026-07-19" });
  expect(hotels.map((h) => h.id)).toEqual(["H100", "H200", "H300"]);
});

test("booking tools drive committed actions with real vendor rows", async () => {
  const flight = await bookFlight(ctx, { flightId: "F100" });
  expect(flight.state).toBe("COMMITTED");

  const hotel = await bookHotel(ctx, { hotelId: "H100", checkin: "2026-07-17", checkout: "2026-07-19" });
  expect(hotel.state).toBe("COMMITTED");

  const cal = await addCalendarEvent(ctx, {
    title: "Trip to SF",
    startIso: "2026-07-17T09:15:00",
    endIso: "2026-07-19T12:00:00",
  });
  expect(cal.state).toBe("COMMITTED");

  const rows = (await (await fetch(`${ctx.vendorBase}/admin/bookings`)).json()) as {
    key: string;
    vendor: string;
  }[];
  expect(rows.map((r) => r.key).sort()).toEqual(
    [flight.actionId, hotel.actionId, cal.actionId].sort(),
  );

  const status = tripStatus(ctx);
  expect(status.status).toBe("committed");
  expect(status.actions).toHaveLength(3);
});

test("cancelTrip unwinds everything and reports a compensated receipt", async () => {
  const receipt = await cancelTrip(ctx);
  expect(receipt.status).toBe("compensated");

  const rows = (await (await fetch(`${ctx.vendorBase}/admin/bookings`)).json()) as unknown[];
  expect(rows).toHaveLength(0);
});
