# Saga demo runbook

Three acts: book a trip and get killed mid-action, restart and recover exactly-once, then cancel everything and read the receipt. The crash is a real SIGKILL fired by the crash harness at a fixed ledger event, so it lands the same way every run.

## Setup: three panes

Pane 1, mock vendors (own process and SQLite state, so they survive the agent dying):

```
npm run vendors
```

Pane 2, live ledger viewer, then open http://127.0.0.1:4200 in a browser:

```
npm run viewer
```

Pane 3 is the agent. Fresh state before showtime:

```
npm run reset
```

If Google Calendar is wired (one-time `npm run gcal-auth`, needs GCAL_CLIENT_ID and GCAL_CLIENT_SECRET in .env), the calendar leg is real and the event appears on the actual calendar in act 2. Without it the mock stands in; the agent prints which one it is using at boot.

## Act 1: the crash

```
CRASH_AFTER="hotel.book:CALLED" npm run agent -- "book me a one way flight from PHX to SFO next friday and a hotel in san francisco friday to sunday, then add the trip to my calendar"
```

What the audience sees: the model reasons out loud, searches, books the flight (COMMITTED on the viewer), then starts the hotel and the process dies mid-action, no goodbye. The viewer shows the truth: flight COMMITTED, hotel stuck at CALLED. Say it plainly: the ledger recorded the intent before the network call, and the process is gone.

Point at the vendor oracle if asked: `curl -s http://127.0.0.1:4100/admin/bookings` shows one flight row and no hotel row. The hotel call never left the building; a naive agent restarting here would have no idea whether it did.

## Act 2: the resurrection

```
npm run agent -- "finish booking my trip"
```

On boot, before the model gets a word in, the engine replays every in-flight action: it asks the hotel vendor "did my call land?", hears no, and re-executes exactly once. Then the model reads trip_status, sees flight and hotel committed, and finishes the job: the calendar event (real one if wired). Final receipt: three actions, all COMMITTED.

The exactly-once claim is not vibes: test/kill9.test.ts proves both directions with a real SIGKILL, including the nasty case where the effect landed but the crash beat the COMMITTED write, and recovery must NOT call again.

## Act 3: the unwind

```
npm run agent -- "cancel my whole trip"
```

The model calls cancel_trip. The engine compensates newest commit first, verifies each undo against the vendor before writing COMPENSATED, and returns the receipt. The model walks through what was undone and in what order. Vendor oracle is empty; the ledger keeps the full story forever (append-only, nothing deleted).

## Rehearsal checklist (do this twice, back to back)

1. `npm run reset`
2. Act 1: agent dies by SIGKILL, viewer shows flight COMMITTED and hotel CALLED, oracle has one flight row, zero hotel rows.
3. Act 2: recovery line prints before the model speaks, receipt ends with flight, hotel, calendar all COMMITTED, oracle has exactly one row each.
4. Act 3: receipt shows every action COMPENSATED, undo order is reverse commit order, oracle is empty.
5. Confirm run 2 converged to the same final action states as run 1 (ids and timestamps differ, states and counts must not).

## Fallbacks

- The model books in a weird order or skips the hotel: reset and rerun. The prompt pins the order; fixtures and the cheap-flight preference keep it on rails. This has not happened in rehearsal, but the reset takes five seconds.
- The agent hangs at boot: the SDK is probably not finding the native claude CLI. `which claude` must resolve; see the Rosetta gotcha in HANDOFF.md.
- A stray claude subprocess can outlive the SIGKILL in act 1. It is harmless (its stdin is dead), but `pkill -f "claude --output-format"` between rehearsals keeps ps clean.
- Vendors or viewer die: both are stateless processes over their SQLite files, just restart the pane.
