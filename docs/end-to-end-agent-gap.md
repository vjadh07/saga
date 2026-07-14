# End-to-end agent gap analysis

This document records what arbitrary user text can reach in Live mode, what remains
deterministic or mock-backed, and what is only a documented production design. A feature
counts as Live only when the production composition can reach it without a gold label,
preselected fixture passage, fixture verdict, or `DEMO_CORPUS`.

## Current phase

The stale gap that once ended at `/api/map` is closed in the current implementation.
Deterministic numerical verification, grounded arbitration, contradiction resolution,
grounded revision, receipt generation, and the complete provider-backed orchestration are
implemented. The requested P0 workflow and P1 local hardening are present.

The remaining gaps are external smoke verification and production infrastructure. The
local implementation uses guest access, an in-process worker, SQLite, and browser polling.
It does not implement login, billing, teams, a managed queue, PostgreSQL, object storage,
autoscaling, or Server-Sent Events.

## Current Live path

```text
Studio textarea
  -> POST /api/audits
  -> guest Live audit record in SQLite
  -> in-process job
  -> AuditService
       -> Claim Mapper through AgentSdkModelProvider
       -> deterministic claim assembly and limits
       -> runLiveAudit
            -> evidence contract and Research Planner
            -> Investigator search and secure page fetch
            -> Skeptic search and secure page fetch
            -> Safety Sentinel and source hashing
            -> citation validation and source quality
            -> lineage, temporal, and numerical verification
            -> contradiction resolution and grounded Arbiter
            -> claim dependencies and re-evaluation markers
            -> Revision Agent and corrected draft
            -> Trust Passport and tamper-evident receipt
       -> completed, partially_completed, failed, or cancelled state

Browser
  -> polls GET /api/audits/:id
  -> renders persisted status, real events, result, and receipt
```

This path is implemented by `scripts/studio.ts`, `src/verify/live/http.ts`,
`src/verify/live/composition.ts`, `src/verify/live/service.ts`, and
`src/verify/live/audit.ts`. The browser polls. There is no SSE endpoint.

## Mode separation

| Property | Live | Demo |
| --- | --- | --- |
| Entry point | `/` and `POST /api/audits` | `/demo` |
| Input | Arbitrary submitted text | Committed demo document |
| Model | Claude Agent SDK provider | None for the fixture audit |
| Search | Brave Search provider | Labeled fixture corpus |
| Pages | Secure live fetcher | Fixture content |
| Persistence | SQLite audit store | Embedded deterministic result |
| Failure behavior | Explicit partial, failed, or cancelled state | Unchanged deterministic fixture |
| Fixture labels allowed | No | Yes, by design |

Live does not silently switch to Demo. The Live module graph is tested to exclude
`pipeline.ts`, `corpus.ts`, `bench.ts`, and `fixtures/`. Runtime guards reject
fixture-shaped stance, relevance, and `relatesTo` labels at the Live boundary. The full
mock-provider integration test supplies ordinary search results and page text, then lets
the Live pipeline derive evidence and verdicts.

## Implemented P0 capabilities

| Capability | Current evidence |
| --- | --- |
| Claim mapping | Structured model response, Zod validation, exact substring assembly, and production-composition test |
| Research planning | Structured per-claim plan created before retrieval and bounded by mode |
| Investigator | Separate supporting queries, secure retrieval, excerpt presence checks, and real event records |
| Skeptic | Separate counterqueries and assessments without an Investigator verdict input |
| Citation verification | Entity, metric, period, population, strength, qualifier, relation, and exact-match checks |
| Source quality | Structured quality factors and accepted or rejected result per source |
| Lineage | Real retrieved sources grouped by deterministic provenance signals |
| Temporal verification | Claim scope, claim date, evidence date, and supersession rules |
| Numerical verification | Deterministic percent change, ratio, total, average, unit conversion, market share, and date interval calculations from grounded extracted inputs |
| Contract enforcement | `ContractEvaluation` gates arbitration and records unmet and abstention conditions |
| Contradiction resolution | Structured cause and reconciliation analysis runs when validated support and contradiction coexist |
| Arbiter | Deterministic verdict over accepted evidence, quality, time, numeric result, conflict result, and contract evaluation |
| Revision Agent | Model-proposed prose must cite accepted evidence and pass verdict and numeric validation; deterministic prose is the fallback |
| Corrected draft | Validated changes applied at original claim offsets while preserving the submitted document |
| Trust Passport | Counts derived from claim verdicts and the same cited source graph used by lineage |
| Receipt | Canonical hash over document, final draft, executed searches, retrievals, sources, evidence, numeric checks, contracts, verdicts, revisions, safety, and failures |
| Fixture isolation | Static graph tests, runtime boundary tests, and full mock-provider integration coverage |

The numerical calculation itself is deterministic. A model may identify candidate input
values, but every accepted value must be grounded in the claim or validated evidence and
the claimed result is recomputed in code.

The Arbiter has no search or fetch tool. Its output is a deterministic function of the
validated audit graph. Model explanations from earlier stages cannot add an unvalidated
evidence ID or override a failed contract.

## Implemented P1 local hardening

| Capability | Current implementation |
| --- | --- |
| Persistence | `SqliteAuditStore`, WAL mode, idempotent artifact keys, and persisted final result |
| Refresh | Audit ID in the URL and polling reload from `GET /api/audits/:id` |
| Retry | Allowed only from partial, failed, or cancelled state; prior derived output is cleared |
| Cancellation | Abort signal propagated through mapping, orchestration, and provider wrappers |
| Timeouts | 60 seconds for mapping, five minutes for the audit, and per-mode provider call deadlines |
| Partial claims | One claim exception produces a `failed` claim while other claims continue |
| Resource limits | Per-mode claims, searches, model calls, page fetches, attempts, and call timeout |
| Metrics | Duration, counts, retries, and optional configured per-call cost estimate |
| Evaluation | Small hidden-label deterministic mock orchestration check in `npm run eval` |
| Demo reset | `npm run demo:reset` clears local databases and leaves the Demo fixture unchanged |

Default provider limits are:

| Mode | Claims | Searches | Model calls | Page fetches | Attempts | Provider timeout |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Quick | 4 | 16 | 100 | 32 | 2 | 12 seconds |
| Deep | 8 | 64 | 400 | 128 | 2 | 15 seconds |
| High-stakes | 12 | 144 | 900 | 288 | 2 | 20 seconds |

`npm run eval` does not call external services. The case builders contain claims, ordinary
mock search results, and ordinary mock pages. They do not contain scripted model answers.
A stateless test model derives structured responses from the claim, excerpt, and page text
in each request after the runner captures the input. The gold map is consulted after the
Live result returns. Runner inputs contain no gold verdict, stance, relevance, citation,
or expected-verdict labels. This is a non-circular orchestration regression check, not a
general accuracy evaluation.

## Phase status against the original 26-step plan

| Phase group | Status |
| --- | --- |
| 1 to 12: audit, mode split, providers, research, validation, quality, lineage, temporal | Implemented |
| 13: deterministic numerical verification | Implemented |
| 14 to 18: dependencies, conflict, grounded Arbiter, revision, receipt | Implemented |
| 19: local async workflow and persistence | Implemented with polling and an in-process worker, not SSE or a managed queue |
| 20: limits and metrics | Implemented |
| 21: users, workspaces, authorization | Guest workspace boundary only; full accounts and multi-tenant authorization intentionally deferred |
| 22: production scaling | Architecture documented in `docs/scaling.md`; hosted components not implemented |
| 23: non-circular evaluation | Small deterministic mock check implemented; external evaluation still missing |
| 24: comprehensive tests | Deterministic unit and mock-provider integration coverage implemented; external smoke remains credential-dependent |
| 25: deterministic Demo | Implemented as a separate labeled route and pipeline |
| 26: documentation cleanup | Current README, handoff, gap analysis, runbook, and environment example updated |

## Remaining verified gaps

### External provider smoke

The real adapters exist, but deterministic tests do not prove a complete call through a
local Claude login, Brave Search, DNS, public-page retrieval, and changing third-party
response formats. Run and record this only when credentials and network access are
available. A missing smoke run is a known limitation, not permission to substitute Demo.

### Process and queue durability

Audit artifacts survive a page refresh and a normal Studio restart because they are in
SQLite. A job executing inside the Node process does not survive a process crash as an
external queue job would. The queue seam exists, but the managed queue does not.

### Multi-user production controls

The HTTP API owns a single `guest` workspace and returns only guest Live audits. There are
no accounts, sessions, organization roles, retention policies, billing controls, or full
cross-tenant authorization model.

### Progress delivery

The page polls stored state and events. Server-Sent Events appear only as a future option
in the scaling document.

### Cost accuracy

Saga counts provider attempts. Studio estimates cost only when all three explicit
per-call rates are configured in the environment and passed to the resource controller.
The current adapters do not expose token counts or provider billing records.

### Evaluation breadth

The hidden-label check is deliberately small and mock-backed. SagaBench is labeled and
self-authored. Neither replaces a larger independent dataset or blinded human review.

### Production scaling

`docs/scaling.md` defines how the current interfaces could map to stateless API instances,
a managed queue, PostgreSQL, object storage, a broker, restricted retrieval workers, and
observability. Those components are not present in this repository.

## Non-negotiable invariants

- Preserve deterministic Demo mode.
- Never show a fixture result as the outcome of a failed Live audit.
- Never accept fixture stance, relevance, `relatesTo`, or verdict labels in Live.
- Never present rejected or unvalidated evidence to the Arbiter as support.
- Never fabricate a stage, flight event, evaluation result, or provider smoke result.
- Keep arithmetic, hashing, validation, state transitions, verdict rules, and receipt
  generation deterministic.
- Validate every model response with the current schema system.
- Treat retrieved content as untrusted data and keep research tools read-only.
- Do not expose chain-of-thought.
