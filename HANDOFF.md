# HANDOFF

Shared notes so any agent (Claude Code or Codex) can pick this up cold.

## Current state
- Idea LOCKED: Saga, the transaction layer for AI agents. A council of 3 judge subagents (infra engineer, devtools VC, demo director lenses) voted 3-0 for Saga over Understory and Baton. No pivots from here.
- Public repo live: https://github.com/vjadh07/saga
- Scope decisions (Viraj picked): Google Calendar is the ONE real integration, agent brain is the Claude Agent SDK riding the local Claude Code login, demo surface is terminal plus a read-only web ledger viewer.
- Stack: TypeScript on Node >= 22.5 (node:sqlite), Vitest, ESM. Design spec at docs/design.md, task plan at docs/plan.md.
- Plan Tasks 0 through 11 are DONE: ledger, engine (stage, execute, reconcile, recover, cancel, receipt), mock vendor server, http adapter, real kill -9 crash test, agent tool handlers, and the live Agent SDK booking agent. 40 tests green across 11 files.
- Council's shared warning: the kill -9 recovery moment is the demo's single point of failure. The crash must trigger at a deterministic step against canned mock-vendor responses, rehearsed, never manual timing.

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
- Task 12: read-only ledger viewer (API + polling page), TDD per docs/plan.md.
- Task 13: Google Calendar adapter with an injected fake client in tests. The one-time OAuth setup (Google Cloud client + consent click) needs Viraj in the loop; schedule it when the adapter lands.
- Task 14: demo runbook, README, rehearse the full crash demo twice back to back.

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
