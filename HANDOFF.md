# HANDOFF

Shared notes so any agent (Claude Code or Codex) can pick this up cold.

## Current state
- Repo just initialized. No app code yet.
- Idea council in progress: 3 parallel judges scoring Saga vs Understory vs Baton.

## Next
- Tally council votes, lock the idea.
- Brainstorm scope with Viraj (a couple of sharp questions max).
- Write docs/design.md and a bite-sized test-first plan, then build.

## Standing rules (do not violate)
- No em dashes anywhere: code, comments, docs, chat. Plain student tone.
- Plain commit messages. No AI co-author or "generated with" trailers.
- TDD always: failing test first, watch it fail, minimal code, watch it pass, commit.
- Demo must be deterministic and mock-backed, ONE real integration max.
- Agent reasoning must be genuinely LLM-driven and visible, never a scripted checklist.
- Never output an unverified claim. If it was not checked, say so.
- Idea is LOCKED once picked. No pivots.

## Gotchas
- Viraj's home directory (~) is itself accidentally a git repo. This project lives in ~/Projects/saga, its own repo, unaffected.
