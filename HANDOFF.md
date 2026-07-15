# HANDOFF

Current repository handoff for Saga. This file prioritizes the evidence auditor, which is
the active hackathon product. The original transaction engine remains in the same
repository and is summarized near the end.

## Current implementation state

As of 2026-07-14, the current worktree contains the complete P0 evidence-audit workflow
and the requested P1 hackathon hardening. The implementation is covered by deterministic
tests with mock providers. Do not copy an old test count into status reports. Run the
commands below and report the observed result from the current commit.

P0 now includes:

- deterministic numerical verification with grounded inputs and calculation traces
- an Arbiter limited to validated evidence and evaluated evidence contracts
- structured contradiction resolution when accepted evidence conflicts
- evidence-grounded Revision Agent prose with validated deterministic fallbacks
- canonical, tamper-evident receipts with retrieval and failure provenance
- the complete arbitrary-text Live orchestration from mapping through persistence
- a full mock-provider end-to-end integration test
- static and runtime guards that keep fixture labels and `DEMO_CORPUS` out of Live
- a separate, clearly labeled deterministic Demo route and pipeline

P1 now includes:

- SQLite persistence for audit records, claims, evidence, events, results, and receipts
- cancel, retry, mapping timeout, audit timeout, provider timeout, and bounded attempts
- per-claim failure isolation and `partially_completed` status
- explicit quick, deep, and high-stakes resource limits
- duration, model-call, search, page-fetch, retry, and optional cost metrics
- a small hidden-label deterministic mock orchestration check
- a reset command that clears local audit history without changing the Demo fixture
- current setup, product, demo, gap, and scaling documentation

The external production-provider smoke test is not established by the deterministic test
suite. The simplest current free path uses Gemini for structured output and Tavily for
web search. It still requires outbound network access and reachable public pages.
Report the smoke run as unavailable until it is actually run and observed.

## Verify before the next change

```bash
git status
git log --oneline -12
npm test
npm run typecheck
npm run eval
```

`npm run eval` is a deterministic mock-provider check. Case definitions provide only
claims, search results, and page text. A stateless test model derives structured responses
from each request after runner input capture. It does not validate Gemini, Brave Search,
the Claude Agent SDK, public-page retrieval, or general factual accuracy.

For the deterministic product fallback:

```bash
npm run verify
npm run demo:reset
npm run studio
```

Open `http://127.0.0.1:4500/demo`. No judge account is required.

## Live product path

The production composition uses:

- `GeminiModelProvider` when `GEMINI_API_KEY` is configured, otherwise the existing
  `AgentSdkModelProvider`
- `TavilySearchProvider` for the simplest free search path
- `BraveSearchProvider` when a Brave key is configured, or `GeminiSearchProvider` when
  paid grounding is enabled explicitly
- `LivePageFetcher` for bounded, SSRF-checked page retrieval
- `SqliteAuditStore` at `data/audits.db` by default
- `AuditService` for state transitions, cancellation, retry, time limits, and result
  integrity checks
- the Live HTTP API and in-process local job runner

The browser submits to `POST /api/audits` and polls `GET /api/audits/:id` every 750 ms.
There is no Server-Sent Events implementation. Cancel and retry have separate POST
endpoints. Completed audit IDs remain in the URL, so refresh reloads persisted state.

The root Studio route is Live. `/demo` embeds the deterministic fixture audit. A Live
failure is displayed as a Live failure and never causes a fixture result to appear.

## Environment

Copy `.env.example` to `.env`. The simplest Live evidence setup is:

```text
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-lite
TAVILY_API_KEY=...
```

Gemini powers schema-validated model calls and Tavily supplies direct search results. The
existing Claude plus Brave path remains supported. `CLAUDE_CODE_PATH` is optional when the native
CLI is already on `PATH`. On this machine, keep the explicit native CLI lookup in
`src/agent/run.ts`: the x64 SDK-bundled CLI has previously hung under Rosetta.

Useful local defaults:

- Studio: `127.0.0.1:4500`
- audit database: `data/audits.db`
- transaction vendor: `127.0.0.1:4100`
- ledger viewer: `127.0.0.1:4200`

## Important implementation boundaries

- `src/verify/live/` must not import `pipeline.ts`, `corpus.ts`, `bench.ts`, or anything
  under `fixtures/`.
- Search results and fetched pages are provider data. They must not carry a gold stance,
  relevance label, or verdict into Live.
- Only citation-validated evidence can reach the Arbiter or a generated revision.
- The model proposes structured values. Deterministic code recomputes arithmetic, applies
  contracts, decides verdicts, validates revisions, hashes receipts, and checks completed
  result graphs.
- Persist and display only actual stages and events. Do not generate decorative progress.
- A failed claim is explicit. Other claims may continue, producing a partial audit.
- Estimated cost stays `null` unless an operator supplies all three explicit per-call
  rates through the Studio environment.

## Key evidence-audit files

- `src/verify/live/audit.ts`: document-level Live orchestration
- `src/verify/live/audit-claim.ts`: per-claim pipeline
- `src/verify/live/service.ts`: workflow state machine and persistence lifecycle
- `src/verify/live/http.ts`: guest Live API
- `src/verify/live/resources.ts`: limits, retries, timeouts, cancellation, metrics
- `src/verify/live/composition.ts`: production dependency composition
- `src/verify/research/`: planner, Investigator, Skeptic, citation, quality, conflict,
  numeric, dependencies, and revision
- `src/verify/receipt.ts`: canonical receipt and verifier
- `src/verify/providers/store-sqlite.ts`: durable local audit store
- `src/verify/providers/model-gemini.ts`: Gemini structured-output adapter
- `src/verify/providers/search-gemini.ts`: Gemini Google Search grounding adapter
- `src/verify/providers/search-tavily.ts`: Tavily Search adapter
- `src/verify/providers/search-brave.ts`: Brave Search adapter
- `src/verify/net/fetcher.ts`: secure page fetcher
- `src/verify/web/page.ts`: Live polling workspace and Demo result renderer
- `test/verify-end-to-end.test.ts`: full arbitrary-text Live flow with mock providers
- `src/verify/evaluation/`: hidden-label mock orchestration check

## Known gaps after the hackathon pass

- A provider-backed public-endpoint smoke completed locally with Gemini and Tavily on
  2026-07-14. Hosted behavior still depends on deployed secrets, quota, outbound access,
  and reachable pages.
- The hosted endpoint accepts one Quick-mode claim and is stateless across requests.
- The local job runner is in-process. It does not survive a process crash as a managed
  queue would.
- SQLite is local and single-node. PostgreSQL and object storage are not implemented.
- Progress delivery is polling, not Server-Sent Events.
- The guest workspace has no login, billing, teams, or complete multi-tenant authorization.
- Provider call counts are tracked, but current adapters do not expose token-level billing.
- Audits that fail before producing a final result persist status and error, but not a
  complete usage and cost snapshot.
- Receipt start and completion timestamps can be identical because the current Live run
  injects one audit timestamp. Duration metrics are tracked separately.
- The hidden-label evaluation is small and mock-backed. It is not an independent benchmark.
- `docs/scaling.md` describes a production architecture only. None of its hosted services
  should be presented as shipped.

## Next actions

1. Run the full tests and typecheck on the final integrated worktree.
2. Run `npm run studio`, verify `/demo`, refresh a completed persisted audit, and exercise
   cancel or retry with deterministic providers if credentials are unavailable.
3. If credentials and network are available, run one real Live smoke audit and record the
   exact observed result. Do not block the deterministic demo on this step.
4. Rehearse [docs/demo.md](docs/demo.md) twice on the presentation machine.
5. Commit and push each coherent remaining change with a plain commit message.

## Original transaction engine

Saga began as a crash-safe transaction layer for AI agents. The ledger, transaction
engine, mock vendors, live Agent SDK booking agent, Google Calendar adapter, reconciliation
auditor, and kill-9 recovery test remain under `src/core`, `src/ledger`, `src/vendors`,
`src/agent`, and their existing tests.

Historical demo verification from 2026-07-11 showed the booking flow recovering after a
fixed `hotel.book:CALLED` crash and converging to one committed flight, hotel, and calendar
action. Google Calendar was also exercised with the real adapter on that date. These are
historical observations about the transaction demo, not evidence that the current Live
web audit providers were smoke-tested.

Use the legacy section of [docs/demo.md](docs/demo.md) for that rehearsal. Keep the term
`reconciliation break`; do not characterize synthetic breaks as fraud.

## Standing rules

- No em dashes in code, comments, docs, commit messages, or status reports.
- Use TDD for source changes.
- Preserve working architecture and tests.
- Keep commits small and use plain messages with no generated-by trailers.
- Never use fixture labels in Live or silently replace Live with Demo.
- Never report a test, evaluation, provider call, or demo outcome that was not observed.
- Keep arithmetic, hashing, validation, state transitions, and receipts deterministic.
- Validate every model output at the existing schema boundary.
- Do not expose chain-of-thought.
