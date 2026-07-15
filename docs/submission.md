# Saga hackathon submission

## Paste-ready project details

**Project name:** Saga

**Tagline:** Trust, with receipts.

**Short description:** Saga is an adversarial evidence-auditing agent for AI-written text. It researches each factual claim, checks citations, sources, dates, lineage, and arithmetic, then returns corrected prose, a plain-language audit summary, and a tamper-evident receipt.

**Repository:** https://github.com/vjadh07/saga

**Primary category:** AI agents

**Suggested secondary categories:** Trust and safety, developer tools, productivity

## Long description

AI can produce polished prose faster than people can verify it. A fluent report may still contain stale facts, copied-source consensus, citation drift, arithmetic errors, or claims that no source actually supports.

Saga turns a document into an auditable research workflow. It maps atomic claims, defines an evidence contract, plans separate supporting and skeptical research, retrieves public pages through an SSRF-hardened fetcher, quarantines instruction-like source text, validates exact excerpts, assesses source quality, collapses shared lineage, checks time-sensitive claims, and recomputes numerical relationships in deterministic code.

The Arbiter receives only validated evidence and evaluated contract results. It cannot browse or invent citations. The Revision Agent must ground corrected prose in accepted evidence or a verified numerical trace. Saga preserves the original document and produces a corrected draft, a plain-language audit summary, an activity log made from real workflow events, and a canonical tamper-evident receipt.

Live and Demo modes are deliberately separate. Live accepts arbitrary text and uses provider-backed research. Demo is a deterministic, clearly labeled fallback for judging. A failed Live audit remains failed or partial and never consumes Demo labels or silently changes modes. The guest Studio needs no account.

## What makes it agentic

Saga does more than call one model with a fact-checking prompt:

1. A Claim Mapper turns arbitrary prose into exact, atomic document spans.
2. A Research Planner creates claim-specific supporting and counterevidence searches.
3. Investigator and Skeptic roles gather independent evidence.
4. Deterministic gates validate excerpts, source quality, lineage, dates, units, and arithmetic.
5. A grounded Arbiter resolves each claim without access to search tools.
6. A Revision Agent proposes publishable corrections that must pass evidence-grounding checks.
7. The system persists state, partial failures, real events, metrics, and a signed audit graph.

## Judge demo

Open the public Live workspace at https://saga-omega-seven.vercel.app/demo. Enter one
factual claim and click **Check this text**. The separate **Sample audit** button opens the
deterministic fallback.

```bash
npm install
cp .env.example .env
npm run typecheck
npm run verify
npm run studio
```

Open `http://127.0.0.1:4500/demo` for the deterministic guest demo. Follow [docs/demo.md](demo.md) for the five-minute presentation.

For Live mode, add `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.1-flash-lite`, and `TAVILY_API_KEY` to `.env`, then open `http://127.0.0.1:4500/`.

## Built during the hackathon

- complete arbitrary-text Live pipeline from claim mapping through receipt generation
- independent Investigator and Skeptic research
- citation, source-quality, lineage, temporal, and deterministic numerical verification
- contradiction resolution and evidence-contract enforcement
- evidence-grounded corrected prose
- plain-language audit summary, real workflow events, and tamper-evident audit receipt
- durable local SQLite audits with refresh recovery, cancel, retry, limits, timeouts, and partial claim failure
- separate one-click deterministic guest Demo
- deterministic mock-provider integration and hidden-label orchestration checks
- documented production scaling architecture

## Technology

- TypeScript and Node.js
- Gemini API or Claude Agent SDK with Zod-validated structured outputs
- Tavily Search, Brave Search, or explicitly enabled Gemini grounding
- SSRF-hardened native page retrieval
- deterministic validation and canonical SHA-256 receipt hashing
- SQLite persistence
- self-contained server-rendered Studio
- Vitest

## Honest limitations

- The hosted Live endpoint accepts one claim in Quick mode and does not persist its result after refresh. The local Studio supports broader modes and SQLite persistence.
- Provider quota, outbound network access, and reachable public pages can still affect a Live run. A failed Live audit never switches to Sample results.
- Gemini's unpaid tier may use submitted content to improve Google products, so the judge input should be fictional or non-sensitive.
- The local worker and SQLite store are a single-node hackathon implementation.
- The hidden-label evaluation is a small deterministic mock orchestration check, not an external accuracy benchmark.
- Login, billing, teams, multi-tenant infrastructure, and managed production services are intentionally deferred.

## Final submission checklist

- [ ] Paste the project name, tagline, short description, and long description.
- [ ] Add the repository link.
- [ ] Add the final hosted URL if one is deployed.
- [ ] Record a short video using the primary runbook in `docs/demo.md`.
- [ ] Show the explicit Demo badge, one corrected claim, source independence, blocked source instructions, and the Audit summary.
- [ ] If you include a rehearsed Live audit, show its Verification receipt.
- [ ] Do not describe polling as streaming or the deterministic mock evaluation as a benchmark.
- [ ] Do not claim an external Live smoke result unless it was actually observed.
