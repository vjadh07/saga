import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { startVendorServer, type VendorServer } from "../src/vendors/server.js";

let server: VendorServer;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "saga-vendors-"));
  server = await startVendorServer({ dbPath: join(dir, "vendors.db"), port: 0 });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("search results are fixed fixtures, identical every time", async () => {
  const first = await (await fetch(`${base}/flights/search`)).json();
  const second = await (await fetch(`${base}/flights/search`)).json();
  expect(first).toHaveLength(3);
  expect(first).toEqual(second);
  const hotels = await (await fetch(`${base}/hotels/search`)).json();
  expect(hotels).toHaveLength(3);
});

test("booking with the same key twice creates exactly one booking", async () => {
  const r1 = await post("/flights/bookings", { key: "aaa11", item: { flightId: "F100" } });
  const r2 = await post("/flights/bookings", { key: "aaa11", item: { flightId: "F100" } });
  expect(r1.status).toBe(201);
  expect(r2.status).toBe(200);
  const b1 = (await r1.json()) as { bookingId: string };
  const b2 = (await r2.json()) as { bookingId: string };
  expect(b2.bookingId).toBe(b1.bookingId);

  const all = (await (await fetch(`${base}/admin/bookings`)).json()) as { key: string }[];
  expect(all.filter((b) => b.key === "aaa11")).toHaveLength(1);
});

test("armed key books internally then answers 500 exactly once", async () => {
  await post("/admin/failures", { key: "bbb22", mode: "ambiguous_500" });

  const r1 = await post("/hotels/bookings", { key: "bbb22", item: { hotelId: "H100" } });
  expect(r1.status).toBe(500);

  // the lie is visible to ground truth: the booking exists
  const check = await fetch(`${base}/hotels/bookings/bbb22`);
  expect(check.status).toBe(200);

  // failure is consumed: retry with the same key is a clean idempotent 200
  const r2 = await post("/hotels/bookings", { key: "bbb22", item: { hotelId: "H100" } });
  expect(r2.status).toBe(200);
});

test("reconcile endpoint: 200 for existing, 404 for unknown", async () => {
  await post("/flights/bookings", { key: "ccc33", item: { flightId: "F200" } });
  expect((await fetch(`${base}/flights/bookings/ccc33`)).status).toBe(200);
  expect((await fetch(`${base}/flights/bookings/zzz99`)).status).toBe(404);
});

test("delete is idempotent and removes the booking", async () => {
  await post("/flights/bookings", { key: "ddd44", item: { flightId: "F300" } });
  const d1 = await fetch(`${base}/flights/bookings/ddd44`, { method: "DELETE" });
  const d2 = await fetch(`${base}/flights/bookings/ddd44`, { method: "DELETE" });
  expect(d1.status).toBe(204);
  expect(d2.status).toBe(204);
  expect((await fetch(`${base}/flights/bookings/ddd44`)).status).toBe(404);
});
