// Deterministic synthetic history. Generated through the real engine so every
// timeline is authentic, then breaks are planted by direct DB writes, exactly
// the way real divergence appears: behind the ledger's back.
import { DatabaseSync } from "node:sqlite";
import { Ledger } from "../ledger/ledger.js";
import { Saga, type StagedAction } from "../core/saga.js";
import { mintActionId } from "../core/ids.js";
import type { ReconcileVerdict, VendorAdapter } from "../vendors/types.js";
import { FLIGHTS, HOTELS } from "../vendors/fixtures.js";
import type { BreakKind } from "./checks.js";

export interface SeedSummary {
  sagas: number;
  actions: number;
  planted: { kind: BreakKind; subject: string }[];
}

// deterministic PRNG so every rehearsal sees the identical world
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOOKINGS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS bookings (
    key TEXT PRIMARY KEY,
    vendor TEXT NOT NULL,
    item TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`;

// engine-facing adapter that writes the same rows the mock vendor server does
class DirectVendor implements VendorAdapter {
  constructor(
    private db: DatabaseSync,
    private name: string,
  ) {}

  async call(action: StagedAction): Promise<Record<string, unknown>> {
    this.db
      .prepare("INSERT OR IGNORE INTO bookings (key, vendor, item, created_at) VALUES (?, ?, ?, ?)")
      .run(action.actionId, this.name, JSON.stringify(action.params), new Date().toISOString());
    return { ok: true };
  }

  async reconcile(actionId: string): Promise<ReconcileVerdict> {
    const row = this.db.prepare("SELECT key FROM bookings WHERE key = ?").get(actionId);
    return { landed: row !== undefined };
  }

  async compensate(action: StagedAction): Promise<void> {
    this.db.prepare("DELETE FROM bookings WHERE key = ?").run(action.actionId);
  }
}

export async function seed(opts: {
  ledgerPath: string;
  vendorDbPath: string;
}): Promise<SeedSummary> {
  const rng = mulberry32(20260711);
  const db = new DatabaseSync(opts.vendorDbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(BOOKINGS_SCHEMA);
  const ledger = new Ledger(opts.ledgerPath);
  const saga = new Saga({
    ledger,
    vendors: {
      flights: new DirectVendor(db, "flights"),
      hotels: new DirectVendor(db, "hotels"),
      calendar: new DirectVendor(db, "calendar"),
    },
  });

  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;
  const day = (n: number) => `2026-06-${String((n % 27) + 1).padStart(2, "0")}`;

  const SAGAS = 40;
  let actions = 0;
  const compensatedHotelIds: string[] = [];
  // the duplicate-charge twin must keep its vendor row, so only track hotels
  // from sagas that are not later cancelled
  let survivingHotel: StagedAction | undefined;

  for (let i = 0; i < SAGAS; i++) {
    const sagaId = `hist-${String(i + 1).padStart(3, "0")}`;
    const cancelled = i % 8 === 7;
    const legs = 2 + Math.floor(rng() * 3); // 2-4 actions per saga

    const staged: StagedAction[] = [];
    staged.push(
      saga.stage({ sagaId, type: "flight.book", vendor: "flights", params: { flightId: pick(FLIGHTS).id } }),
    );
    const hotel = saga.stage({
      sagaId,
      type: "hotel.book",
      vendor: "hotels",
      params: { hotelId: pick(HOTELS).id, checkin: day(i), checkout: day(i + 2) },
    });
    staged.push(hotel);
    if (legs >= 3) {
      staged.push(
        saga.stage({
          sagaId,
          type: "calendar.add",
          vendor: "calendar",
          params: { title: `Trip ${sagaId}`, startIso: `${day(i)}T09:00:00`, endIso: `${day(i + 2)}T17:00:00` },
        }),
      );
    }
    for (const s of staged) {
      await saga.execute(s.actionId);
      actions++;
    }
    // every 8th trip was cancelled, so compensated history exists too
    if (cancelled) {
      await saga.cancel(sagaId);
      compensatedHotelIds.push(hotel.actionId);
    } else {
      survivingHotel = hotel;
    }
  }

  // plant the breaks, all on the hotels vendor (the demo's hot target)
  const planted: SeedSummary["planted"] = [];
  const insertRow = (key: string, item: Record<string, unknown>) =>
    db
      .prepare("INSERT INTO bookings (key, vendor, item, created_at) VALUES (?, 'hotels', ?, ?)")
      .run(key, JSON.stringify(item), new Date().toISOString());

  // 2x SHADOW_EFFECT: bookings no ledger intent ever authorized. The odd
  // checkout gaps guarantee no accidental item collision with generated rows.
  for (const item of [
    { hotelId: "H200", checkin: "2026-06-03", checkout: "2026-06-06" },
    { hotelId: "H300", checkin: "2026-06-15", checkout: "2026-06-16" },
  ]) {
    const key = mintActionId();
    insertRow(key, item);
    planted.push({ kind: "SHADOW_EFFECT", subject: key });
  }

  // 1x DUPLICATE_CHARGE: a second row copying a legit committed booking's item
  const dupKey = mintActionId();
  insertRow(dupKey, survivingHotel!.params);
  planted.push({ kind: "DUPLICATE_CHARGE", subject: dupKey });

  // 1x PHANTOM_COMPENSATION: resurrect a row the ledger believes is gone
  const phantomId = compensatedHotelIds[0]!;
  insertRow(phantomId, { hotelId: "H100", checkin: "2026-06-08", checkout: "2026-06-10" });
  planted.push({ kind: "PHANTOM_COMPENSATION", subject: phantomId });

  // 1x WEDGED_SAGA: an action that never got past CALLED
  const wedgedId = mintActionId();
  ledger.append({
    sagaId: "hist-wedged",
    actionId: wedgedId,
    event: "STAGED",
    payload: { type: "hotel.book", vendor: "hotels", params: { hotelId: "H200", checkin: "2026-06-20", checkout: "2026-06-21" } },
  });
  ledger.append({ sagaId: "hist-wedged", actionId: wedgedId, event: "CALLED", payload: { attempt: 1 } });
  planted.push({ kind: "WEDGED_SAGA", subject: wedgedId });

  // spread timestamps over the past 30 days, preserving seq order
  const total = ledger.events().length;
  const start = Date.parse("2026-06-11T00:00:00.000Z");
  const span = Date.parse("2026-07-10T00:00:00.000Z") - start;
  const ldb = new DatabaseSync(opts.ledgerPath);
  ldb.exec(`
    UPDATE events SET at = strftime('%Y-%m-%dT%H:%M:%f', ${start / 1000} + (seq * 1.0 / ${total}) * ${span / 1000}, 'unixepoch') || 'Z'
  `);
  ldb.close();
  db.exec(`
    UPDATE bookings SET created_at = strftime('%Y-%m-%dT%H:%M:%f', ${start / 1000} + (ABS(RANDOM() % 100) / 100.0) * ${span / 1000}, 'unixepoch') || 'Z'
  `);

  db.close();
  ledger.close();
  return { sagas: SAGAS, actions, planted };
}
