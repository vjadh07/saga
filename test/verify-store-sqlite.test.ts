import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { SqliteAuditStore } from "../src/verify/providers/store-sqlite.js";
import { buildReceipt, verifyReceipt } from "../src/verify/receipt.js";
import type { Claim, Evidence, FlightEvent } from "../src/verify/types.js";

const CREATED_AT = "2026-07-14T00:00:00.000Z";
const UPDATED_AT = "2026-07-14T00:01:00.000Z";

function claim(): Claim {
  return {
    id: "c1",
    originalText: "A stored claim.",
    normalized: "a stored claim",
    claimType: "general",
    location: { start: 0, end: 15 },
    verifiable: false,
    timeSensitive: false,
    risk: "low",
    status: "contracted",
    asOf: null,
  };
}

function evidence(): Evidence {
  return {
    id: "e1",
    claimId: "c1",
    sourceId: "s1",
    stance: "qualifies",
    excerpt: "A persisted evidence excerpt.",
    relevance: "weak",
    capturedBy: "skeptic",
  };
}

function event(auditId: string): FlightEvent {
  return {
    seq: 1,
    auditId,
    claimId: "c1",
    type: "VERDICT_REACHED",
    detail: { verdict: "not_verifiable" },
    at: UPDATED_AT,
  };
}

function receipt(auditId: string) {
  return buildReceipt({
    auditId,
    mode: "live",
    modelProvider: "mock",
    modelId: "mock",
    searchProvider: "mock-search",
    document: "A stored claim.",
    finalDraft: "A stored claim.",
    searches: [],
    sources: [],
    evidence: [],
    numericChecks: [],
    contractEvaluations: [{
      claimId: "c1",
      supportingCriteriaMet: false,
      contradictingCriteriaMet: false,
      primaryRequirementMet: false,
      preferredSourceRequirementMet: false,
      independentOriginRequirementMet: false,
      temporalRequirementMet: true,
      triggeredAbstentionConditions: [],
      explanation: "The claim is not verifiable.",
    }],
    verdicts: [{
      claimId: "c1",
      verdict: "not_verifiable",
      confidence: "low",
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
    }],
    revisions: [],
    safetyEvents: [],
    failures: [],
    approvedChangeIds: [],
    startedAt: CREATED_AT,
    completedAt: UPDATED_AT,
  });
}

test("SQLite audit data and its valid receipt survive close and reopen", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "saga-audit-store-")), "audits.db");
  let now = CREATED_AT;
  const store = new SqliteAuditStore(path, () => now);
  const record = await store.createAudit({
    auditId: "aud-sqlite",
    mode: "live",
    auditMode: "quick",
    document: "A stored claim.",
    workspaceId: "ws1",
  });
  expect(record.auditMode).toBe("quick");

  const storedClaim = claim();
  const storedEvidence = evidence();
  const storedEvent = event(record.id);
  const result = { receipt: receipt(record.id), nested: { values: [1, 2, 3] } };
  const expectedResult = structuredClone(result);
  await store.saveClaim(record.id, storedClaim);
  await store.saveEvidence(record.id, storedEvidence);
  await store.appendEvent(storedEvent);
  await store.saveResult(record.id, result);
  now = UPDATED_AT;
  await store.updateAudit(record.id, { status: "completed" });

  storedClaim.originalText = "mutated after save";
  storedEvidence.excerpt = "mutated after save";
  result.nested.values.push(4);
  store.close();

  const reopened = new SqliteAuditStore(path);
  const loaded = await reopened.loadAudit(record.id);
  expect(loaded.record).toMatchObject({
    id: "aud-sqlite",
    mode: "live",
    auditMode: "quick",
    document: "A stored claim.",
    workspaceId: "ws1",
    status: "completed",
    error: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  });
  expect(loaded.claims).toEqual([claim()]);
  expect(loaded.evidence).toEqual([evidence()]);
  expect(loaded.events).toEqual([event(record.id)]);
  expect(loaded.result).toEqual(expectedResult);
  expect((loaded.result as typeof result).nested.values).toEqual([1, 2, 3]);
  expect(verifyReceipt((loaded.result as typeof result).receipt)).toEqual({
    valid: true,
    reason: "receipt hash, provenance, and grounding references are intact",
  });

  loaded.claims[0]!.originalText = "mutated after load";
  (loaded.result as typeof result).nested.values.push(9);
  const loadedAgain = await reopened.loadAudit(record.id);
  expect(loadedAgain.claims).toEqual([claim()]);
  expect((loadedAgain.result as typeof result).nested.values).toEqual([1, 2, 3]);
  reopened.close();
});

test("SQLite output clearing and event appends are deterministic and idempotent", async () => {
  const store = new SqliteAuditStore(":memory:", () => CREATED_AT);
  const record = await store.createAudit({ mode: "live", document: "doc", workspaceId: "ws" });
  expect(record.auditMode).toBe("deep");

  const first = event(record.id);
  await store.saveClaim(record.id, claim());
  await store.saveEvidence(record.id, evidence());
  await store.appendEvent(first);
  await store.appendEvent(structuredClone(first));
  await store.saveResult(record.id, { ok: true });
  expect((await store.loadAudit(record.id)).events).toHaveLength(1);

  await expect(store.appendEvent({ ...first, detail: { verdict: "failed" } })).rejects.toThrow(/sequence|exists/i);
  await store.clearAuditOutput(record.id);
  const cleared = await store.loadAudit(record.id);
  expect(cleared.claims).toEqual([]);
  expect(cleared.evidence).toEqual([]);
  expect(cleared.events).toEqual([]);
  expect(cleared.result).toBeNull();
  expect(cleared.record.status).toBe("created");
  store.close();
});

test("SQLite audit state can be reset for a deterministic guest demo", async () => {
  const store = new SqliteAuditStore(":memory:", () => CREATED_AT);
  const first = await store.createAudit({ auditId: "first", mode: "live", document: "one", workspaceId: "guest" });
  const second = await store.createAudit({ auditId: "second", mode: "live", document: "two", workspaceId: "guest" });
  await store.saveClaim(first.id, claim());
  await store.saveResult(second.id, { ok: true });
  store.clearAll();
  await expect(store.loadAudit(first.id)).rejects.toThrow(/not found/i);
  await expect(store.loadAudit(second.id)).rejects.toThrow(/not found/i);
  store.close();
});
