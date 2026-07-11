# Saga design

## The problem

AI agents are starting to take real-world actions: book, pay, send, cancel. Real processes crash, networks drop, and vendor APIs time out after doing the work. An agent that dies between "charge the card" and "record that I charged the card" leaves the world double-charged or half-finished, and nobody can tell what actually happened. Databases solved this decades ago with transactions. Agents have nothing.

## What Saga is

Saga is a transaction layer that sits between an agent and the outside world. Every side-effecting action goes through a small state machine recorded on an append-only ledger:

STAGED -> CALLED -> RECONCILED -> COMMITTED or COMPENSATED

- STAGED: the agent declares intent. Saga mints an idempotency key and durably records the action before anything touches the network.
- CALLED: recorded before the vendor call goes out, so a crash mid-call is always detectable.
- RECONCILED: Saga asks the vendor for ground truth ("does a booking with this key exist?") instead of trusting the call's response. Ambiguous outcomes (timeout, 500 after partial work) get resolved here.
- COMMITTED: verified done. COMPENSATED: verified undone via the action's compensating action (cancel, refund, delete).

Because every transition is durably written before the risky step it precedes, Saga can be killed at any instant, restarted, and recover by replaying the ledger and reconciling in-flight actions against vendor ground truth. Cancel unwinds committed actions in reverse order and prints a receipt of what happened to the world.

## Architecture

TypeScript on Node, Vitest for tests, better-sqlite3 for durability. Two processes plus a viewer:

1. `src/ledger/`: the append-only event log in SQLite (WAL mode). Events are inserted, never updated. Current action state is derived by folding events. This is the system of record and the thing that survives kill -9.
2. `src/core/`: the Saga engine. Staging (idempotency key minting), the executor (drives the state machine), the reconciler (queries vendor ground truth and decides landed vs not-landed), recovery (scan ledger for in-flight actions on startup), and the compensator (reverse-order unwind).
3. `src/vendors/`: a small vendor adapter interface: `call(action, key)`, `reconcile(key)`, `compensate(action, key)`. Mock vendors (flights, hotels) run as a separate localhost HTTP process with their own SQLite state, so they survive the agent's death and can answer reconciliation queries honestly. Fixture data is fixed, responses deterministic. Vendors support scripted ambiguous failures (e.g. "commit internally, then return a 500") to demo reconciliation catching a lie.
4. `src/agent/`: the demo booking agent, built on the Claude Agent SDK riding the local Claude Code login. Its tools (search flights, book flight, book hotel, add to calendar, cancel trip) route every side effect through Saga. The model genuinely plans and picks tools; its reasoning streams in the terminal. No scripted fallback pretending to think.
5. `src/viewer/`: a read-only local web page that polls the ledger and renders the live action timeline. Display only, it cannot affect the demo.

One real integration: Google Calendar as a vendor adapter. The Calendar API accepts client-generated event IDs, which makes it a textbook idempotency demo: call = insert event with our key as the ID, reconcile = get event by ID, compensate = delete by ID. OAuth token stays local and gitignored.

## The demo (deterministic by construction)

1. Ask the agent to book a two-leg trip. It books the flight (mock), starts the hotel (mock), and the crash harness kills the agent process at a fixed ledger transition (env-controlled, never manual timing), right after the hotel CALLED event.
2. Restart. Recovery finds the in-flight hotel action, reconciles against the vendor with the idempotency key, sees the booking landed, and completes without double-booking. The trip finishes, including the real Google Calendar event.
3. "Cancel the trip." The compensator unwinds in reverse order (calendar event deleted, hotel canceled, flight canceled) and prints a receipt from the ledger.

Mock vendors keep every run identical; the calendar leg is the single real touchpoint. The crash point and the vendor's scripted failure are configuration, so the whole thing repeats on the tenth run.

## Testing approach

TDD throughout, commit per passing test. The core suite includes a crash-point matrix: simulate a kill between every adjacent pair of states and assert recovery converges with no duplicate side effects (mock vendor state is the oracle). Reconciliation gets a decision table (landed, not landed, vendor lied, vendor unreachable). Compensation gets ordering and partial-failure tests. The agent layer is integration-tested with a stub model client so tests stay offline; the real model runs only in the live demo.

## Out of scope (on purpose)

Multi-tenant auth, hosted service, the per-vendor contract marketplace (it is the vision slide, not the build), real airline/hotel APIs, retries with backoff tuning, and any UI beyond the read-only ledger viewer.
