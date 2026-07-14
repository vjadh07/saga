# Production scaling architecture

Saga's hackathon build is intentionally small. One Node process serves Studio and the
live audit API, an in-process worker runs each audit, and SQLite stores completed audit
graphs and receipts. Judges can use the deterministic guest Demo without an account. Live
mode is separate and fails clearly when its providers are not configured.

This document describes a production path. It does not claim that the repository already
implements these hosted components.

## Stable boundaries already in the code

The current implementation keeps the replaceable parts behind narrow interfaces:

- `AuditStore` owns audit records, claims, evidence, flight events, and final results.
- `AuditJobQueue` owns enqueue and cancellation behavior.
- `ModelProvider`, `SearchProvider`, and `PageFetcher` own external calls.
- `AuditService` owns state transitions, cancellation, retry eligibility, time limits, and
  completion validation.
- The live HTTP API owns request validation and guest-workspace access.
- The deterministic Demo pipeline is a separate module graph and never enters Live mode.

Those seams allow the deployment to grow without changing the evidence, arbitration,
revision, or receipt rules.

## Deployment path

### 1. Stateless API tier

Run the Studio and JSON API in several stateless Node instances behind a load balancer.
Move audit execution out of the request process. `POST /api/audits` writes one durable job
and returns the audit ID. Reads can land on any API instance because state lives in the
shared store.

### 2. Managed job queue and bounded workers

Replace `InProcessQueue` with a managed queue that supports visibility timeouts, delivery
attempts, cancellation markers, and a dead-letter queue. Workers claim one audit at a
time and use the existing per-mode limits. A job carries only the audit ID, so the worker
loads the authoritative document and mode from the store.

Each worker must remain idempotent:

- Claims and evidence are upserted by stable IDs.
- Flight events are keyed by audit ID and sequence.
- A retry clears the previous attempt's derived output before it starts.
- A result becomes terminal only after its receipt and complete result graph validate.

### 3. PostgreSQL and artifact storage

Replace `SqliteAuditStore` with PostgreSQL behind the same `AuditStore` interface. Keep
records, state transitions, workspace ownership, and artifact indexes relational. Large
sanitized source bodies can move to encrypted object storage, referenced by content hash.
Receipts retain hashes and retrieval metadata, so storage movement does not change audit
identity.

Use row-level workspace authorization in every read and mutation. Guest audits should use
short retention and unguessable IDs. Account, billing, and team screens are product work,
not prerequisites for the guest hackathon demo.

### 4. Progress delivery

Publish persisted state and flight-event changes through a broker. API instances can expose
Server-Sent Events while keeping polling as a recovery path. The browser must render only
stored stages and events. It must never invent agent activity while a provider call is
pending.

### 5. Provider isolation and network safety

Run page retrieval in a restricted egress service with DNS re-resolution, private-address
blocking, redirect limits, response-size limits, content-type allowlists, and timeouts. Keep
model and search credentials in a secrets manager. Give research workers read-only tools
and no access to application databases or workspace secrets.

Provider adapters should report usage metadata when available. Until token and billing
usage are available, Saga records call counts and leaves estimated cost unavailable unless
an operator configures explicit per-call rates.

### 6. Observability and auditability

Export state-transition latency, queue wait, provider attempts, retries, timeouts, budget
exhaustion, partial-claim failures, search count, model-call count, page-fetch count, and
configured cost estimates. Do not log submitted documents, retrieved page bodies, API
keys, or raw model prompts by default.

Retain the final receipt hash separately from the mutable application database. A hosted
deployment can periodically anchor batches of receipt hashes in write-once storage. The
receipt verifier remains deterministic and does not require the original Saga service.

## Failure model

- A failed provider call is retried only within its configured bound.
- One claim failure produces a failed claim audit and allows other claims to finish.
- An audit timeout or cancellation stops further stages and remains visible as such.
- Live failures never load fixture evidence and never switch to Demo.
- Queue redelivery must load persisted state and refuse to reprocess terminal audits.
- A partial result remains inspectable with every real event and failure recorded so far.

## Capacity controls

Scale workers by queue depth and provider quotas, not only CPU. Preserve the existing
quick, deep, and high-stakes limits at admission and again inside workers. Apply separate
workspace quotas for concurrent audits, daily model calls, searches, and fetched bytes.
Reject excess work before calling a paid provider.

## Migration order

1. Move jobs to a managed queue while keeping SQLite on one worker host.
2. Move `AuditStore` to PostgreSQL and make API instances stateless.
3. Move source bodies to encrypted object storage.
4. Add broker-backed progress delivery and autoscaled workers.
5. Add workspace authentication, retention policies, and operator billing controls.

The deterministic Demo stays a separate build artifact throughout this migration. It is a
fallback for product demonstration, not a fallback result for a failed Live audit.
