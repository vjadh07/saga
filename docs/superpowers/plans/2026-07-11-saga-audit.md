# Saga Audit Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conversational read-only auditor agent to Saga that finds reconciliation breaks (ledger vs vendor ground truth) in a seeded transaction history, plus an ABORTED terminal state, a deterministic seed script, and a company-grade landing page.

**Architecture:** Detection is pure, deterministic functions in `src/audit/checks.ts`; the LLM only chooses which checks to run and narrates evidence (same "model drives, engine guarantees" split as the booking agent). Seeded history is generated through the real engine so timelines are authentic, then breaks are planted by direct DB writes. The auditor is a second Agent SDK CLI (`npm run audit`) with read-only tools.

**Tech Stack:** Existing stack only: TypeScript ESM, Node >= 22.5 `node:sqlite`, Vitest, tsx, @anthropic-ai/claude-agent-sdk, zod. No new dependencies.

## Global Constraints

- No em dashes anywhere: code, comments, docs, commit messages, page copy.
- Plain commit messages, no AI co-author or "generated with" trailers.
- TDD: failing test first, watch it fail, minimal code, watch it pass, commit.
- The word "fraud" is banned in code, docs, page copy, and system prompts. Findings are "reconciliation breaks".
- Tests never call the real LLM or real Google Calendar. Agent SDK glue is verified by a live rehearsal run.
- The auditor has zero write ability toward vendors or the ledger. Its only write is a local markdown report file.
- All SQLite via `node:sqlite` DatabaseSync. Landing page is fully self-contained (no CDNs, no external requests).
- Ports: vendors 4100, viewer 4200, site 4400. Tests always use port 0.

## File structure

```
src/ledger/types.ts          MODIFY: EventType + TERMINAL_STATES gain ABORTED
src/core/saga.ts             MODIFY: attemptLoop records ABORTED on exhaustion
src/viewer/index.html        MODIFY: ABORTED badge color
src/audit/checks.ts          CREATE: pure reconciliation checks -> Finding[]
src/audit/seed.ts            CREATE: deterministic history generator + break planting
src/agent/audit-tools.ts     CREATE: auditor tool handlers as plain functions
src/agent/run.ts             MODIFY: export localClaudePath
src/agent/auditor.ts         CREATE: Agent SDK wiring for the auditor
scripts/seed.ts              CREATE: CLI wrapper for seed()
scripts/audit.ts             CREATE: CLI for the auditor agent
scripts/site.ts              CREATE: static server for the landing page
site/index.html              CREATE: landing page
test/abort.test.ts           CREATE
test/checks.test.ts          CREATE
test/seed.test.ts            CREATE
test/audit-tools.test.ts     CREATE
test/reconcile.test.ts       MODIFY: exhaustion row now ends ABORTED
docs/demo.md                 MODIFY: act 2 = audit investigation
reports/audit-fallback.md    CREATE (Task 7, generated then committed)
```

---

### Task 1: ABORTED terminal state

**Files:**
- Modify: `src/ledger/types.ts`
- Modify: `src/core/saga.ts` (attemptLoop, lines around 216-222)
- Modify: `test/reconcile.test.ts` (the "never lands within two attempts" test)
- Modify: `src/viewer/index.html` (COLORS map and CSS vars)
- Test: `test/abort.test.ts`

**Interfaces:**
- Consumes: existing `Saga`, `Ledger`, `ScriptedVendor` pattern from test/reconcile.test.ts.
- Produces: `EventType` union includes `"ABORTED"`; `TERMINAL_STATES` includes it; an exhausted action's last ledger event is `ABORTED` with payload `{ attempts: 2 }`.

- [ ] **Step 1: Write the failing tests**

`test/abort.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { Saga, type StagedAction } from "../src/core/saga.js";
import { SagaExecutionError } from "../src/core/errors.js";
import type { ReconcileVerdict, VendorAdapter } from "../src/vendors/types.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

// always fails, never lands: the abort case
class DeadVendor implements VendorAdapter {
  calls = 0;
  async call(_a: StagedAction): Promise<Record<string, unknown>> {
    this.calls++;
    throw new Error("vendor permanently down");
  }
  async reconcile(_id: string): Promise<ReconcileVerdict> {
    return { landed: false };
  }
  async compensate(_a: StagedAction): Promise<void> {}
}

function setup() {
  const ledger = new Ledger(":memory:");
  cleanups.push(() => ledger.close());
  const vendor = new DeadVendor();
  const saga = new Saga({ ledger, vendors: { v: vendor } });
  const staged = saga.stage({ sagaId: "t", type: "x.do", vendor: "v", params: {} });
  return { ledger, vendor, saga, staged };
}

test("exhausted attempts append ABORTED as the terminal event", async () => {
  const { ledger, saga, staged } = setup();
  await expect(saga.execute(staged.actionId)).rejects.toThrow(SagaExecutionError);
  const events = ledger.events("t").map((e) => e.event);
  expect(events[events.length - 1]).toBe("ABORTED");
  expect(events).not.toContain("COMMITTED");
  const aborted = ledger.events("t").at(-1)!;
  expect(aborted.payload).toEqual({ attempts: 2 });
});

test("ABORTED is terminal: recover does nothing, receipt is not in_flight", async () => {
  const { ledger, vendor, saga, staged } = setup();
  await expect(saga.execute(staged.actionId)).rejects.toThrow(SagaExecutionError);

  const callsBefore = vendor.calls;
  expect(await saga.recover("t")).toEqual([]);
  expect(vendor.calls).toBe(callsBefore);
  expect(ledger.inFlight("t")).toEqual([]);
  expect(saga.receipt("t").status).toBe("mixed");
});

test("cancel ignores ABORTED actions", async () => {
  const { saga, staged } = setup();
  await expect(saga.execute(staged.actionId)).rejects.toThrow(SagaExecutionError);
  expect(await saga.cancel("t")).toEqual([]);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -- test/abort.test.ts`
Expected: FAIL. First test gets `RECONCILED` as last event (type error on "ABORTED" comes out as a TS complaint in editors but vitest runs it; the assertion fails).

- [ ] **Step 3: Minimal implementation**

`src/ledger/types.ts`: extend the union and terminal set:

```ts
export type EventType =
  | "STAGED"
  | "CALLED"
  | "RECONCILED"
  | "COMMITTED"
  | "COMPENSATION_CALLED"
  | "COMPENSATED"
  | "ABORTED";
```

```ts
export const TERMINAL_STATES: ReadonlySet<EventType> = new Set([
  "COMMITTED",
  "COMPENSATED",
  "ABORTED",
]);
```

`src/core/saga.ts`, in `attemptLoop`, replace the bare throw after the for-loop:

```ts
    // deterministic verdict after all attempts: the action is dead, say so
    // durably instead of wedging the saga in a non-terminal state forever
    this.record({
      sagaId: action.sagaId,
      actionId,
      event: "ABORTED",
      payload: { attempts: Saga.MAX_ATTEMPTS },
    });
    throw new SagaExecutionError(
      `action ${actionId} did not land after ${Saga.MAX_ATTEMPTS} attempts`,
      actionId,
    );
```

- [ ] **Step 4: Update the changed decision-table row**

In `test/reconcile.test.ts`, the test `"never lands within two attempts: fails without COMMITTED"` changes its last assertion:

```ts
  expect(events[events.length - 1]).toBe("ABORTED");
```

(rename the test to `"never lands within two attempts: aborts without COMMITTED"`).

- [ ] **Step 5: Viewer badge**

`src/viewer/index.html`: add to the `:root` CSS block `--aborted: #f85149;` and to the JS `COLORS` map `ABORTED: "var(--aborted)",`.

- [ ] **Step 6: Full suite green**

Run: `npm test`
Expected: all pass (50+ tests), including the modified reconcile test.

- [ ] **Step 7: Commit**

```bash
git add src/ledger/types.ts src/core/saga.ts src/viewer/index.html test/abort.test.ts test/reconcile.test.ts
git commit -m "feat: aborted terminal state for actions that exhaust reconcile attempts"
```

---

### Task 2: Reconciliation checks (pure)

**Files:**
- Create: `src/audit/checks.ts`
- Test: `test/checks.test.ts`

**Interfaces:**
- Consumes: `LedgerEvent`, `TERMINAL_STATES` from `src/ledger/types.ts`.
- Produces (used by Tasks 3 and 4):

```ts
export type BreakKind = "SHADOW_EFFECT" | "DUPLICATE_CHARGE" | "PHANTOM_COMPENSATION" | "WEDGED_SAGA";
export interface OracleRow { key: string; vendor: string; item: Record<string, unknown>; createdAt: string; }
export interface Finding {
  kind: BreakKind;
  vendor: string;
  subject: string; // actionId or vendor row key
  summary: string;
  ledgerEvidence: LedgerEvent[];
  vendorEvidence: OracleRow[];
}
export function runChecks(events: LedgerEvent[], rows: OracleRow[]): Finding[];
```

- [ ] **Step 1: Write the failing tests**

`test/checks.test.ts`. Build small literal scenarios; a helper fabricates events:

```ts
import { expect, test } from "vitest";
import type { LedgerEvent } from "../src/ledger/types.js";
import { runChecks, type OracleRow } from "../src/audit/checks.js";

let seq = 0;
function ev(actionId: string, event: LedgerEvent["event"], payload: Record<string, unknown> = {}, sagaId = "s1"): LedgerEvent {
  return { seq: ++seq, sagaId, actionId, event, payload, at: `2026-07-0${(seq % 9) + 1}T00:00:00.000Z` };
}
function committed(actionId: string, vendor: string, params: Record<string, unknown>): LedgerEvent[] {
  return [
    ev(actionId, "STAGED", { type: "hotel.book", vendor, params }),
    ev(actionId, "CALLED", { attempt: 1 }),
    ev(actionId, "RECONCILED", { landed: true }),
    ev(actionId, "COMMITTED"),
  ];
}
function row(key: string, vendor: string, item: Record<string, unknown>): OracleRow {
  return { key, vendor, item, createdAt: "2026-07-01T00:00:00.000Z" };
}

test("clean history yields zero findings", () => {
  const events = committed("aaa", "hotels", { hotelId: "H100" });
  const rows = [row("aaa", "hotels", { hotelId: "H100" })];
  expect(runChecks(events, rows)).toEqual([]);
});

test("vendor row with no staged intent is a SHADOW_EFFECT", () => {
  const events = committed("aaa", "hotels", { hotelId: "H100" });
  const rows = [row("aaa", "hotels", { hotelId: "H100" }), row("zzz", "hotels", { hotelId: "H300" })];
  const findings = runChecks(events, rows);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.kind).toBe("SHADOW_EFFECT");
  expect(findings[0]!.subject).toBe("zzz");
  expect(findings[0]!.vendorEvidence).toHaveLength(1);
});

test("unknown row duplicating a known booking's item is a DUPLICATE_CHARGE", () => {
  const events = committed("aaa", "hotels", { hotelId: "H100" });
  const rows = [row("aaa", "hotels", { hotelId: "H100" }), row("zzz", "hotels", { hotelId: "H100" })];
  const findings = runChecks(events, rows);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.kind).toBe("DUPLICATE_CHARGE");
  // evidence carries both the legit row and the duplicate
  expect(findings[0]!.vendorEvidence).toHaveLength(2);
});

test("COMPENSATED on ledger but row still at vendor is a PHANTOM_COMPENSATION", () => {
  const events = [
    ...committed("aaa", "hotels", { hotelId: "H100" }),
    ev("aaa", "COMPENSATION_CALLED"),
    ev("aaa", "COMPENSATED"),
  ];
  const rows = [row("aaa", "hotels", { hotelId: "H100" })];
  const findings = runChecks(events, rows);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.kind).toBe("PHANTOM_COMPENSATION");
  expect(findings[0]!.subject).toBe("aaa");
});

test("non-terminal and ABORTED actions are WEDGED_SAGA findings", () => {
  const events = [
    ev("stuck", "STAGED", { type: "hotel.book", vendor: "hotels", params: {} }),
    ev("stuck", "CALLED", { attempt: 1 }),
    ev("dead", "STAGED", { type: "flight.book", vendor: "flights", params: {} }),
    ev("dead", "CALLED", { attempt: 1 }),
    ev("dead", "RECONCILED", { landed: false }),
    ev("dead", "CALLED", { attempt: 2 }),
    ev("dead", "RECONCILED", { landed: false }),
    ev("dead", "ABORTED", { attempts: 2 }),
  ];
  const findings = runChecks(events, []);
  expect(findings.map((f) => f.kind)).toEqual(["WEDGED_SAGA", "WEDGED_SAGA"]);
  expect(findings.map((f) => f.subject).sort()).toEqual(["dead", "stuck"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/checks.test.ts`
Expected: FAIL, cannot find module `../src/audit/checks.js`.

- [ ] **Step 3: Implement**

`src/audit/checks.ts`:

```ts
// Pure reconciliation: the ledger says what SHOULD be true, the vendor rows
// say what IS true. Every divergence is a named, evidenced finding. No LLM,
// no I/O: the auditor agent narrates these, it never invents its own.
import type { LedgerEvent } from "../ledger/types.js";
import { TERMINAL_STATES } from "../ledger/types.js";

export type BreakKind =
  | "SHADOW_EFFECT"
  | "DUPLICATE_CHARGE"
  | "PHANTOM_COMPENSATION"
  | "WEDGED_SAGA";

export interface OracleRow {
  key: string;
  vendor: string;
  item: Record<string, unknown>;
  createdAt: string;
}

export interface Finding {
  kind: BreakKind;
  vendor: string;
  subject: string;
  summary: string;
  ledgerEvidence: LedgerEvent[];
  vendorEvidence: OracleRow[];
}

interface FoldedAction {
  actionId: string;
  vendor: string;
  state: LedgerEvent["event"];
  events: LedgerEvent[];
}

function fold(events: LedgerEvent[]): Map<string, FoldedAction> {
  const byAction = new Map<string, FoldedAction>();
  for (const e of events) {
    let a = byAction.get(e.actionId);
    if (!a) {
      a = { actionId: e.actionId, vendor: "", state: e.event, events: [] };
      byAction.set(e.actionId, a);
    }
    a.state = e.event;
    a.events.push(e);
    if (e.event === "STAGED") a.vendor = String(e.payload.vendor ?? "");
  }
  return byAction;
}

export function runChecks(events: LedgerEvent[], rows: OracleRow[]): Finding[] {
  const actions = fold(events);
  const findings: Finding[] = [];

  const knownRows = rows.filter((r) => actions.has(r.key));
  const unknownRows = rows.filter((r) => !actions.has(r.key));
  const knownItemIndex = new Map<string, OracleRow>();
  for (const r of knownRows) knownItemIndex.set(`${r.vendor}:${JSON.stringify(r.item)}`, r);

  for (const r of unknownRows) {
    const twin = knownItemIndex.get(`${r.vendor}:${JSON.stringify(r.item)}`);
    if (twin) {
      findings.push({
        kind: "DUPLICATE_CHARGE",
        vendor: r.vendor,
        subject: r.key,
        summary: `vendor ${r.vendor} holds a second booking (key ${r.key}) duplicating authorized booking ${twin.key}`,
        ledgerEvidence: actions.get(twin.key)?.events ?? [],
        vendorEvidence: [twin, r],
      });
    } else {
      findings.push({
        kind: "SHADOW_EFFECT",
        vendor: r.vendor,
        subject: r.key,
        summary: `vendor ${r.vendor} holds booking ${r.key} that no ledger intent ever authorized`,
        ledgerEvidence: [],
        vendorEvidence: [r],
      });
    }
  }

  const rowByKey = new Map(rows.map((r) => [r.key, r]));
  for (const a of actions.values()) {
    if (a.state === "COMPENSATED" && rowByKey.has(a.actionId)) {
      findings.push({
        kind: "PHANTOM_COMPENSATION",
        vendor: a.vendor,
        subject: a.actionId,
        summary: `ledger says ${a.actionId} was compensated but vendor ${a.vendor} still holds the booking`,
        ledgerEvidence: a.events,
        vendorEvidence: [rowByKey.get(a.actionId)!],
      });
    }
    if (!TERMINAL_STATES.has(a.state) || a.state === "ABORTED") {
      const why = a.state === "ABORTED" ? "aborted after exhausting attempts" : `stuck at ${a.state}`;
      findings.push({
        kind: "WEDGED_SAGA",
        vendor: a.vendor,
        subject: a.actionId,
        summary: `action ${a.actionId} is ${why} and needs attention`,
        ledgerEvidence: a.events,
        vendorEvidence: rowByKey.has(a.actionId) ? [rowByKey.get(a.actionId)!] : [],
      });
    }
  }

  return findings;
}
```

- [ ] **Step 4: Green + full suite**

Run: `npm test -- test/checks.test.ts` then `npm test`
Expected: PASS everywhere.

- [ ] **Step 5: Commit**

```bash
git add src/audit/checks.ts test/checks.test.ts
git commit -m "feat: deterministic reconciliation checks over ledger and vendor truth"
```

---

### Task 3: Seeded history with planted breaks

**Files:**
- Create: `src/audit/seed.ts`, `scripts/seed.ts`
- Modify: `package.json` (add script `"seed": "tsx scripts/seed.ts"`)
- Test: `test/seed.test.ts`

**Interfaces:**
- Consumes: `Saga`, `Ledger`, `mintActionId`, `FLIGHTS`/`HOTELS` fixtures, `runChecks`/`OracleRow` from Task 2.
- Produces: `seed(opts: { ledgerPath: string; vendorDbPath: string }): Promise<SeedSummary>` where `SeedSummary = { sagas: number; actions: number; planted: { kind: BreakKind; subject: string }[] }`. Booking rows use the exact vendor-server schema `bookings(key TEXT PRIMARY KEY, vendor TEXT NOT NULL, item TEXT NOT NULL, created_at TEXT NOT NULL)`.

- [ ] **Step 1: Write the failing test**

`test/seed.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { seed } from "../src/audit/seed.js";
import { runChecks, type OracleRow } from "../src/audit/checks.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function scene() {
  const dir = mkdtempSync(join(tmpdir(), "saga-seed-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return { ledgerPath: join(dir, "ledger.db"), vendorDbPath: join(dir, "vendors.db") };
}

function oracleRows(vendorDbPath: string): OracleRow[] {
  const db = new DatabaseSync(vendorDbPath);
  const rows = db.prepare("SELECT * FROM bookings").all() as unknown as {
    key: string; vendor: string; item: string; created_at: string;
  }[];
  db.close();
  return rows.map((r) => ({
    key: r.key, vendor: r.vendor,
    item: JSON.parse(r.item) as Record<string, unknown>, createdAt: r.created_at,
  }));
}

test("seed produces a substantial history with exactly the planted breaks", async () => {
  const { ledgerPath, vendorDbPath } = scene();
  const summary = await seed({ ledgerPath, vendorDbPath });

  expect(summary.actions).toBeGreaterThanOrEqual(100);
  expect(summary.planted).toHaveLength(5);

  const ledger = new Ledger(ledgerPath);
  cleanups.push(() => ledger.close());
  const findings = runChecks(ledger.events(), oracleRows(vendorDbPath));

  const byKind = (k: string) => findings.filter((f) => f.kind === k);
  expect(byKind("SHADOW_EFFECT")).toHaveLength(2);
  expect(byKind("DUPLICATE_CHARGE")).toHaveLength(1);
  expect(byKind("PHANTOM_COMPENSATION")).toHaveLength(1);
  expect(byKind("WEDGED_SAGA")).toHaveLength(1);
  expect(findings).toHaveLength(5);
  // deterministic: planted subjects match what runChecks finds
  expect(findings.map((f) => f.subject).sort()).toEqual(summary.planted.map((p) => p.subject).sort());
});

test("seeding twice from scratch is deterministic", async () => {
  const a = scene();
  const b = scene();
  const s1 = await seed({ ledgerPath: a.ledgerPath, vendorDbPath: a.vendorDbPath });
  const s2 = await seed({ ledgerPath: b.ledgerPath, vendorDbPath: b.vendorDbPath });
  expect(s1.actions).toBe(s2.actions);
  expect(s1.planted.map((p) => p.kind)).toEqual(s2.planted.map((p) => p.kind));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/seed.test.ts`
Expected: FAIL, cannot find module `../src/audit/seed.js`.

- [ ] **Step 3: Implement**

`src/audit/seed.ts`:

```ts
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
    a |= 0; a = (a + 0x6d2b79f5) | 0;
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
  constructor(private db: DatabaseSync, private name: string) {}
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

export async function seed(opts: { ledgerPath: string; vendorDbPath: string }): Promise<SeedSummary> {
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
  let lastCommittedHotel: StagedAction | undefined;

  for (let i = 0; i < SAGAS; i++) {
    const sagaId = `hist-${String(i + 1).padStart(3, "0")}`;
    const legs = 2 + Math.floor(rng() * 3); // 2-4 actions per saga

    const staged: StagedAction[] = [];
    staged.push(saga.stage({ sagaId, type: "flight.book", vendor: "flights", params: { flightId: pick(FLIGHTS).id } }));
    if (legs >= 2) {
      const s = saga.stage({
        sagaId, type: "hotel.book", vendor: "hotels",
        params: { hotelId: pick(HOTELS).id, checkin: day(i), checkout: day(i + 2) },
      });
      staged.push(s);
      lastCommittedHotel = s;
    }
    if (legs >= 3) {
      staged.push(saga.stage({
        sagaId, type: "calendar.add", vendor: "calendar",
        params: { title: `Trip ${sagaId}`, startIso: `${day(i)}T09:00:00`, endIso: `${day(i + 2)}T17:00:00` },
      }));
    }
    for (const s of staged) {
      await saga.execute(s.actionId);
      actions++;
    }
    // every 8th trip was cancelled, so compensated history exists too
    if (i % 8 === 7) {
      const hotel = staged.find((s) => s.type === "hotel.book");
      await saga.cancel(sagaId);
      if (hotel) compensatedHotelIds.push(hotel.actionId);
    }
  }

  // plant the breaks, all on the hotels vendor (the demo's hot target)
  const planted: SeedSummary["planted"] = [];
  const insertRow = (key: string, item: Record<string, unknown>) =>
    db.prepare("INSERT INTO bookings (key, vendor, item, created_at) VALUES (?, 'hotels', ?, ?)")
      .run(key, JSON.stringify(item), new Date().toISOString());

  // 2x SHADOW_EFFECT: bookings no ledger intent ever authorized
  for (const item of [
    { hotelId: "H200", checkin: "2026-06-03", checkout: "2026-06-06" },
    { hotelId: "H300", checkin: "2026-06-15", checkout: "2026-06-16" },
  ]) {
    const key = mintActionId();
    insertRow(key, item);
    planted.push({ kind: "SHADOW_EFFECT", subject: key });
  }

  // 1x DUPLICATE_CHARGE: a second row copying a legit committed booking's item
  const twin = lastCommittedHotel!;
  const dupKey = mintActionId();
  insertRow(dupKey, twin.params);
  planted.push({ kind: "DUPLICATE_CHARGE", subject: dupKey });

  // 1x PHANTOM_COMPENSATION: resurrect a row the ledger believes is gone
  const phantomId = compensatedHotelIds[0]!;
  const phantomAction = { hotelId: "H100", checkin: "2026-06-08", checkout: "2026-06-10" };
  insertRow(phantomId, phantomAction);
  planted.push({ kind: "PHANTOM_COMPENSATION", subject: phantomId });

  // 1x WEDGED_SAGA: an action that never got past CALLED
  const wedgedId = mintActionId();
  ledger.append({ sagaId: "hist-wedged", actionId: wedgedId, event: "STAGED",
    payload: { type: "hotel.book", vendor: "hotels", params: { hotelId: "H200", checkin: "2026-06-20", checkout: "2026-06-21" } } });
  ledger.append({ sagaId: "hist-wedged", actionId: wedgedId, event: "CALLED", payload: { attempt: 1 } });
  planted.push({ kind: "WEDGED_SAGA", subject: wedgedId });

  // spread timestamps over the past 30 days, preserving seq order
  const total = (ledger.events()).length;
  const start = Date.parse("2026-06-11T00:00:00.000Z");
  const span = Date.parse("2026-07-10T00:00:00.000Z") - start;
  const stmt = db; // vendors db handled below
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
```

Note: the bookings `created_at` spread uses SQLite RANDOM() which is not seeded; determinism only matters for counts and planted subjects (what the test asserts), not row timestamps. If you prefer full determinism, use `(key || '') ` hashing; not required.

`scripts/seed.ts`:

```ts
// Wipe and reseed the demo world: a month of history plus 5 planted breaks.
import { mkdirSync, rmSync } from "node:fs";
import { seed } from "../src/audit/seed.js";
import { wipeLedger } from "../src/ledger/ledger.js";

mkdirSync("data", { recursive: true });
wipeLedger(process.env.LEDGER_PATH ?? "data/ledger.db");
for (const f of ["data/vendors.db", "data/vendors.db-wal", "data/vendors.db-shm"]) {
  rmSync(f, { force: true });
}
const summary = await seed({
  ledgerPath: process.env.LEDGER_PATH ?? "data/ledger.db",
  vendorDbPath: process.env.VENDOR_DB ?? "data/vendors.db",
});
console.log(`seeded ${summary.sagas} sagas, ${summary.actions} actions`);
console.log("planted breaks (keep this list handy for rehearsal):");
for (const p of summary.planted) console.log(`  ${p.kind}  ${p.subject}`);
console.log("note: restart the vendor server if it was running (its db file was replaced)");
```

Add to `package.json` scripts: `"seed": "tsx scripts/seed.ts"`.

- [ ] **Step 4: Green + full suite**

Run: `npm test -- test/seed.test.ts` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audit/seed.ts scripts/seed.ts package.json test/seed.test.ts
git commit -m "feat: seeded transaction history with planted reconciliation breaks"
```

---

### Task 4: Auditor tool handlers (offline)

**Files:**
- Create: `src/agent/audit-tools.ts`
- Test: `test/audit-tools.test.ts`

**Interfaces:**
- Consumes: `runChecks`, `OracleRow`, `Finding` (Task 2); `Ledger`; the vendor server's `GET /admin/bookings` (returns array of `{ bookingId, key, vendor, item, status, createdAt }`).
- Produces (used by Task 5):

```ts
export interface AuditContext { ledger: Ledger; vendorBase: string; reportsDir?: string; }
export function listVendors(ctx: AuditContext): Promise<{ vendor: string; vendorRows: number; ledgerActions: number }[]>;
export function runReconciliation(ctx: AuditContext, args: { vendor?: string }): Promise<{ checkedEvents: number; checkedRows: number; findings: CompactFinding[] }>;
export function actionTimeline(ctx: AuditContext, args: { actionId: string }): { events: { event: string; at: string; payload: Record<string, unknown> }[] };
export function saveReport(ctx: AuditContext, args: { markdown: string }): { path: string };
// CompactFinding = { kind, vendor, subject, summary, ledgerEvents: {event,at}[], vendorRows: {key,createdAt,item}[] }
```

- [ ] **Step 1: Write the failing tests**

`test/audit-tools.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { seed } from "../src/audit/seed.js";
import { startVendorServer, type VendorServer } from "../src/vendors/server.js";
import { actionTimeline, listVendors, runReconciliation, saveReport, type AuditContext } from "../src/agent/audit-tools.js";

let dir: string;
let server: VendorServer;
let ctx: AuditContext;
let ledger: Ledger;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "saga-audit-tools-"));
  const ledgerPath = join(dir, "ledger.db");
  const vendorDbPath = join(dir, "vendors.db");
  await seed({ ledgerPath, vendorDbPath });
  server = await startVendorServer({ dbPath: vendorDbPath, port: 0 });
  ledger = new Ledger(ledgerPath);
  ctx = { ledger, vendorBase: `http://127.0.0.1:${server.port}`, reportsDir: join(dir, "reports") };
});

afterAll(async () => {
  ledger.close();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

test("listVendors reports row and action counts per vendor", async () => {
  const vendors = await listVendors(ctx);
  const names = vendors.map((v) => v.vendor).sort();
  expect(names).toContain("hotels");
  expect(names).toContain("flights");
  const hotels = vendors.find((v) => v.vendor === "hotels")!;
  expect(hotels.vendorRows).toBeGreaterThan(0);
  expect(hotels.ledgerActions).toBeGreaterThan(0);
});

test("runReconciliation surfaces exactly the five planted breaks", async () => {
  const result = await runReconciliation(ctx, {});
  expect(result.findings).toHaveLength(5);
  expect(result.checkedEvents).toBeGreaterThan(100);
  const kinds = result.findings.map((f) => f.kind).sort();
  expect(kinds).toEqual([
    "DUPLICATE_CHARGE", "PHANTOM_COMPENSATION", "SHADOW_EFFECT", "SHADOW_EFFECT", "WEDGED_SAGA",
  ]);
});

test("runReconciliation can scope to one vendor", async () => {
  const flightsOnly = await runReconciliation(ctx, { vendor: "flights" });
  expect(flightsOnly.findings).toHaveLength(0); // all breaks are planted on hotels
});

test("actionTimeline returns the full event history for one action", async () => {
  const { findings } = await runReconciliation(ctx, {});
  const phantom = findings.find((f) => f.kind === "PHANTOM_COMPENSATION")!;
  const timeline = actionTimeline(ctx, { actionId: phantom.subject });
  const events = timeline.events.map((e) => e.event);
  expect(events[0]).toBe("STAGED");
  expect(events[events.length - 1]).toBe("COMPENSATED");
});

test("saveReport writes markdown under the reports dir", () => {
  const { path } = saveReport(ctx, { markdown: "# audit\nno findings" });
  expect(readFileSync(path, "utf8")).toContain("# audit");
  expect(path).toContain("reports");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/audit-tools.test.ts`
Expected: FAIL, cannot find module `../src/agent/audit-tools.js`.

- [ ] **Step 3: Implement**

`src/agent/audit-tools.ts`:

```ts
// The auditor's hands. Everything here is read-only toward the world: the
// only write is a local markdown report. Findings come from runChecks and
// nowhere else, so the model can narrate but never invent.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ledger } from "../ledger/ledger.js";
import { runChecks, type Finding, type OracleRow } from "../audit/checks.js";

export interface AuditContext {
  ledger: Ledger;
  vendorBase: string;
  reportsDir?: string;
}

interface AdminBooking {
  key: string;
  vendor: string;
  item: Record<string, unknown>;
  createdAt: string;
}

async function oracleRows(ctx: AuditContext): Promise<OracleRow[]> {
  const res = await fetch(`${ctx.vendorBase}/admin/bookings`);
  if (!res.ok) throw new Error(`vendor oracle answered ${res.status}`);
  const rows = (await res.json()) as AdminBooking[];
  return rows.map((r) => ({ key: r.key, vendor: r.vendor, item: r.item, createdAt: r.createdAt }));
}

export interface CompactFinding {
  kind: Finding["kind"];
  vendor: string;
  subject: string;
  summary: string;
  ledgerEvents: { event: string; at: string }[];
  vendorRows: { key: string; createdAt: string; item: Record<string, unknown> }[];
}

function compact(f: Finding): CompactFinding {
  return {
    kind: f.kind,
    vendor: f.vendor,
    subject: f.subject,
    summary: f.summary,
    ledgerEvents: f.ledgerEvidence.map((e) => ({ event: e.event, at: e.at })),
    vendorRows: f.vendorEvidence.map((r) => ({ key: r.key, createdAt: r.createdAt, item: r.item })),
  };
}

export async function listVendors(
  ctx: AuditContext,
): Promise<{ vendor: string; vendorRows: number; ledgerActions: number }[]> {
  const rows = await oracleRows(ctx);
  const events = ctx.ledger.events();
  const vendors = new Map<string, { vendorRows: number; ledgerActions: number }>();
  const bump = (name: string, field: "vendorRows" | "ledgerActions") => {
    const v = vendors.get(name) ?? { vendorRows: 0, ledgerActions: 0 };
    v[field]++;
    vendors.set(name, v);
  };
  for (const r of rows) bump(r.vendor, "vendorRows");
  for (const e of events) {
    if (e.event === "STAGED") bump(String(e.payload.vendor ?? "unknown"), "ledgerActions");
  }
  return [...vendors.entries()].map(([vendor, v]) => ({ vendor, ...v }));
}

export async function runReconciliation(
  ctx: AuditContext,
  args: { vendor?: string },
): Promise<{ checkedEvents: number; checkedRows: number; findings: CompactFinding[] }> {
  const rows = await oracleRows(ctx);
  const events = ctx.ledger.events();
  let findings = runChecks(events, rows);
  if (args.vendor) findings = findings.filter((f) => f.vendor === args.vendor);
  return { checkedEvents: events.length, checkedRows: rows.length, findings: findings.map(compact) };
}

export function actionTimeline(
  ctx: AuditContext,
  args: { actionId: string },
): { events: { event: string; at: string; payload: Record<string, unknown> }[] } {
  const events = ctx.ledger
    .events()
    .filter((e) => e.actionId === args.actionId)
    .map((e) => ({ event: e.event, at: e.at, payload: e.payload }));
  return { events };
}

export function saveReport(ctx: AuditContext, args: { markdown: string }): { path: string } {
  const dir = ctx.reportsDir ?? "reports";
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  const path = join(dir, `audit-${stamp}.md`);
  writeFileSync(path, args.markdown);
  return { path };
}
```

- [ ] **Step 4: Green + full suite**

Run: `npm test -- test/audit-tools.test.ts` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/audit-tools.ts test/audit-tools.test.ts
git commit -m "feat: auditor tool handlers over live vendor oracle"
```

---

### Task 5: Conversational auditor CLI

**Files:**
- Modify: `src/agent/run.ts` (export `localClaudePath`)
- Create: `src/agent/auditor.ts`, `scripts/audit.ts`
- Modify: `package.json` (add `"audit": "tsx scripts/audit.ts"`)

**Interfaces:**
- Consumes: Task 4 handlers, `localClaudePath` from run.ts, `Ledger`.
- Produces: `npm run audit -- "investigate the hotels vendor"` streams the auditor conversation. No unit tests (global constraint: no LLM in tests); verified by rehearsal in Task 7.

- [ ] **Step 1: Export the executable resolver**

In `src/agent/run.ts` change `function localClaudePath` to `export function localClaudePath`.

- [ ] **Step 2: Create the auditor wiring**

`src/agent/auditor.ts`:

```ts
// The second agent on the same substrate. It cannot book, cancel, or touch
// the world: its tools read the ledger and the vendor oracle, run the
// deterministic reconciliation checks, and save a markdown report. The model
// investigates and narrates; it is forbidden from claiming anything a tool
// did not return.
import {
  createSdkMcpServer,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { localClaudePath } from "./run.js";
import {
  actionTimeline,
  listVendors,
  runReconciliation,
  saveReport,
  type AuditContext,
} from "./audit-tools.js";

const AUDITOR_PROMPT = `You are the audit side of Saga, the transaction layer for AI agents. Every action any agent took is on an append-only ledger; the vendors hold their own records. Your job is reconciliation: find and explain every divergence between what the ledger authorized and what the vendors actually hold.

Method: start with run_reconciliation (optionally scoped to a vendor). For each finding, pull the action_timeline when ledger evidence exists, and explain the break in plain language: what the ledger says, what the vendor says, which one cannot be right. Never speculate; report only what the tools returned. Never use the word fraud: these are reconciliation breaks with evidence. Finish by saving a markdown report (save_report) with one section per finding, evidence included, then give a short verbal summary ordered by severity: unauthorized effects first, then duplicates, then phantom compensations, then wedged actions.`;

function asResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function asError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

export function buildAuditServer(ctx: AuditContext) {
  return createSdkMcpServer({
    name: "audit",
    version: "0.1.0",
    tools: [
      tool(
        "list_vendors",
        "Vendors known to the ledger and the oracle, with row and action counts. Read-only.",
        {},
        async () => listVendors(ctx).then(asResult).catch(asError),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "run_reconciliation",
        "Diff the ledger against vendor ground truth. Returns every reconciliation break with evidence. Optionally scope to one vendor. Read-only.",
        { vendor: z.string().optional() },
        async (args) => runReconciliation(ctx, args).then(asResult).catch(asError),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "action_timeline",
        "Full ledger event history for one actionId. Read-only.",
        { actionId: z.string() },
        async (args) => asResult(actionTimeline(ctx, args)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "save_report",
        "Save the final audit report as markdown. The only write this agent has.",
        { markdown: z.string() },
        async (args) => asResult(saveReport(ctx, args)),
      ),
    ],
  });
}

function shorten(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export async function runAuditor(ctx: AuditContext, promptText: string): Promise<void> {
  const stream = query({
    prompt: promptText,
    options: {
      systemPrompt: AUDITOR_PROMPT,
      mcpServers: { audit: buildAuditServer(ctx) },
      allowedTools: ["mcp__audit__*"],
      tools: [],
      maxTurns: 30,
      pathToClaudeCodeExecutable: localClaudePath(),
    },
  });

  for await (const message of stream) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          console.log(`\nauditor> ${block.text}`);
        } else if (block.type === "tool_use") {
          console.log(`  -> ${block.name} ${JSON.stringify(block.input)}`);
        }
      }
    } else if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type === "tool_result") {
          const text = Array.isArray(block.content)
            ? block.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join(" ")
            : String(block.content ?? "");
          console.log(`  <- ${shorten(text.replaceAll("\n", " "))}`);
        }
      }
    } else if (message.type === "result" && message.subtype !== "success") {
      console.error(`\nauditor run ended without success: ${message.subtype}`);
    }
  }
}
```

`scripts/audit.ts`:

```ts
// Talk to Saga's auditor: npm run audit -- "investigate the hotels vendor"
import { Ledger } from "../src/ledger/ledger.js";
import { runAuditor } from "../src/agent/auditor.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file is fine
}

const promptText = process.argv.slice(2).join(" ").trim();
if (!promptText) {
  console.error('usage: npm run audit -- "investigate the hotels vendor"');
  process.exit(2);
}

const ledger = new Ledger(process.env.LEDGER_PATH ?? "data/ledger.db");
await runAuditor(
  {
    ledger,
    vendorBase: process.env.VENDOR_URL ?? "http://127.0.0.1:4100",
    reportsDir: "reports",
  },
  promptText,
);
ledger.close();
```

Add to `package.json` scripts: `"audit": "tsx scripts/audit.ts"`. Add `reports/` to `.gitignore` EXCEPT the fallback report: append to `.gitignore`:

```
# audit reports are generated, except the committed demo fallback
reports/*
!reports/audit-fallback.md
```

- [ ] **Step 3: Typecheck + suite + live smoke**

Run: `npx tsc --noEmit && npm test`
Expected: clean, all green.

Live smoke (vendors running, seeded): `npm run seed && npm run vendors` (separate pane) then `npm run audit -- "investigate the hotels vendor"`.
Expected: visible tool calls, findings narrated matching the 5 planted breaks, report saved under reports/.

- [ ] **Step 4: Commit**

```bash
git add src/agent/run.ts src/agent/auditor.ts scripts/audit.ts package.json .gitignore
git commit -m "feat: conversational auditor agent cli"
```

---

### Task 6: Landing page

**Files:**
- Create: `site/index.html`, `scripts/site.ts`
- Modify: `package.json` (add `"site": "tsx scripts/site.ts"`)

**Interfaces:**
- Consumes: nothing from other tasks (static content).
- Produces: `npm run site` serves the page on port 4400.

- [ ] **Step 1: Static server**

`scripts/site.ts`:

```ts
// Serve the landing page locally: npm run site
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const page = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "index.html");
const port = Number(process.env.SITE_PORT ?? 4400);
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(page, "utf8"));
}).listen(port, "127.0.0.1", () => {
  console.log(`saga landing page on http://127.0.0.1:${port}`);
});
```

- [ ] **Step 2: Write the page**

`site/index.html`: single self-contained file (inline CSS, no external requests, no build step). Dark theme consistent with the viewer (bg #0d1117, text #e6edf3, accent green #3fb950). Responsive (max-width 1100px column, stacks on mobile). Sections in exact order, with this copy as the anchor (tighten, do not pad):

1. Nav: "SAGA" + links (How it works, Use it, GitHub -> https://github.com/vjadh07/saga).
2. Hero: h1 "The transaction layer for AI agents." Sub: "Agents are getting the power to book, pay, and cancel. Saga makes every action they take crash-safe, verified, and undoable, on an append-only ledger." Buttons: "See it survive kill -9" (anchor to how-it-works), "View on GitHub".
3. Problem strip, three cards: "Agents crash mid-action" / "Vendors lie: the call fails but the charge lands" / "Nobody can prove what an agent did". One sentence each.
4. HOW IT WORKS: triptych in Colossus style: STAGE ("intent hits the ledger before any network call"), VERIFY ("the response is never trusted; the vendor's own records are consulted"), COMMIT ("only confirmed effects are committed; anything else retries, aborts, or compensates"). Below: the state machine line `STAGED -> CALLED -> RECONCILED -> COMMITTED (or COMPENSATION_CALLED -> COMPENSATED, or ABORTED)` and two short stories: the kill -9 recovery (exactly-once) and the audit (reconciliation breaks with evidence).
5. HOW TO USE IT: quickstart code block:

```
git clone https://github.com/vjadh07/saga && cd saga && npm install
npm test                # 55+ tests incl. a real kill -9 round trip
npm run vendors         # mock vendors :4100
npm run viewer          # live ledger :4200
npm run agent -- "book me a flight to SFO next friday"
CRASH_AFTER="hotel.book:CALLED" npm run agent -- "...trip..."   # murder it
npm run agent -- "finish booking my trip"                        # exactly-once recovery
npm run seed && npm run audit -- "investigate the hotels vendor" # the audit side
```

   plus a "wrap your own tool" snippet showing stage + execute around any side effect (use the real API: `saga.stage({ sagaId, type, vendor, params })` then `saga.execute(actionId)`).
6. Architecture: simple inline SVG or styled boxes: Agent -> Saga engine -> Ledger (SQLite) and Vendors; Auditor reading Ledger + Vendors.
7. Footer: repo link, "Built at [hackathon] 2026".

- [ ] **Step 3: Verify**

Run: `npm run site` and open http://127.0.0.1:4400. Check: renders, no horizontal scroll at narrow width, all anchors work, zero external network requests (devtools network tab), no em dashes in copy, the word fraud absent.

- [ ] **Step 4: Commit**

```bash
git add site/index.html scripts/site.ts package.json
git commit -m "feat: saga landing page"
```

---

### Task 7: Demo runbook v2, fallback report, docs, rehearsal

**Files:**
- Modify: `docs/demo.md`, `README.md`, `HANDOFF.md`
- Create: `reports/audit-fallback.md` (generated by a real audit run, then committed)

- [ ] **Step 1: Rewrite docs/demo.md act structure**

Keep setup + act 1 (crash) and act 2 (recovery, renamed "Act 2: the resurrection") exactly as they are. Replace act 3 (cancel) with a shorter beat inside act 2's close ("ask it to cancel if judges want the unwind"), and add the new headline act:

Act 3, the audit: `npm run seed` (note: restart the vendor server after seeding, its db file is replaced), then `npm run audit -- "investigate the hotels vendor"`. Presenter types the prompt, never a judge. Expected beats: reconciliation runs, five breaks surface, auditor walks the two damning ones (shadow bookings the ledger never authorized, the duplicate charge), saves the report. Fallback: if the model stalls more than 15 seconds, open reports/audit-fallback.md and read the SHADOW_EFFECT and DUPLICATE_CHARGE sections aloud.

Update the rehearsal checklist: acts 1-3 twice back to back; after each seed run confirm `npm run audit` findings count is exactly 5.

- [ ] **Step 2: Generate the fallback report**

With vendors running and world seeded, run `npm run audit -- "run a full reconciliation and save a complete audit report"`, then copy the saved report to `reports/audit-fallback.md` and commit it (gitignore already excepts it).

- [ ] **Step 3: README + HANDOFF**

README: add "The audit side" section after "What is in the box": one paragraph (auditor agent, deterministic checks, reconciliation-break taxonomy, `npm run seed` + `npm run audit` quickstart lines) and add the landing page (`npm run site`) to the quickstart. HANDOFF: current state updated (audit layer built), Next section updated (rehearse on demo machine), record observed auditor transcript summary.

- [ ] **Step 4: Full rehearsal, twice**

Run the updated docs/demo.md top to bottom twice. Verify: act 1 exit 137 with hotel at CALLED; act 2 recovery line + all COMMITTED + real calendar event; act 3 auditor finds exactly 5 breaks and saves a report. Both runs converge.

- [ ] **Step 5: Commit and push**

```bash
git add docs/demo.md README.md HANDOFF.md reports/audit-fallback.md
git commit -m "docs: demo runbook v2 with audit act and fallback report"
git push origin main
```

---

## Self-review notes

- Spec coverage: ABORTED (T1), checks with all four break kinds (T2), deterministic seed with 5 planted breaks concentrated on hotels (T3), read-only auditor tools (T4), conversational auditor with no-fraud prompt and save_report as only write (T5), full landing page (T6), runbook v2 + fallback + rehearsal (T7). Viewer badge folded into T1. Cuts honored: no ML detection, no auditor writes, no new vendors, markdown-only reports.
- Type consistency: `OracleRow`, `Finding`, `BreakKind` defined once (T2) and imported in T3/T4; `AuditContext` defined in T4 and used in T5; `localClaudePath` exported in T5 step 1 before use.
- The seed test doubles as the checks integration test, and audit-tools tests exercise the real vendor server over HTTP, so every layer under the LLM is covered without ever calling the LLM.
