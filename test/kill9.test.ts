import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { startVendorServer, type VendorServer } from "../src/vendors/server.js";

// spawn node directly with the tsx loader: the tsx CLI is a wrapper process,
// and a wrapper turns the inner SIGKILL into a plain exit code 137
const CHILD = join(process.cwd(), "scripts", "crash-child.ts");

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function runChild(env: Record<string, string>): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", CHILD], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function scene(sagaId: string) {
  const dir = mkdtempSync(join(tmpdir(), "saga-kill9-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const server: VendorServer = await startVendorServer({
    dbPath: join(dir, "vendors.db"),
    port: 0,
  });
  cleanups.push(() => server.close());
  const env = {
    LEDGER_PATH: join(dir, "ledger.db"),
    VENDOR_URL: `http://127.0.0.1:${server.port}`,
    SAGA_ID: sagaId,
  };
  const oracle = async () =>
    (await (await fetch(`${env.VENDOR_URL}/admin/bookings`)).json()) as {
      key: string;
      vendor: string;
    }[];
  return { env, oracle };
}

test("SIGKILL right after hotel CALLED: restart recovers and books exactly once", async () => {
  const { env, oracle } = await scene("trip-k1");

  const life1 = await runChild({ ...env, CRASH_AFTER: "hotel.book:CALLED" });
  expect(life1.signal).toBe("SIGKILL");

  // world after the crash: flight booked, hotel call never made it out
  const midRows = await oracle();
  expect(midRows.filter((r) => r.vendor === "flights")).toHaveLength(1);
  expect(midRows.filter((r) => r.vendor === "hotels")).toHaveLength(0);
  const midLedger = new Ledger(env.LEDGER_PATH);
  const hotel = midLedger.actions("trip-k1").find((a) => a.staged.type === "hotel.book")!;
  expect(hotel.state).toBe("CALLED");
  midLedger.close();

  const life2 = await runChild(env);
  expect(life2.signal).toBeNull();
  expect(life2.code, life2.stderr).toBe(0);

  const rows = await oracle();
  expect(rows.filter((r) => r.vendor === "flights")).toHaveLength(1);
  expect(rows.filter((r) => r.vendor === "hotels")).toHaveLength(1);
  const ledger = new Ledger(env.LEDGER_PATH);
  expect(ledger.actions("trip-k1").map((a) => a.state)).toEqual(["COMMITTED", "COMMITTED"]);
  ledger.close();
}, 30000);

test("SIGKILL after the effect landed but before COMMITTED: no double booking on restart", async () => {
  const { env, oracle } = await scene("trip-k2");

  const life1 = await runChild({ ...env, CRASH_AFTER: "hotel.book:RECONCILED" });
  expect(life1.signal).toBe("SIGKILL");

  // the hotel booking exists in the world, the ledger never saw COMMITTED
  const midRows = await oracle();
  expect(midRows.filter((r) => r.vendor === "hotels")).toHaveLength(1);
  const hotelKey = midRows.find((r) => r.vendor === "hotels")!.key;

  const life2 = await runChild(env);
  expect(life2.code, life2.stderr).toBe(0);

  const rows = await oracle();
  const hotels = rows.filter((r) => r.vendor === "hotels");
  expect(hotels).toHaveLength(1);
  expect(hotels[0]!.key).toBe(hotelKey); // same booking, not a second one
  const ledger = new Ledger(env.LEDGER_PATH);
  expect(ledger.inFlight("trip-k2")).toEqual([]);
  ledger.close();
}, 30000);
