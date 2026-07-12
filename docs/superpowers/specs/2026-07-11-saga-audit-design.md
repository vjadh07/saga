# Saga audit layer: design spec

Date: 2026-07-11. Status: awaiting Viraj's approval. Direction chosen by a 3-0 council vote (infra engineer, devtools VC, demo director) over control-plane, standalone fraud agent, and polish-only alternatives.

## Goal

Make Saga demonstrably a transaction LAYER, not a travel bot, by putting a second, very different agent on the same substrate: a conversational read-only **auditor agent** (part of Saga, no separate brand) that investigates the ledger against vendor ground truth and surfaces **reconciliation breaks** with evidence. The word "fraud" is banned in code, docs, and pitch; every finding is a named invariant violation with receipt rows.

## What the auditor proves

The ledger protocol defines what SHOULD be true. The auditor checks what IS true:

| Invariant violation | Meaning | How it is planted in demo data |
|---|---|---|
| SHADOW_EFFECT | Vendor holds a booking whose key matches no actionId ever STAGED on the ledger | Row inserted directly into vendors.db |
| DUPLICATE_CHARGE | A second vendor row duplicating the item of a legitimately committed booking, under an unknown key | Copy of a real booking's item under a fresh key |
| PHANTOM_COMPENSATION | Ledger says COMPENSATED but the vendor still holds the booking | Ledger events appended without deleting the vendor row |
| WEDGED_SAGA | An action stuck in a non-terminal state (or ABORTED) needing attention | A saga seeded mid-flight; plus any real ABORTED action |

Detection is 100% deterministic SQL/data diffing in pure functions. The LLM never detects anything; it chooses which checks to run, narrates the evidence, and writes the report. Model drives, engine guarantees, same as the booking agent.

## Components

1. **Engine fix, ABORTED terminal state** (also fixes a real bug the council found): an execute() that exhausts its 2 reconcile attempts currently wedges the saga forever (parks at RECONCILED, cancel ignores it, receipt says in_flight permanently). Change: after the final not-landed reconcile, append ABORTED, then throw SagaExecutionError as before. ABORTED joins TERMINAL_STATES. recover() treats it as terminal. receipt() maps sagas containing ABORTED to status "mixed" unless everything else is compensated. One existing reconcile test changes intentionally (last event becomes ABORTED, not RECONCILED).

2. **Seed script** `scripts/seed.ts`: deterministic (fixed RNG seed), writes ~150 historical actions across ~40 sagas and the three vendors into a fresh ledger + vendors db via the real engine (so timelines are authentic), then plants exactly 5 breaks: 2 SHADOW_EFFECT, 1 DUPLICATE_CHARGE, 1 PHANTOM_COMPENSATION, 1 WEDGED_SAGA, concentrated on one "hot" vendor (hotels) so the demo investigation has a target. `npm run seed`.

3. **Audit module** `src/audit/checks.ts`: pure, fully unit-tested functions taking (ledger events, vendor oracle rows) and returning typed findings: `{ kind, vendor, evidence: { ledgerRows, vendorRows }, explanation }`. No LLM, no I/O beyond its inputs.

4. **Auditor agent** `src/agent/auditor.ts` + `scripts/audit.ts` (`npm run audit -- "investigate the hotels vendor"`): conversational agent, Claude Agent SDK, same visible tool streaming. Tools, all read-only toward the world: `list_vendors`, `run_reconciliation` (runs the audit checks, returns compact findings), `action_timeline` (full event history for one actionId), `save_report` (writes markdown audit report to `reports/`). System prompt forbids claiming anything without a finding from the tools.

5. **Landing page** `site/index.html`: self-contained static page with the full company treatment, sections in order: hero ("Saga. The transaction layer for AI agents") with one-line pitch and CTA to the repo; WHAT IT DOES (the problem: agents touching money, crashes, lying vendors; the guarantee: exactly-once, verified, undoable, audited); HOW IT WORKS (Stage -> Verify -> Commit triptych in Colossus style, the ledger state machine, the kill -9 recovery story, the audit/reconciliation story); HOW TO USE IT (quickstart: npm install/clone, wrap a tool in a saga action with a real code snippet, run the agent, run the audit); architecture sketch; footer with repo link. Self-contained (no CDNs), dark, responsive, deployable via GitHub Pages later; `npm run site` serves it locally for the demo.

6. **Demo runbook v2** `docs/demo.md`: act 1 unchanged (crash + exactly-once recovery + real calendar). Act 2: `npm run seed`, then the presenter (never a judge) types the rehearsed prompt "investigate the hotels vendor"; the auditor runs reconciliation live, surfaces the planted breaks with evidence, saves the report. Fallback: pre-generated report committed to the repo; if the model stalls 15+ seconds, read the two damning lines from it.

## Out of scope (council-mandated cuts)

Statistical/ML anomaly detection, any auditor write/remediation ability toward vendors, new vendor types, report styling beyond markdown, viewer redesign (only an ABORTED badge color is added), pause/approve control plane (roadmap slide only).

## Testing

TDD throughout, existing rules hold (no LLM, no real network in tests). New tests: ABORTED semantics (execute, recover, receipt, cancel interplay), seed determinism and break placement, every audit check against seeded fixtures (each finds exactly its planted breaks, zero false positives on clean data), auditor tool handlers as plain functions. The live auditor run is verified in rehearsal like the booking agent was.

## Risks

The demo's act 2 depends on a live LLM narration: mitigated by pre-shaped compact tool outputs, a rehearsed exact prompt, and the committed fallback report. The ABORTED change touches the engine core 4 days out: mitigated by doing it first, TDD, full suite green before anything else builds on it.
