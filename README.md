# saga

The transaction layer for AI agents.

Agents are starting to touch money and irreversible actions: book, pay, send, cancel. When one crashes halfway through, the world is left double-charged or half-finished, and the agent that restarts has no idea what it already did. Saga fixes that the way databases fixed it decades ago: a write-ahead ledger and a strict protocol around every side effect.

Every action an agent takes goes through five steps on an append-only SQLite ledger:

```
STAGED -> CALLED -> RECONCILED -> COMMITTED
                                  (or COMPENSATION_CALLED -> COMPENSATED on cancel)
```

The engine writes the intent down before the network call goes out, asks the vendor "did that land?" before believing any response, and refuses to write COMMITTED until ground truth confirms the effect exists. Kill the process at any point (a real `kill -9`, no cleanup) and the next boot replays every in-flight action to exactly-once completion: calls that never left are re-sent, calls that landed are never repeated.

## What is in the box

- `src/ledger/` append-only event store with a state fold, WAL mode, readable live by other processes
- `src/core/` the engine: stage, execute, reconcile (bounded retry, decision table), recover, cancel (reverse-order compensation), receipts, plus the SIGKILL crash harness the demo and tests share
- `src/vendors/` mock flight/hotel/calendar vendors as a separate HTTP process with their own SQLite state, an adapter over them, and a real Google Calendar adapter (event ids are minted calendar-safe, so inserts are idempotent by construction)
- `src/agent/` a Claude Agent SDK booking agent whose only tools are saga tools; its reasoning streams to the terminal, every tool call visible
- `src/viewer/` a read-only web page that polls the ledger and shows every action's timeline live

The nasty case is covered: the mock vendors can be armed to book internally and then answer 500. The agent's call "fails", reconciliation catches the vendor's lie, and the booking commits exactly once instead of twice.

## Quickstart

Node >= 22.5 (the ledger uses node:sqlite). For the agent, a logged-in local Claude Code install.

```
npm install
npm test                 # 49 tests: engine, vendors, recovery, a real kill -9 round trip
npm run vendors          # pane 1: mock vendors on :4100
npm run viewer           # pane 2: ledger viewer on :4200
npm run agent -- "book me a one way flight from PHX to SFO next friday"
```

Crash it on purpose and watch it recover:

```
CRASH_AFTER="hotel.book:CALLED" npm run agent -- "book a flight to SFO and a hotel"
npm run agent -- "finish booking my trip"
npm run agent -- "cancel my whole trip"
```

The full three-act demo script is in [docs/demo.md](docs/demo.md). The design spec is in [docs/design.md](docs/design.md).

## The one real integration

Google Calendar. `npm run gcal-auth` runs a one-time OAuth loopback flow (needs `GCAL_CLIENT_ID` and `GCAL_CLIENT_SECRET`, see `.env.example`); after that the calendar leg of a trip writes real events to a real calendar, through the exact same ledger protocol, and cancelling the trip really deletes them. Without credentials the mock stands in and the agent says so at boot.

## Why "saga"

It is the saga pattern from distributed systems, applied to a new kind of unreliable node: an LLM agent with a kill switch. Long-lived transaction, sequence of steps, each with a compensating action, coordinated by a log. The old idea holds up; the new part is that the thing driving it plans in English and books hotels.
