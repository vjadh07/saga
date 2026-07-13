# End-to-end agent gap analysis

Honest audit of what runs live on arbitrary user text versus what still depends on the
deterministic fixtures. A feature counts as "live" only if arbitrary, never-before-seen
input flows through it without any ground-truth label, preselected passage, or fixture
verdict. A schema, prompt, or placeholder existing does not count.

## Current path (verified by reading the code)

```
Studio textarea
  -> POST /api/map            scripts/studio.ts
  -> analyzeInput             src/verify/mapview.ts
       -> extractClaims       src/verify/agent/extract.ts   (LIVE LLM via Agent SDK)
       -> assembleClaims      src/verify/agent/mapper.ts     (deterministic, tested)
       -> defaultContract     src/verify/contract.ts         (deterministic)
       -> sanitizeSource      src/verify/safety.ts           (deterministic, scans input)
  -> rendered claim map       src/verify/web/page.ts (renderMap)
```

That is the entire live path today. It ends at the claim map. There is no live research,
retrieval, evidence, arbitration, correction, or receipt for arbitrary input.

## What is genuinely live

| Capability | Status | Where |
| --- | --- | --- |
| Claim extraction from arbitrary text | LIVE | `extract.ts` calls the Agent SDK; `record_claim` tool; assembly is deterministic and validated |
| Claim classification (type, risk, verifiable, time-sensitive) | LIVE | same call; coerced and validated in `assembleClaims` |
| Evidence Contract per claim | LIVE (deterministic, from claim type) | `defaultContract`; not yet enforced against evidence |
| Prompt-injection scan of the submitted document | LIVE | `sanitizeSource({id:"input", content})` in `analyzeInput` |
| Audit modes (quick/deep/high_stakes) affect contracts | LIVE (thin) | `analyzeInput`: quick skips contracts, high_stakes forces primaryRequired |

## What is fixture-only (the gap)

Everything the full audit does (`src/verify/pipeline.ts` `runAudit`) runs on `DEMO_CORPUS`
and is not reachable from live input:

| Fixture dependency | File | Why it blocks live |
| --- | --- | --- |
| `DEMO_DOCUMENT`, `DEMO_CLAIMS`, `DEMO_CORPUS`, `DEMO_NOW` | `fixtures/demo.ts` | The studio page embeds a precomputed audit of the demo report; `runAudit` is never called on user text |
| `CorpusEntry.relatesTo` | `corpus.ts` | Which claim a source addresses is hand-labeled, not discovered |
| `CorpusEntry.stance` | `corpus.ts` | supports/contradicts/qualifies is hand-labeled; the "Investigator" and "Skeptic" just filter by it |
| `CorpusEntry.relevance` | `corpus.ts` | strong/weak is hand-labeled |
| Hardcoded `passage` | `corpus.ts`, `fixtures/demo.ts` | The exact evidence excerpt is preselected, not extracted from a page |
| Verdict inputs | `pipeline.ts` | `investigate`/`skeptic` return fixture evidence; arbiter runs on it |
| Lineage inputs | `pipeline.ts` | `detectLineage` runs on fixture sources, not retrieved pages |
| Temporal `asOf` | `fixtures/demo.ts` | The demo sets `asOf` on the market-lead claim to force an outdated verdict |
| Flight events for the full audit | `pipeline.ts` | Real for the demo run, but there is no live run to record |

There is no live search, no page fetch, no SSRF protection, no citation entailment check,
no source-quality assessment, no numeric recomputation, no claim dependencies, no
contradiction resolution, no revision agent, no receipt, no async job store, no auth.

## Changes required for arbitrary content to pass the complete live audit

Ordered to the 26-phase plan.

1. Audit and this document. (this file)
2. Split Live and Demo mode: a `mode: "live" | "demo"` seam so Live never reads
   `DEMO_CORPUS`; Demo stays deterministic and labeled.
3. Provider interfaces: `ModelProvider`, `SearchProvider`, `PageFetcher`, `AuditStore`,
   `AuditJobQueue`, plus mock/fixture adapters for tests and Demo, live adapters for Live.
4. Research Planner: per-claim structured plan (queries, budgets, stopping/abstention),
   created before retrieval, persisted, zod-validated.
5. Secure search + fetch: real search via `SearchProvider`; SSRF-hardened `PageFetcher`
   (scheme, loopback, private, metadata, redirect, size, content-type, timeout); canonical
   URLs, dedup, readable-text extraction, content hashing; Safety Sentinel before reasoning.
6. Real Investigator: reads only sanitized content, decides relevance and stance itself,
   extracts a verbatim passage, checks it appears in the page, records accept/reject. No
   `CorpusEntry.stance`.
7. Independent Skeptic: own counter-queries, runs without seeing the Investigator's verdict,
   may find nothing. Separate query logs.
8. Citation entailment verifier: classify each excerpt (direct/partial/qualification/
   contradiction/context/irrelevant), verify exact match, same entity/metric/period/
   population; only validated evidence reaches the Arbiter.
9. Enforce Evidence Contracts: a `ContractEvaluation` object gating arbitration.
10. Source-quality assessment: structured factors per source, no universal domain list.
11. Lineage on real retrieved sources; unify the source set used for claim origins,
    passport origins, evidence graph, and the summary.
12. Temporal fix: distinguish claim reference date, doc date, evidence date, event date,
    now; historical claims keep historical truth; never fabricate `asOf`.
13. Numeric verification: deterministic recompute of percent change, ratios, totals with a
    calculation trace; LLM only extracts candidate values.
14. Claim dependencies: depends-on/derived-from/qualifies/contradicts; downstream marked
    for re-evaluation, not auto-false.
15. Contradiction resolution: structured conflict analysis before a disputed verdict.
16. Ground the Arbiter: receives only validated inputs, cannot browse, cites accepted
    evidence ids; add `failed` verdict.
17. Revision Agent: grounded corrected prose, validated against the verdict and evidence;
    deterministic markers become the fallback only.
18. Tamper-evident receipt: canonical JSON + hash chain, verification code.
19. Async audit workflow: state machine, `AuditStore`, `/api/audits` endpoints, SSE,
    survives refresh, per-claim failure isolation.
20. Budgets, limits, cost tracking per mode.
21. Users/workspaces/authorization; cross-user access tests.
22. `docs/scaling.md`; keep boundaries replaceable.
23. Non-circular evaluation (agent sees no labels), ablations, honest phrasing.
24. Comprehensive unit + integration tests with mock providers; one optional live smoke.
25. Preserve deterministic Demo mode + explicit fallback hierarchy.
26. Documentation and product-identity cleanup.

## Non-negotiables carried through every phase

Preserve the deterministic demo. Never show fake progress. Never show unverified evidence.
Never present fixture behavior as live research. Deterministic code over LLM whenever it can
do the job. Validate every LLM boundary with zod. TDD, small plain commits, no em dashes,
no AI co-author trailers. Live mode must never silently fall back to `DEMO_CORPUS`; a live
audit that cannot complete shows partial or failed, never fixture results.
