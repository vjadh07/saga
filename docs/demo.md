# Saga hackathon demo runbook

The primary demo is the evidence auditor. It has two intentionally separate paths:

- Demo mode is the reliable, deterministic presentation path.
- Live mode proves arbitrary-text orchestration when local providers are available.

Never present Demo output as the result of a failed Live request. If Live is unavailable,
say that the external smoke path is unavailable and open the clearly labeled Demo route.

## Primary demo: evidence audit

### Preflight

Use Node 22.5 or newer. From the repository root:

```bash
npm install
npm test
npm run typecheck
npm run demo:reset
npm run verify
```

Do not quote a remembered test count. Use the count printed by the current run.

`npm run verify` is the deterministic terminal proof. Confirm that it completes before
opening the browser. It does not need a model login, search key, or network.

Start Studio:

```bash
npm run studio
```

Open `http://127.0.0.1:4500/demo`. This is the guest Demo route. No account is required.

### Act 1: map the risk

The committed Northwind Energy brief contains five claims with different failure modes.
Start in Your document and click each highlighted claim.

Use these exact, fixture-backed talking points:

- The shipment claim has two genuinely independent supporting origins.
- The 40-year lifespan claim conflicts with the datasheet and independent testing.
- The present-tense market-leader claim is superseded by newer evidence.
- The 99% recyclable claim omits the gap between recyclable in principle and recycled in
  practice.
- The customer-experience claim is subjective and is not forced into a factual verdict.

Say that this route is a constructed world. Its purpose is repeatable demonstration of the
workflow, not proof of real-world accuracy.

### Act 2: show adversarial research

Open Sources and exact quotes for the selected claim, then expand How Saga checked this.

For the lifespan claim, point to Blocked source instructions. The hostile page asks the
auditor to trust it and record the false 40-year claim. Saga treats the page as data,
quarantines the instruction-like text, and does not use it as supporting evidence.

For the market-leader claim, open Source independence. An apparent five-source cluster
traces to one company release. The Audit summary counts independent sources, not article
count.

Keep the safety claim precise. Saga uses sanitization, read-only tools, schema validation,
and human approval as defense in depth. It is not a proof against every novel injection.

### Act 3: show the usable result

Open the corrected draft. The original stays unchanged, and each proposed change can be
unchecked. Then point to the Audit summary and its claim count, suggested-change count,
independent-source count, and plain-language result.

The Demo flight events are deterministic events from the fixture pipeline. They are not
animations or fabricated progress. The Live workspace follows the same rule and displays
only persisted stages and flight events.

### Reset and repeat

```bash
npm run demo:reset
```

The command clears local audit history, the transaction ledger, and local mock-vendor
state. It does not modify the committed Northwind fixture, so `/demo` returns the same
result after every reset.

## Optional Live act

Live mode requires all of the following:

- a locally installed, logged-in Claude Code CLI
- `BRAVE_SEARCH_API_KEY` in `.env`
- outbound DNS and HTTPS access
- public sources that the secure fetcher can read as HTML or plain text

Open `http://127.0.0.1:4500/`, paste the exact document rehearsed on the presentation
machine, choose Quick, Deep, or High-stakes, and click Verify.

What the browser does:

1. `POST /api/audits` creates a guest Live audit.
2. The local worker maps claims and runs the provider-backed workflow.
3. The page polls `GET /api/audits/:id` every 750 ms.
4. Persisted stage changes and real flight events appear as they are recorded.
5. A completed or partial result shows the corrected draft, Audit summary, and
   Verification receipt.
6. The audit ID remains in the URL, so refresh reloads the SQLite record.

This is polling, not Server-Sent Events. Do not describe it as streaming.

Before demo day, run the exact Live input twice on the same machine. Record whether the
providers completed, which sources were reachable, and how long the run took. Search and
page content can change, so do not promise a specific Live verdict until it has been
observed in that rehearsal.

### Live failure handling

- A missing Brave key or Claude login is a Live configuration failure.
- A blocked or unreadable page is recorded as a retrieval failure.
- One failed claim can produce a partial result while other claims finish.
- Cancel stops the current audit. Retry clears derived output and starts the same audit
  again from persisted input.
- A failed Live run remains failed. Studio never inserts fixture evidence or a Demo
  verdict.

If Live fails during judging, leave the failure visible long enough to explain it, then
open `/demo` manually and state that it is the deterministic fallback. Do not imply that
the Demo result came from the submitted Live text.

## Deterministic evaluation check

```bash
npm run eval
```

This runs a small hidden-label check through the Live orchestration with deterministic
mock model, search, and page providers. Gold verdicts are consulted only after each audit
returns. It is a useful pipeline regression check, but it is not an external benchmark or
a production-provider smoke test.

## Primary-demo rehearsal checklist

Run this twice, back to back:

1. `npm run demo:reset` completes.
2. `npm run verify` produces the deterministic Northwind audit.
3. `npm run studio` serves `/demo` without requiring a judge account.
4. The five claim highlights are selectable.
5. The injection quarantine and lineage cluster are visible.
6. The corrected draft toggles preserve the original.
7. The Audit summary is visible and clearly labeled Demo.
8. If Live providers are configured, the rehearsed Live input reaches a terminal state.
9. Refreshing that Live audit reloads its persisted state.
10. If Live providers are not configured, the presenter says so and does not claim a
    smoke result.

## Primary-demo fallbacks

- If Studio does not start, use `npm run verify` as the deterministic terminal surface.
- If the model adapter hangs, check `which claude` and set `CLAUDE_CODE_PATH` to the native
  CLI. The x64 SDK-bundled CLI has previously hung on this arm64 Mac.
- If Brave Search rejects requests, verify `BRAVE_SEARCH_API_KEY` and keep the Live failure
  visible. Then open `/demo` manually.
- If a Live page is rejected, inspect the recorded failure. Private addresses, redirects
  to blocked addresses, oversized responses, and unsupported content types are rejected
  intentionally.
- If stale local audits confuse rehearsal, run `npm run demo:reset` and restart Studio.

## Secondary demo: original transaction engine

This is the earlier three-act Saga demonstration. It is optional for the current pitch,
but remains useful if judges ask about Saga's transaction substrate.

### Setup

Pane 1, mock vendors:

```bash
npm run vendors
```

Pane 2, ledger viewer, then open `http://127.0.0.1:4200`:

```bash
npm run viewer
```

Pane 3, reset state:

```bash
npm run reset
```

If Google Calendar is configured, the calendar action uses the real adapter. Otherwise it
uses the mock and prints that choice at boot.

### Transaction act 1: fixed crash

```bash
CRASH_AFTER="hotel.book:CALLED" npm run agent -- "book me a one way flight from PHX to SFO next friday and a hotel in san francisco friday to sunday, then add the trip to my calendar"
```

The fixed crash occurs after the hotel intent is durably recorded. The viewer should show
the flight committed and the hotel called. The vendor oracle should contain the flight and
no hotel if the call did not leave the process:

```bash
curl -s http://127.0.0.1:4100/admin/bookings
```

### Transaction act 2: recovery

```bash
npm run agent -- "finish booking my trip"
```

Recovery runs before the model continues. It reconciles the in-flight hotel action and
finishes the remaining work without duplicating a landed effect. `test/kill9.test.ts`
covers both crash directions with a real process kill.

Optional unwind:

```bash
npm run agent -- "cancel my whole trip"
```

### Transaction act 3: reconciliation audit

```bash
npm run seed
# restart the vendors process after seeding
npm run audit -- "investigate the hotels vendor"
```

Describe findings as reconciliation breaks. The seeded state is synthetic, so do not use
a stronger accusation. If the live narrator stalls, use `reports/audit-fallback.md` and
state that it is the committed deterministic report.
