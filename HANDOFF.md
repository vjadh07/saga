# HANDOFF

Shared notes so any agent (Claude Code or Codex) can pick this up cold.

## Current state
- Idea LOCKED: Saga, the transaction layer for AI agents. A council of 3 judge subagents (infra engineer, devtools VC, demo director lenses) voted 3-0 for Saga over Understory and Baton. No pivots from here.
- Public repo live: https://github.com/vjadh07/saga
- Scope decisions (Viraj picked): Google Calendar is the ONE real integration, agent brain is the Claude Agent SDK riding the local Claude Code login, demo surface is terminal plus a read-only web ledger viewer.
- Stack: TypeScript on Node, Vitest, better-sqlite3 for the ledger. Design spec committed at docs/design.md. No app code yet.
- Council's shared warning: the kill -9 recovery moment is the demo's single point of failure. The crash must trigger at a deterministic step against canned mock-vendor responses, rehearsed, never manual timing.

## Working with Codex
- The official Codex plugin for Claude Code is installed (codex@openai-codex, user scope). Codex CLI 0.144.0 is on PATH and logged in via ChatGPT.
- From Claude Code: /codex:review and /codex:adversarial-review for second-opinion reviews, /codex:rescue to delegate a task, /codex:status and /codex:result for background jobs. Run /reload-plugins once if the commands are not visible.
- Do not enable the plugin's review gate, it can loop and drain usage limits.

## Next
- Write the bite-sized test-first plan at docs/plan.md.
- Then TDD build in plan order: ledger, core engine, mock vendors, recovery, compensation, agent, viewer, calendar leg last.
- Google Calendar OAuth setup needs Viraj in the loop (one-time Google Cloud clicking), schedule it when the adapter lands.

## Standing rules (do not violate)
- No em dashes anywhere: code, comments, docs, chat. Plain student tone.
- Plain commit messages. No AI co-author or "generated with" trailers.
- TDD always: failing test first, watch it fail, minimal code, watch it pass, commit.
- Demo must be deterministic and mock-backed, ONE real integration max.
- Agent reasoning must be genuinely LLM-driven and visible, never a scripted checklist.
- Never output an unverified claim. If it was not checked, say so.

## Gotchas
- Viraj's home directory (~) is itself accidentally a git repo. This project lives in ~/Projects/saga, its own repo, unaffected.
