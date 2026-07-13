# Saga: adversarial evidence-auditing agent

## Positioning

Saga does not ask users to trust AI. It gives them the receipts.

An adversarial evidence-auditing agent that verifies AI-generated content before
someone trusts, publishes, or acts on it. It extracts atomic claims, contracts in
advance what would prove or disprove each one, investigates for support, independently
tries to disprove, detects when many sources trace to one origin, flags outdated
claims, quarantines prompt injection in retrieved content, and returns a claim-level
audit with a corrected draft the user approves.

## What the pivot reuses (verified by inspection)

The transaction-layer engine is not the product anymore, but its infrastructure is a
direct fit and stays:

- **Append-only SQLite ledger** (`src/ledger/`): becomes the Agent Flight Recorder.
  Same durability, same wipe-in-place, same WAL.
- **Read-only Agent SDK pattern** (`src/agent/auditor.ts`, `run.ts`): the Investigator,
  Skeptic, and Arbiter are read-only agents built exactly this way, including the
  `localClaudePath()` Rosetta workaround and the `tools: []` lockdown so retrieved
  content can never invoke a tool.
- **Pure deterministic checks** (`src/audit/checks.ts`): the model for source-lineage,
  safety, temporal, arbiter, passport code. No LLM, no I/O, fully tested.
- **Conventions**: zod schemas, Vitest TDD, tsx scripts, NodeNext ESM, node:sqlite.

The booking domain (flights/hotels/calendar/compensation) is kept intact and runnable
as legacy, not deleted, because it is tested and it is a second honest "receipts" story.

## Design principle: deterministic spine, LLM at the edges

Per the spec's reliability rules, conventional deterministic code does the load-bearing
reasoning; the LLM is used only where interpretation or planning is genuinely needed.

- **Deterministic (pure, tested):** claim normalization + hashing, evidence-contract
  structure, source-lineage grouping (shingling + Jaccard, shared quotations, canonical
  URL, shared primary source, timestamp clustering), safety detection + HTML
  sanitization, temporal supersession, verdict aggregation, confidence banding, Trust
  Passport metrics, corrected-draft assembly, flight-recorder state transitions.
- **LLM (Agent SDK, live):** extracting candidate claims from prose, framing and revising
  search queries, selecting exact supporting/contradicting passages, writing the
  human-readable explanation and corrected prose. The LLM never decides a verdict on its
  own and never invents a citation: verdicts are a deterministic function of retrieved
  evidence, and every cited evidence id is validated against what was actually retrieved.

This makes the demo repeatable (the hard parts are deterministic over a fixture corpus)
and keeps tests free of any real LLM or network call, matching the existing project rule.

## Impact-ordered build

The single strongest demo moment, per the brief, is Saga discovering that several
apparently independent sources trace to one misleading press release while
simultaneously quarantining an instruction meant to manipulate it. The order below
front-loads exactly that.

1. Typed workflow schemas + claim model.
2. **Source-lineage detection** (marquee innovation).
3. **Safety Sentinel** + injection quarantine.
4. Temporal verification.
5. Grounded Arbiter verdicts + abstention.
6. Trust Passport + document status.
7. Corrected draft with tracked changes.
8. Flight Recorder on the ledger.
9. Deterministic demo fixtures (report + source corpus + injection page).
10. Pipeline orchestrator + `npm run verify` CLI demo (the reliable, repeatable demo).
11. SagaBench eval set + baseline comparison.
12. Live LLM agents wired through the deterministic spine.
13. Web UI: input, investigation, 3-panel audit workspace, evidence graph, passport.
14. README + docs + regression pass.

Stages 1-10 give a complete, reliable, deterministic end-to-end demo on their own. The
LLM agents (12) and web UI (13) layer on top without changing the tested spine.

## Verdict + confidence vocabulary (fixed)

Verdicts: `supported`, `supported_with_qualifications`, `contradicted`, `disputed`,
`outdated`, `insufficient_evidence`, `not_verifiable`.
Confidence: `low`, `medium`, `high`. No unexplained percentages anywhere.

## Standing rules carried over

No em dashes anywhere. Plain commit messages, no AI co-author trailer. TDD: failing test
first. Tests never call a real LLM or the network. Never output an unverified claim.
