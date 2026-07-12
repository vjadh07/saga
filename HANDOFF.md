# HANDOFF

Shared notes so any agent (Claude Code or Codex) can pick this up cold.

## Current state
- Idea LOCKED: Saga, the transaction layer for AI agents. A council of 3 judge subagents (infra engineer, devtools VC, demo director lenses) voted 3-0 for Saga over Understory and Baton. No pivots from here.
- Public repo live: https://github.com/vjadh07/saga
- Scope decisions (Viraj picked): Google Calendar is the ONE real integration, agent brain is the Claude Agent SDK riding the local Claude Code login, demo surface is terminal plus a read-only web ledger viewer.
- Stack: TypeScript on Node >= 22.5 (node:sqlite), Vitest, ESM. Design spec at docs/design.md, task plan at docs/plan.md.
- Plan Tasks 0 through 14 are DONE: ledger, engine (stage, execute, reconcile, recover, cancel, receipt), mock vendor server, http adapter, real kill -9 crash test, agent tool handlers, live Agent SDK booking agent, ledger viewer, Google Calendar adapter, demo runbook (docs/demo.md) and README. 49 tests green across 13 files.
- Two engine changes landed during demo rehearsal: reset now wipes the ledger in place (wipeLedger) because unlinking the file left a running viewer reading the dead inode, and receipts now carry each action's staged params because trip_status without them forced the model to ask the user for dates it should have known.
- Council's shared warning: the kill -9 recovery moment is the demo's single point of failure. The crash must trigger at a deterministic step against canned mock-vendor responses, rehearsed, never manual timing.

## Rehearsal record (2026-07-11)
The docs/demo.md script was executed three times against the mock calendar. Run 1 completed all three acts and surfaced the two engine fixes above (act 2 was retaken after the receipt fix). Runs 2 and 3 were clean top to bottom with the final code. Every run converged to the same final state: flight.book, hotel.book, calendar.add all COMPENSATED after act 3, vendor oracle empty, and the act 1 crash always landed as flight COMMITTED plus hotel CALLED with no hotel row at the vendor.

## Task 11 smoke run (observed 2026-07-11, verbatim tool lines)
Vendors on 4100, state reset, then `npm run agent -- "book me a one way flight from PHX to SFO next friday"`:

```
agent> I'll check the trip ledger status first (in case of a prior session) and search flights for next Friday, 2026-07-17.
  -> mcp__saga__trip_status {}
  <- {   "sagaId": "trip",   "status": "committed",   "actions": [] }
  -> mcp__saga__search_flights {"from":"PHX","to":"SFO","date":"2026-07-17"}
  <- [ F100 $129, F200 $189, F300 $240 fixture rows ]
  -> mcp__saga__book_flight {"flightId":"F100"}
  <- {   "actionId": "qt2kg14tmcsn5ipl1sps4trcde",   "state": "COMMITTED" }
agent> Booked and committed. Now adding the calendar event covering the flight.
  -> mcp__saga__add_calendar_event {"title":"Flight PHX -> SFO (Saguaro Air F100)","startIso":"2026-07-17T09:15:00","endIso":"2026-07-17T11:05:00"}
  <- {   "actionId": "ockijfgs3f8uqj5ah8hvhsj2af",   "state": "COMMITTED" }

=== ledger receipt ===
trip trip: committed
  flight.book    COMMITTED    qt2kg14tmcsn5ipl1sps4trcde
  calendar.add   COMMITTED    ockijfgs3f8uqj5ah8hvhsj2af
```

The model's closing chat summary is elided here (it styles with em dashes); it correctly reported both commits and offered a hotel. Vendor oracle GET /admin/bookings confirmed exactly two rows, keys equal to the two actionIds, both confirmed. It picked the cheapest flight unprompted and called trip_status first, matching the system prompt.

## Working with Codex
- The official Codex plugin for Claude Code is installed (codex@openai-codex, user scope). Codex CLI 0.144.0 is on PATH and logged in via ChatGPT.
- From Claude Code: /codex:review and /codex:adversarial-review for second-opinion reviews, /codex:rescue to delegate a task, /codex:status and /codex:result for background jobs. Run /reload-plugins once if the commands are not visible.
- Do not enable the plugin's review gate, it can loop and drain usage limits.

## Next
- Everything in docs/plan.md is done and verified, including the real calendar leg. Remaining is demo-day prep only: run the docs/demo.md rehearsal checklist twice back to back on the demo machine before going on.

## Google Calendar: LIVE and verified (2026-07-11)
- OAuth done: Google Cloud project saga-demo (owned by virajj852@gmail.com, not the ASU account), Calendar API enabled, consent screen External/Testing with virajj852@gmail.com as test user, desktop client saga-cli. Creds in .env, token in .secrets/gcal-token.json, both gitignored.
- Gotcha hit on the way: the consent screen was first set to Internal, which 403s (org_internal) for a plain Gmail account because it is not a member of the Cloud org. External + test user is the right shape.
- Live verification observed: `npm run agent -- "book me a one way flight ... add it to my calendar"` printed `[calendar] real Google Calendar`, committed flight.book and calendar.add, and an independent events.get showed the event confirmed on the real calendar. `npm run agent -- "cancel my whole trip"` compensated both in reverse order and events.get then showed status cancelled (Google tombstones deletes as cancelled; the adapter treats 404 and cancelled as gone, so reconcile verified the undo).
- Viraj's Google Calendar display timezone is Asia/Kolkata, so event times render shifted in the API output; the stored events carry the Mac's timezone (America/Los_Angeles) and are correct.

## Standing rules (do not violate)
- No em dashes anywhere: code, comments, docs, chat. Plain student tone.
- Plain commit messages. No AI co-author or "generated with" trailers.
- TDD always: failing test first, watch it fail, minimal code, watch it pass, commit.
- Demo must be deterministic and mock-backed, ONE real integration max.
- Agent reasoning must be genuinely LLM-driven and visible, never a scripted checklist.
- Never output an unverified claim. If it was not checked, say so.

## Gotchas
- Viraj's home directory (~) is itself accidentally a git repo. This project lives in ~/Projects/saga, its own repo, unaffected.
- Viraj's Node is x64 and runs under Rosetta on this arm64 Mac, so npm installs the Agent SDK's darwin-x64 bundled claude binary, and that binary spins at 100% CPU forever (even on --help). src/agent/run.ts therefore resolves the locally installed native arm64 claude from PATH and passes it as pathToClaudeCodeExecutable; override with CLAUDE_CODE_PATH if needed. Do not remove that or the agent hangs.
- The act 1 SIGKILL orphans the SDK's claude subprocess. Harmless, but `pkill -f "local/bin/claude --output-format"` between rehearsals keeps things tidy (docs/demo.md fallback section).
