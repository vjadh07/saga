# Saga: Trust, with receipts.

Saga is an adversarial evidence-auditing agent for AI-written reports, articles, and
drafts. It maps atomic claims, plans research, searches for supporting and contradicting
evidence, validates citations, checks source quality and lineage, verifies dates and
arithmetic, resolves conflicts, and returns corrected prose with a Trust Passport and a
tamper-evident receipt.

The repository also contains Saga's original crash-safe transaction engine. The evidence
auditor is the current hackathon product surface. The transaction engine remains tested
and available through its existing scripts.

## Quick start

Requirements: Node 22.5 or newer, which provides `node:sqlite`.

```bash
npm install
cp .env.example .env
npm test
npm run typecheck
npm run verify
```

`npm run verify` runs the deterministic fixture audit. It needs no model login, search
credential, or network access.

The public judge workspace is https://saga-omega-seven.vercel.app/demo. Its Live path
accepts one factual claim, runs a bounded Quick audit with Gemini and Tavily, and returns
the evidence, corrected draft, Trust Passport, and receipt in one request. The Sample
audit remains a separate deterministic fallback.

Start the guest Studio with:

```bash
npm run studio
```

- Open `http://127.0.0.1:4500/` for Live mode.
- Open `http://127.0.0.1:4500/demo` for the deterministic, clearly labeled Demo mode.
- Run `npm run demo:reset` to clear local audit and transaction state. The committed Demo
  fixture is not changed.

The simplest free Live setup uses a Google AI Studio key plus a Tavily developer key:

```text
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-lite
TAVILY_API_KEY=...
```

Gemini handles structured reasoning and Tavily handles direct web discovery. Both offer
limited free developer access without requiring Saga to use fixture evidence. Existing
Claude Agent SDK and Brave Search configuration remains supported. If several search keys
exist, Saga selects Brave first, then Tavily. Paid Gemini Search grounding is available
only when `GEMINI_SEARCH_GROUNDING=true` is set explicitly. The default test suite uses
deterministic providers and does not make external calls.

## Live and Demo are separate

Live accepts arbitrary user text and uses only the production provider composition:

- Gemini or Claude Agent SDK for schema-validated structured model output
- Tavily, Brave Search, or explicitly enabled Gemini grounding for web discovery
- an SSRF-hardened page fetcher for retrieved pages
- SQLite for audit state, evidence, events, final results, and receipts

Demo runs the committed fixture pipeline. Its corpus contains labels used only to make the
fallback repeatable. Live cannot import the fixture corpus or consume fixture stance,
relevance, or verdict labels. Tests enforce that module boundary. A failed Live audit stays
failed or partial and never switches to Demo.

## Live workflow

For every submitted document, Saga runs:

1. Claim mapping and deterministic claim assembly at exact document offsets.
2. Evidence contracts and a structured research plan created before retrieval.
3. Independent Investigator and Skeptic searches.
4. Secure page retrieval, content hashing, sanitization, and injection quarantine.
5. Exact excerpt checks, citation entailment validation, and source-quality assessment.
6. Source-lineage grouping, temporal verification, and deterministic numerical checks.
7. Claim dependency analysis and contradiction resolution where the evidence conflicts.
8. Deterministic arbitration over validated evidence and contract results only.
9. Evidence-grounded revision, with deterministic fallback prose only when a validated
   model revision is unavailable.
10. Trust Passport generation, receipt hashing, and durable persistence.

Every model output crosses a Zod schema boundary. Arithmetic, hashing, validation, state
transitions, verdict rules, and receipt verification remain deterministic. Retrieved text
is data, not an instruction source, and research tools are read-only.

## Studio and local API

The Studio is a guest workspace with no login requirement. The browser submits a Live
audit to `POST /api/audits`, then polls `GET /api/audits/:id` for persisted state and real
flight events. It does not use Server-Sent Events. Cancel and retry actions use dedicated
POST endpoints.

The audit ID is kept in the page URL. Refreshing a completed audit reloads it from
`data/audits.db` by default. The local worker runs in the same Node process, so this is a
single-node hackathon implementation, not a durable distributed queue.

## Outputs

- **Claim audit:** verdict, confidence, rationale, accepted supporting and contradicting
  evidence, contract results, source quality, temporal findings, and numerical trace.
- **Corrected draft:** proposed evidence-grounded changes at the original claim offsets.
  The submitted document is preserved, and each change remains optional in the Studio.
- **Trust Passport:** document-level verdict counts, primary-source count, independent
  evidence origins, claims requiring revision, and last verification time.
- **Agent Flight Recorder:** persisted events produced by actual stages. No synthetic
  progress events are displayed.
- **Audit receipt:** canonical hashes for the document, final draft, searches, retrieval
  provenance, sanitized sources, evidence, numeric checks, contract evaluations, verdicts,
  revisions, safety events, and failures.

## Reliability and limits

Live mode applies bounded attempts, provider timeouts, cancellation, whole-audit timeouts,
and per-claim failure isolation. A run can finish as `partially_completed` when another
claim succeeds. Default limits are:

| Mode | Claims | Searches | Model calls | Page fetches | Attempts per provider call | Call timeout |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Quick | 4 | 16 | 100 | 32 | 2 | 12 seconds |
| Deep | 8 | 64 | 400 | 128 | 2 | 15 seconds |
| High-stakes | 12 | 144 | 900 | 288 | 2 | 20 seconds |

Claim mapping has a 60-second timeout and the remaining audit has a five-minute timeout by
default. Metrics include duration, claims, model calls, searches, page fetches, retries,
and estimated cost. Cost remains unavailable unless all three optional per-call rates are
configured in the environment because the current providers do not report billable usage.

## Evaluation

```bash
npm run eval
```

This command runs a small deterministic mock-provider orchestration check. Its case
definitions contain claims, ordinary search results, and ordinary page text. A stateless
test model derives structured responses from the request text after the runner receives
each input. Gold verdicts are stored outside the case builders and are consulted only after
each audit returns. Runner inputs do not carry stance, relevance, citation, verdict, or
expected-verdict labels. This is useful for detecting circular orchestration regressions.
It is not an external benchmark, a live provider evaluation, or evidence of general
accuracy.

`npm run bench` remains a labeled, self-authored fixture diagnostic that compares Saga to
simple rule-based baselines. Treat its output as a regression aid, not an independent
accuracy claim.

## Architecture

```text
document -> Claim Mapper -> Evidence Contract -> Research Planner
                                      |-> Investigator -> search and secure fetch
                                      |-> Skeptic      -> search and secure fetch
validated citations + quality + lineage + time + numbers + conflicts
                                      -> Arbiter -> Revision Agent
                                      -> Trust Passport + audit receipt
```

Useful paths:

- `src/verify/live/`: provider-backed orchestration, state machine, resources, and API
- `src/verify/research/`: planning, retrieval, citation, quality, conflict, numeric, and
  revision stages
- `src/verify/providers/`: model, search, fetch, queue, and audit-store boundaries
- `src/verify/net/`: URL safety and live page retrieval
- `src/verify/receipt.ts`: canonical receipt construction and verification
- `src/verify/fixtures/` and `src/verify/pipeline.ts`: deterministic Demo only
- `test/verify-end-to-end.test.ts`: full Live workflow with mock providers

The production scaling path is described in [docs/scaling.md](docs/scaling.md). It is an
architecture document, not a claim that managed queues, PostgreSQL, object storage,
autoscaling, authentication, or multi-tenant infrastructure are implemented.

## Known limitations

- A completed provider-backed smoke run through the public endpoint composition was
  observed locally with Gemini and Tavily. Hosted results still depend on provider quota,
  outbound access, and reachable public pages.
- The hosted hackathon endpoint accepts one claim in Quick mode and keeps state only for
  the lifetime of that request. Local Studio supports multi-claim modes and SQLite refresh
  recovery.
- Gemini's unpaid tier may use submitted content to improve Google products. Use fictional
  or non-sensitive text for a free-tier judge test.
- The local worker and SQLite store are suitable for a guest hackathon demo and a
  single-node run, not a multi-instance deployment.
- Studio progress uses polling, not Server-Sent Events.
- Audits that fail before producing a final result do not yet persist a complete metrics
  snapshot, and receipt start and completion timestamps can be identical.
- The hidden-label evaluation uses deterministic mock providers and a very small case set.
- Safety sanitization reduces the prompt-injection attack surface but is not a proof that
  every novel attack will be detected.
- Full login, billing, teams, and multi-tenant production infrastructure are intentionally
  outside this hackathon pass.

See [docs/design.md](docs/design.md), [docs/plan.md](docs/plan.md),
[docs/end-to-end-agent-gap.md](docs/end-to-end-agent-gap.md), and
[docs/verify/threat-model.md](docs/verify/threat-model.md).

## Original transaction engine

Saga began as a crash-safe transaction layer for booking agents. That code remains under
`src/core`, `src/ledger`, `src/vendors`, and `src/agent`. Use `npm run vendors`, `npm run
viewer`, `npm run agent`, and `npm run audit` for the transaction demonstration described
in [docs/demo.md](docs/demo.md).
