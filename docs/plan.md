# Saga Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Saga, a transaction layer that lets an AI agent take real-world actions crash-safely: staged, verified against vendor ground truth, committed or compensated, on an append-only SQLite ledger.

**Architecture:** A core engine (ledger + executor + reconciler + recovery + compensator) used by a Claude Agent SDK booking agent. Mock vendors run as a separate localhost process with their own SQLite state so they survive the agent being killed. One real vendor adapter: Google Calendar. A read-only web viewer renders the ledger live.

**Tech Stack:** TypeScript, Node >= 22.5 (built-in `node:sqlite`), ESM, Vitest, tsx, @anthropic-ai/claude-agent-sdk + zod (agent), googleapis (calendar only).

## Global Constraints

- No em dashes anywhere: code, comments, docs, commit messages.
- Plain commit messages, no AI co-author or "generated with" trailers.
- TDD: failing test first, watch it fail, minimal code, watch it pass, commit. One commit per green test cycle (a task may hold a few closely related tests before its commit if they land together).
- Never claim success without ground truth. The engine must not write COMMITTED unless a reconcile query confirmed the effect exists, and must not write COMPENSATED unless a reconcile query confirmed the effect is gone.
- Demo determinism: mock vendors use fixed fixtures, the crash fires at a configured ledger transition, never manual timing. Google Calendar is the only real network dependency, used only in the live demo, never in tests.
- Tests never call the real LLM or the real Calendar API. Agent tool handlers are tested as plain functions; SDK and googleapis glue is exercised in the live demo.
- All SQLite via `node:sqlite` `DatabaseSync`, WAL mode. No native dependencies.
- Ports: mock vendors 4100, viewer 4200 (tests always listen on port 0 and read the assigned port).
- Secrets live in `.secrets/` (gitignored). `.env.example` documents every env var.

## Test cycle convention

Every task follows the same five steps, so tasks below list only the content: (1) write the failing test(s), (2) `npm test -- <file>` and confirm the exact failure, (3) minimal implementation, (4) `npm test` green, (5) commit with the task's message.

## File structure

```
src/ledger/ledger.ts        append-only event store + state fold
src/ledger/types.ts         event and action types
src/core/ids.ts             idempotency key minting (calendar-safe alphabet)
src/core/saga.ts            engine: stage, execute, recover, cancel, receipt
src/core/errors.ts          SagaExecutionError, CompensationError
src/vendors/types.ts        VendorAdapter interface
src/vendors/server.ts       mock vendor HTTP server (own SQLite state)
src/vendors/fixtures.ts     fixed flight and hotel search data
src/vendors/http-adapter.ts VendorAdapter over the mock server
src/vendors/calendar.ts     Google Calendar VendorAdapter
src/agent/tools.ts          tool handlers as plain functions
src/agent/run.ts            Claude Agent SDK wiring + terminal streaming
src/viewer/server.ts        read-only ledger API + static page
src/viewer/index.html       polling timeline UI
scripts/vendors.ts          start mock vendors on 4100
scripts/viewer.ts           start viewer on 4200
scripts/agent.ts            run the agent (reads CRASH_AFTER)
scripts/gcal-auth.ts        one-time OAuth loopback flow
scripts/reset.ts            wipe ledger + vendor state for rehearsal
test/*.test.ts              one test file per task area
```

---

### Task 0: Scaffold

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `test/smoke.test.ts`.

`package.json`: `"type": "module"`, scripts `test: vitest run`, `vendors: tsx scripts/vendors.ts`, `viewer: tsx scripts/viewer.ts`, `agent: tsx scripts/agent.ts`, `reset: tsx scripts/reset.ts`. Dev deps: typescript, vitest, tsx, @types/node. No runtime deps yet.

- [ ] Smoke test `expect(1 + 1).toBe(2)`, watch vitest run it, commit.

**Commit:** `chore: scaffold typescript project with vitest`

### Task 1: Ledger

**Files:** Create `src/ledger/types.ts`, `src/ledger/ledger.ts`, `test/ledger.test.ts`.

**Produces:**

```ts
type EventType = "STAGED" | "CALLED" | "RECONCILED" | "COMMITTED" | "COMPENSATION_CALLED" | "COMPENSATED";
interface LedgerEvent { seq: number; sagaId: string; actionId: string; event: EventType; payload: Record<string, unknown>; at: string; }
interface ActionState { actionId: string; sagaId: string; state: EventType; staged: Record<string, unknown>; events: LedgerEvent[]; }
class Ledger {
  constructor(path: string);              // ":memory:" allowed in tests
  append(e: Omit<LedgerEvent, "seq" | "at">): LedgerEvent;
  events(sagaId?: string): LedgerEvent[];
  actions(sagaId: string): ActionState[]; // fold: last event per action wins; staged = STAGED payload
  inFlight(sagaId: string): ActionState[]; // state not in (COMMITTED, COMPENSATED)
  close(): void;
}
```

Schema: `events(seq INTEGER PRIMARY KEY AUTOINCREMENT, saga_id TEXT NOT NULL, action_id TEXT NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL, at TEXT NOT NULL)`, `PRAGMA journal_mode = WAL`.

- [ ] Tests: append returns seq and timestamp; events come back in seq order; fold derives per-action state; inFlight excludes terminal states; reopening the same file path sees identical events (durability); appends are immediately visible to a second Ledger instance on the same file.

**Commit:** `feat: append-only sqlite ledger with state fold`

### Task 2: Idempotency keys and staging

**Files:** Create `src/core/ids.ts`, `src/core/saga.ts`, `src/core/errors.ts`, `test/stage.test.ts`.

**Produces:**

```ts
mintActionId(): string; // 26 chars from [a-v0-9] (base32hex lowercase), valid as a Google Calendar event id
interface StagedAction { actionId: string; sagaId: string; type: string; vendor: string; params: Record<string, unknown>; }
class Saga {
  constructor(opts: { ledger: Ledger; vendors: Record<string, VendorAdapter>; onEvent?: (e: LedgerEvent) => void });
  stage(a: { sagaId: string; type: string; vendor: string; params: Record<string, unknown> }): StagedAction;
}
```

- [ ] Tests: minted ids match `/^[a-v0-9]{26}$/` and 1000 mints are unique; stage() writes a STAGED event carrying type, vendor, params before returning; onEvent fires with the appended event.

**Commit:** `feat: idempotency key minting and action staging`

### Task 3: Executor happy path

**Files:** Modify `src/core/saga.ts`, create `src/vendors/types.ts`, `test/execute.test.ts` with an in-memory `FakeVendor` that records every call in order.

**Produces:**

```ts
interface VendorAdapter {
  call(action: StagedAction): Promise<Record<string, unknown>>;
  reconcile(actionId: string): Promise<{ landed: boolean; record?: Record<string, unknown> }>;
  compensate(action: StagedAction): Promise<void>; // must be idempotent
}
Saga.execute(actionId: string): Promise<ActionState>;
```

execute() order is the whole point: append CALLED, then vendor.call, then vendor.reconcile, then append RECONCILED with the verdict, then append COMMITTED only if landed.

- [ ] Tests: ledger sequence is exactly STAGED, CALLED, RECONCILED, COMMITTED; vendor.call invoked exactly once with the staged action; RECONCILED payload contains `landed: true`; COMMITTED is refused (throws SagaExecutionError, no COMMITTED event) if a hostile fake reports `landed: false` forever.

**Commit:** `feat: executor drives staged actions through reconcile to commit`

### Task 4: Reconciler decision table

**Files:** Modify `src/core/saga.ts`, create `test/reconcile.test.ts`.

Decision table for execute(), each row is a test with a purpose-built fake vendor:

| call outcome | reconcile says | engine does |
|---|---|---|
| ok | landed | COMMITTED |
| throws | landed (the vendor lied with an error) | COMMITTED, no second call |
| throws | not landed | retry: second CALLED, call again, reconcile again, then commit |
| throws | not landed twice (2 attempts max) | SagaExecutionError, last event RECONCILED not-landed, no COMMITTED |
| ok or throws | reconcile itself throws | SagaExecutionError, action stays at CALLED, safe to recover later |

- [ ] One test per row asserting the exact ledger event sequence and vendor call count.

**Commit:** `feat: reconciliation decision table with bounded retry`

### Task 5: Recovery

**Files:** Modify `src/core/saga.ts`, create `test/recover.test.ts`.

**Produces:** `Saga.recover(sagaId: string): Promise<ActionState[]>` : for every in-flight action, resume forward. Policy: STAGED means declared intent, so recovery executes it. CALLED or RECONCILED means side effects may exist, so recovery reconciles first and finishes exactly-once. COMPENSATION_CALLED resumes compensation (Task 6).

Crash simulation: `onEvent` hook throws a sentinel `CrashSignal` after a chosen event, aborting execute() mid-flight exactly like a dead process, since every append is already durable when the hook fires. Then build a fresh Saga on the same ledger file and recover().

- [ ] Tests, one per crash point, each asserting the vendor's effect happened exactly once after recovery: crash after STAGED; crash after CALLED with the call never sent; crash after CALLED with the call landed (the double-booking case, recovery must NOT call again); crash after RECONCILED before COMMITTED.

**Commit:** `feat: crash recovery converges to exactly-once effects`

### Task 6: Compensation and receipts

**Files:** Modify `src/core/saga.ts`, create `test/cancel.test.ts`.

**Produces:**

```ts
Saga.cancel(sagaId: string): Promise<ActionState[]>;  // unwind COMMITTED actions, newest commit first
Saga.receipt(sagaId: string): { sagaId: string; status: "committed" | "compensated" | "mixed" | "in_flight"; actions: { actionId: string; type: string; state: EventType; timeline: { event: EventType; at: string }[] }[] };
```

cancel() per action: append COMPENSATION_CALLED, vendor.compensate, vendor.reconcile must report `landed: false`, then append COMPENSATED. If reconcile still sees the effect, CompensationError, action stays COMPENSATION_CALLED, cancel is resumable via recover().

- [ ] Tests: unwind order is reverse commit order (assert via fake vendor call log); COMPENSATED only after reconcile confirms gone; a compensate that fails mid-list leaves later actions COMMITTED and rerunning cancel() finishes the job; receipt reflects states and timeline for the whole saga.

**Commit:** `feat: reverse-order compensation and ledger receipts`

### Task 7: Mock vendor server

**Files:** Create `src/vendors/server.ts`, `src/vendors/fixtures.ts`, `test/vendor-server.test.ts`.

`startVendorServer(opts: { dbPath: string; port: number }): Promise<{ port: number; close(): Promise<void> }>` using node:http and its own DatabaseSync. Routes:

- `GET /:vendor/search` returns fixture arrays (flights: 3 fixed rows with id, route, time, price; hotels: 3 fixed rows).
- `POST /:vendor/bookings` body `{ key, item }`: idempotent upsert keyed on `key`; returns the same booking for a repeated key with no duplicate row. If the key is armed in failures, it books internally and then responds 500 (the ambiguous failure).
- `GET /:vendor/bookings/:key` 200 with the booking or 404.
- `DELETE /:vendor/bookings/:key` idempotent, 204 even if absent.
- `POST /admin/failures` body `{ key, mode: "ambiguous_500" }` arms one failure; `GET /admin/bookings` full table for test oracles; `POST /admin/reset` wipes state.

- [ ] Tests over real HTTP on port 0: search is deterministic; double POST same key yields one row; armed key books then 500s exactly once; GET 404 for unknown; DELETE idempotent.

**Commit:** `feat: mock vendor server with idempotent bookings and scripted ambiguous failure`

### Task 8: HTTP vendor adapter + engine integration

**Files:** Create `src/vendors/http-adapter.ts`, `test/integration.test.ts`.

**Produces:** `httpVendor(baseUrl: string, vendorName: string): VendorAdapter` mapping call to POST bookings (key = actionId), reconcile to GET (404 means not landed), compensate to DELETE.

- [ ] Integration tests against a real server instance: full saga commits and the vendor table is the oracle; the ambiguous 500 path ends COMMITTED with exactly one booking (reconciliation catches the lie); cancel() empties the vendor table.

**Commit:** `feat: http vendor adapter, engine verified against live mock vendor`

### Task 9: True kill -9 crash test

**Files:** Create `scripts/crash-child.ts`, `test/kill9.test.ts`, create `src/core/crash.ts`.

`src/core/crash.ts`: `installCrashHarness(saga: Saga, spec: string | undefined)` : when `CRASH_AFTER="<actionType>:<event>"` matches an appended event, `process.kill(process.pid, "SIGKILL")`. The demo and this test share this exact code path.

`scripts/crash-child.ts`: boots Ledger + Saga + http adapters from env (LEDGER_PATH, VENDOR_URL), runs recover() then stages and executes a flight then a hotel booking.

- [ ] Test: spawn the child with `CRASH_AFTER="hotel.book:CALLED"` against a vendor server; child dies with SIGKILL; assert hotel side effect landed but ledger shows CALLED; respawn without CRASH_AFTER; child recovers and exits 0; oracle shows exactly one flight and one hotel booking; ledger all COMMITTED.

**Commit:** `feat: real sigkill crash harness survives and recovers exactly-once`

### Task 10: Agent tool handlers (offline)

**Files:** Create `src/agent/tools.ts`, `test/tools.test.ts`.

**Produces:**

```ts
interface TripContext { saga: Saga; sagaId: string; vendorBase: string; }
searchFlights(ctx, { from, to, date }): Promise<Flight[]>;          // GET, read-only, not through saga
searchHotels(ctx, { city, checkin, checkout }): Promise<Hotel[]>;
bookFlight(ctx, { flightId }): Promise<{ actionId: string; state: EventType }>;   // stage + execute via saga
bookHotel(ctx, { hotelId, checkin, checkout }): Promise<{ actionId: string; state: EventType }>;
addCalendarEvent(ctx, { title, startIso, endIso }): Promise<{ actionId: string; state: EventType }>;
cancelTrip(ctx): Promise<Receipt>;   // saga.cancel + receipt
tripStatus(ctx): Receipt;            // saga.receipt, lets the model see ground truth
```

- [ ] Tests against mock vendor server + real engine: booking tools produce COMMITTED actions and vendor rows; cancelTrip empties them and returns a compensated receipt; searches return fixtures. No LLM anywhere.

**Commit:** `feat: agent tool handlers wired through the saga engine`

### Task 11: Claude Agent SDK wiring

**Files:** Create `src/agent/run.ts`, `scripts/agent.ts`, `scripts/vendors.ts`, `scripts/reset.ts`. Add deps: @anthropic-ai/claude-agent-sdk, zod.

`run.ts`: wraps Task 10 handlers with `tool()` + zod schemas into `createSdkMcpServer({ name: "saga" })`, calls `query()` with a travel-booking system prompt, the saga MCP server, allowedTools restricted to the saga tools, and streams to the terminal: model text, every tool call with args, every tool result, so the reasoning is visibly real (lesson 1). On boot it always runs `saga.recover()` before taking the user's request, then installs the crash harness.

No unit tests for the SDK glue (global constraint: no LLM in tests). Verification is a live smoke run:

- [ ] `npm run vendors` in one pane, then `npm run agent -- "book me a one way flight from PHX to SFO next friday"`; confirm visible tool calls and a COMMITTED flight in the receipt, and record the observed transcript in HANDOFF.md.

**Commit:** `feat: claude agent sdk booking agent with visible tool streaming`

### Task 12: Ledger viewer

**Files:** Create `src/viewer/server.ts`, `src/viewer/index.html`, `scripts/viewer.ts`, `test/viewer.test.ts`.

`startViewer(opts: { ledgerPath: string; port: number })`: `GET /api/ledger` returns `{ actions: ActionState[], events: LedgerEvent[] }` for all sagas, read-only; `GET /` serves index.html which polls every 500ms and renders one row per action with a state badge and event timeline. Vanilla JS, no build step.

- [ ] Test: /api/ledger reflects events appended to the ledger file by a separate Ledger instance (proves cross-process visibility through WAL). UI checked manually in the browser.

**Commit:** `feat: read-only live ledger viewer`

### Task 13: Google Calendar adapter

**Files:** Create `src/vendors/calendar.ts`, `scripts/gcal-auth.ts`, `.env.example`, `test/calendar.test.ts`. Add dep: googleapis.

Adapter takes an injected calendar client (so tests use a fake): call = `events.insert` with `id: actionId` (ids are already calendar-safe from Task 2), reconcile = `events.get` where 404 or a `cancelled` status means not landed, compensate = `events.delete` treating 404/410 as already gone. `scripts/gcal-auth.ts`: OAuth installed-app loopback flow on port 4300, token saved to `.secrets/gcal-token.json`. Requires Viraj once for the Google Cloud OAuth client and consent click.

- [ ] Tests with a fake client: insert called with the actionId as event id; reconcile maps 404 and cancelled to not landed; compensate swallows 404/410 but surfaces other errors; a second compensate is a no-op.
- [ ] Manual once creds exist: real event appears and disappears on the actual calendar.

**Commit:** `feat: google calendar vendor adapter with client-generated event ids`

### Task 14: Demo orchestration and docs

**Files:** Create `docs/demo.md`, modify `README.md`, `scripts/agent.ts` (crash config), `scripts/reset.ts`.

docs/demo.md is the runbook: three panes (vendors, viewer, agent), act 1 books with `CRASH_AFTER="hotel.book:CALLED"`, act 2 restarts the agent which recovers and finishes including the real calendar event, act 3 asks to cancel the trip and reads the receipt. Includes the rehearsal checklist (run reset, run the full script twice back to back, confirm identical ledgers) and a fallback note. README gets the real project story, architecture sketch, and quickstart.

- [ ] Verify by executing the full runbook top to bottom twice and confirming both runs converge to identical final states.

**Commit:** `docs: demo runbook and full readme`

---

## Self-review notes

- Spec coverage: ledger (T1), engine states and idempotency (T2-T4), crash recovery (T5, T9), compensation and receipt (T6), mock vendors with scripted ambiguous failure (T7-T8), agent with visible reasoning (T10-T11), viewer (T12), one real integration (T13), deterministic demo (T9, T14). Marketplace and hosted service are out of scope per spec.
- The "never claim success unverified" rule is enforced structurally: COMMITTED and COMPENSATED are only writable on a confirming reconcile, and Tasks 3, 4, and 6 test the refusal paths.
- Type names used across tasks were cross-checked: StagedAction, ActionState, LedgerEvent, VendorAdapter, EventType are defined once (T1-T3) and reused verbatim.
