import { expect, test } from "vitest";
import { InMemoryAuditStore } from "../src/verify/providers/store.js";
import { AuditService } from "../src/verify/live/service.js";
import { buildReceipt } from "../src/verify/receipt.js";
import { hashId, sha256hex } from "../src/verify/text.js";
import type { LiveAuditResult } from "../src/verify/live/audit.js";
import type { Claim, Evidence, NumericCheck, Source } from "../src/verify/types.js";

function claim(id: string, originalText = "d", start = 0): Claim {
  return { id, originalText, normalized: originalText.toLowerCase(), claimType: "general", location: { start, end: start + originalText.length }, verifiable: true, timeSensitive: false, risk: "low", status: "contracted", asOf: null };
}
function fakeResult(auditId: string, document: string, verdicts: string[], evidence: Evidence[] = []): LiveAuditResult {
  const normalized = verdicts.map((value) => value === "failed" ? "failed" as const : "not_verifiable" as const);
  const contractEvaluations = normalized.map((_value, index) => ({
    claimId: `c${index}`,
    supportingCriteriaMet: false,
    contradictingCriteriaMet: false,
    primaryRequirementMet: false,
    preferredSourceRequirementMet: false,
    independentOriginRequirementMet: false,
    temporalRequirementMet: true,
    triggeredAbstentionConditions: [],
    explanation: "service test",
  }));
  const receipt = buildReceipt({
    auditId,
    mode: "live",
    modelProvider: "mock",
    modelId: "mock",
    searchProvider: "mock-search",
    document,
    finalDraft: document,
    searches: [],
    sources: [],
    evidence: [],
    numericChecks: [],
    contractEvaluations,
    verdicts: normalized.map((verdict, index) => ({
      claimId: `c${index}`,
      verdict,
      confidence: "low",
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
    })),
    revisions: [],
    safetyEvents: [],
    failures: [],
    approvedChangeIds: [],
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:00:00.000Z",
  });
  return {
    auditId, mode: "live", document,
    claimAudits: normalized.map((verdict, i) => ({
      claim: verdicts.length === 1 ? claim(`c${i}`, document) : claim(`c${i}`, document.slice(i, i + 1), i),
      verdict: { claimId: `c${i}`, verdict, confidence: "low", supporting: [], contradicting: [] },
      contractEvaluation: contractEvaluations[i],
      evidence: i === 0 ? evidence : [],
    })) as never,
    dependencies: [], reevaluation: [], lineage: { groups: [], sourceCount: 0, independentOrigins: 0 }, safetyEvents: [], passport: {} as never, correctedDraft: { original: document, changes: [], draft: document },
    receipt,
    flight: [{ seq: 1, auditId, claimId: "", type: "AUDIT_COMPLETED", detail: {}, at: "t" }],
    metrics: { durationMs: 1, claims: verdicts.length, modelCalls: 1, searches: 0, pageFetches: 0, retries: 0, estimatedCostUsd: null, costBasis: "not configured by provider" },
  };
}

function richResult(auditId: string, document: string): LiveAuditResult {
  const mappedClaim = { ...claim("c0", document), claimType: "numeric" as const };
  const query = "official total";
  const finalUrl = "https://example.com/report";
  const fetchedAt = "2026-07-13T00:00:00.000Z";
  const rawHash = sha256hex("raw source response");
  const sourceId = hashId("src", finalUrl, rawHash);
  const source: Source = {
    id: sourceId,
    url: finalUrl,
    canonicalUrl: null,
    title: "Official report",
    publisher: "Example",
    publishedAt: fetchedAt,
    sourceType: "primary",
    content: document,
    quotes: [document],
    outboundCitations: [],
    retrievals: [{
      originalUrl: finalUrl,
      finalUrl,
      fetchedAt,
      contentHash: rawHash,
      claimId: mappedClaim.id,
      agent: "investigator",
      query,
    }],
  };
  const citationAssessment = {
    relation: "direct_support" as const,
    explanation: "The source directly states the claim.",
    exactMatchVerified: true,
    sameEntity: true,
    sameMetric: true,
    samePeriod: true,
    samePopulation: true,
    claimStrongerThanSource: false,
    qualifiersOmitted: false,
  };
  const evidence: Evidence = {
    id: "ev_same_id",
    claimId: mappedClaim.id,
    sourceId,
    stance: "supports",
    excerpt: document,
    relevance: "strong",
    capturedBy: "investigator",
    citationAssessment,
  };
  const numeric: NumericCheck = {
    claimId: mappedClaim.id,
    kind: "total",
    expression: "10 + 20 = 30",
    inputs: { first: 10, second: 20 },
    computedResult: 30,
    claimedResult: 30,
    matches: true,
    explanation: "The stated total is correct.",
    grounded: true,
    groundingIssues: [],
    sourceEvidenceIds: [evidence.id],
  };
  const contractEvaluation = {
    claimId: mappedClaim.id,
    supportingCriteriaMet: true,
    contradictingCriteriaMet: false,
    primaryRequirementMet: true,
    preferredSourceRequirementMet: true,
    independentOriginRequirementMet: true,
    temporalRequirementMet: true,
    triggeredAbstentionConditions: [],
    explanation: "The evidence contract is satisfied.",
  };
  const safety = { sourceId, kind: "script_stripped" as const, excerpt: "<script>", action: "sanitized" as const };
  const failure = { agent: "investigator" as const, operation: "search_result" as const, query, url: null, error: "One malformed result was ignored." };
  const change = {
    claimId: mappedClaim.id,
    kind: "rewrite" as const,
    original: document,
    replacement: "The verified total is 30.",
    note: "Grounded in the official report.",
    citations: [evidence.id],
    source: "revision_agent" as const,
    numericCheckClaimId: mappedClaim.id,
  };
  const searches = [{ sequence: 1, claimId: mappedClaim.id, agent: "investigator" as const, query }];
  const sources = [{
    sourceId,
    sanitizedContentHash: sha256hex(source.content),
    retrievals: [{ claimId: mappedClaim.id, agent: "investigator" as const, query, originalUrl: finalUrl, finalUrl, accessedAt: fetchedAt, contentHash: rawHash }],
  }];
  const receipt = buildReceipt({
    auditId,
    mode: "live",
    modelProvider: "mock",
    modelId: "mock",
    searchProvider: "mock-search",
    document,
    finalDraft: change.replacement,
    searches,
    sources,
    evidence: [{ id: evidence.id, claimId: evidence.claimId, sourceId, stance: evidence.stance, excerpt: evidence.excerpt, citationAssessment }],
    numericChecks: [numeric],
    contractEvaluations: [contractEvaluation],
    verdicts: [{ claimId: mappedClaim.id, verdict: "supported", confidence: "high", supportingEvidenceIds: [evidence.id], contradictingEvidenceIds: [] }],
    revisions: [{ claimId: mappedClaim.id, kind: change.kind, original: change.original, replacement: change.replacement, citationEvidenceIds: change.citations, source: change.source, numericCheckClaimId: mappedClaim.id }],
    safetyEvents: [safety],
    failures: [{ sequence: 1, claimId: mappedClaim.id, ...failure }],
    approvedChangeIds: [],
    startedAt: fetchedAt,
    completedAt: fetchedAt,
  });
  return {
    auditId,
    mode: "live",
    document,
    claimAudits: [{
      claim: mappedClaim,
      contract: { claimId: mappedClaim.id, supportingCriteria: ["official total"], contradictingCriteria: ["different total"], abstentionConditions: ["no primary source"], preferredSourceTypes: ["primary"], primaryRequired: true },
      plan: null,
      evidence: [evidence],
      sourceQuality: [],
      sourcesExamined: [source],
      contractEvaluation,
      temporal: { scope: "current", claimAsOf: null, latestEvidenceAt: fetchedAt, superseded: false, note: "Current." },
      numeric,
      conflict: { claimId: mappedClaim.id, hasConflict: false, cause: "none", reconciled: false, explanation: "No conflict." },
      verdict: { claimId: mappedClaim.id, verdict: "supported", confidence: "high", rationale: "Validated.", supporting: [evidence.id], contradicting: [], independentOrigins: 1, temporal: null, requiredCorrection: null },
      executedSearches: [{ agent: "investigator", query }],
      safety: [safety],
      errors: [failure],
    }],
    dependencies: [],
    reevaluation: [],
    lineage: { groups: [], sourceCount: 1, independentOrigins: 1 },
    safetyEvents: [safety],
    passport: {} as never,
    correctedDraft: { original: document, changes: [change], draft: change.replacement },
    receipt,
    flight: [],
    metrics: { durationMs: 1, claims: 1, modelCalls: 1, searches: 1, pageFetches: 1, retries: 0, estimatedCostUsd: null, costBasis: "not configured by provider" },
  };
}
function service(runAudit: (i: { auditId: string; document: string; claims: Claim[]; auditMode: string }) => Promise<LiveAuditResult>, mapClaims = async (document: string) => [claim("c0", document)]) {
  const store = new InMemoryAuditStore(() => "2026-07-13T00:00:00.000Z");
  return { store, svc: new AuditService(store, { mapClaims, runAudit: runAudit as never }) };
}

test("a successful audit transitions to completed and persists claims, events, and result", async () => {
  const { store, svc } = service(async ({ auditId, document }) => fakeResult(auditId, document, ["supported"]));
  const rec = await svc.create({ document: "The sky is blue.", mode: "live", workspaceId: "ws1" });
  await svc.process(rec.id);
  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("completed");
  expect(loaded.claims).toHaveLength(1);
  expect(loaded.evidence).toEqual([]);
  expect(loaded.events).toHaveLength(1);
  expect(loaded.result).not.toBeNull();
});

test("some failed claims yield partially_completed, all failed yields failed", async () => {
  const mapped = async () => [claim("c0", "a", 0), claim("c1", "b", 1)];
  const partial = service(async ({ auditId, document }) => fakeResult(auditId, document, ["supported", "failed"]), mapped);
  const rp = await partial.svc.create({ document: "ab", mode: "live", workspaceId: "ws" });
  await partial.svc.process(rp.id);
  expect((await partial.store.loadAudit(rp.id)).record.status).toBe("partially_completed");

  const failed = service(async ({ auditId, document }) => fakeResult(auditId, document, ["failed", "failed"]), mapped);
  const rf = await failed.svc.create({ document: "ab", mode: "live", workspaceId: "ws" });
  await failed.svc.process(rf.id);
  expect((await failed.store.loadAudit(rf.id)).record.status).toBe("failed");
});

test("no extracted claims fails the audit cleanly", async () => {
  const { store, svc } = service(async ({ auditId, document }) => fakeResult(auditId, document, []), async () => []);
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("failed");
  expect(loaded.record.error).toMatch(/no verifiable claims/i);
});

test("a runner exception fails only that audit", async () => {
  const { store, svc } = service(async () => { throw new Error("provider down"); });
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("failed");
  expect(loaded.record.error).toMatch(/provider down/);
});

test("cancellation before processing lands the audit in cancelled", async () => {
  const { store, svc } = service(async ({ auditId, document }) => fakeResult(auditId, document, ["supported"]));
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.cancel(rec.id);
  await svc.process(rec.id);
  expect((await store.loadAudit(rec.id)).record.status).toBe("cancelled");
});

test("retry re-runs a failed audit to completion", async () => {
  let calls = 0;
  const { store, svc } = service(async ({ auditId, document }) => {
    calls += 1;
    if (calls === 1) throw new Error("transient");
    return fakeResult(auditId, document, ["supported"]);
  });
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  expect((await store.loadAudit(rec.id)).record.status).toBe("failed");
  await svc.retry(rec.id);
  expect((await store.loadAudit(rec.id)).record.status).toBe("completed");
  expect((await store.loadAudit(rec.id)).claims).toHaveLength(1);
});

test("a runner result for a different audit is rejected instead of rewritten", async () => {
  const { store, svc } = service(async ({ document }) => fakeResult("other-audit", document, ["supported"]));
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("failed");
  expect(loaded.record.error).toMatch(/audit id/i);
  expect(loaded.result).toBeNull();
});

test("completed audits cannot be cancelled or processed again", async () => {
  let calls = 0;
  const { store, svc } = service(async ({ auditId, document }) => {
    calls += 1;
    return fakeResult(auditId, document, ["supported"]);
  });
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  await svc.cancel(rec.id);
  await svc.process(rec.id);
  expect((await store.loadAudit(rec.id)).record.status).toBe("completed");
  expect(calls).toBe(1);
});

test("concurrent worker delivery runs an audit only once", async () => {
  let releaseMapping!: () => void;
  let mappingCalls = 0;
  let auditCalls = 0;
  const mappingGate = new Promise<void>((resolve) => { releaseMapping = resolve; });
  const store = new InMemoryAuditStore(() => "2026-07-13T00:00:00.000Z");
  const svc = new AuditService(store, {
    mapClaims: async () => {
      mappingCalls += 1;
      await mappingGate;
      return [claim("c0")];
    },
    runAudit: async ({ auditId, document }) => {
      auditCalls += 1;
      return fakeResult(auditId, document, ["supported"]);
    },
  });
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });

  const first = svc.process(rec.id);
  await Promise.resolve();
  const duplicate = svc.process(rec.id);
  releaseMapping();
  await Promise.all([first, duplicate]);

  expect(mappingCalls).toBe(1);
  expect(auditCalls).toBe(1);
  expect((await store.loadAudit(rec.id)).record.status).toBe("completed");
});

test("persisted cancellation survives a new service instance", async () => {
  let calls = 0;
  const runners = {
    mapClaims: async () => [claim("c0")],
    runAudit: async ({ auditId, document }: { auditId: string; document: string }) => {
      calls += 1;
      return fakeResult(auditId, document, ["supported"]);
    },
  };
  const store = new InMemoryAuditStore(() => "2026-07-13T00:00:00.000Z");
  const first = new AuditService(store, runners as never);
  const rec = await first.create({ document: "d", mode: "live", workspaceId: "ws" });
  await first.cancel(rec.id);
  await new AuditService(store, runners as never).process(rec.id);
  expect((await store.loadAudit(rec.id)).record.status).toBe("cancelled");
  expect(calls).toBe(0);
});

test("a cancellation from another service instance cannot be overwritten by a running worker", async () => {
  let started!: () => void;
  let release!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store = new InMemoryAuditStore(() => "2026-07-13T00:00:00.000Z");
  const runners = {
    mapClaims: async (document: string) => [claim("c0", document)],
    runAudit: async ({ auditId, document }: { auditId: string; document: string }) => {
      started();
      await gate;
      return fakeResult(auditId, document, ["supported"]);
    },
  };
  const worker = new AuditService(store, runners as never);
  const controller = new AuditService(store, runners as never);
  const rec = await worker.create({ document: "d", mode: "live", workspaceId: "ws" });

  const processing = worker.process(rec.id);
  await running;
  await controller.cancel(rec.id);
  release();
  await processing;

  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("cancelled");
  expect(loaded.result).toBeNull();
});

test("invalid or overlapping mapped claim spans fail before research", async () => {
  let auditCalls = 0;
  const { store, svc } = service(async ({ auditId, document }) => {
    auditCalls += 1;
    return fakeResult(auditId, document, ["supported"]);
  }, async () => [claim("c0", "ab", 0), claim("c1", "bc", 1)]);
  const rec = await svc.create({ document: "abc", mode: "live", workspaceId: "ws" });

  await svc.process(rec.id);

  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("failed");
  expect(loaded.record.error).toMatch(/overlap/i);
  expect(auditCalls).toBe(0);
});

test("a runner result with the wrong execution mode fails integrity validation", async () => {
  const { store, svc } = service(async ({ auditId, document }) => ({
    ...fakeResult(auditId, document, ["supported"]),
    mode: "demo",
  } as unknown as LiveAuditResult));
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("failed");
  expect(loaded.record.error).toMatch(/mode/i);
  expect(loaded.result).toBeNull();
});

test("the selected audit mode is persisted and passed to the live runner", async () => {
  let received = "";
  const { store, svc } = service(async ({ auditId, document, auditMode }) => {
    received = auditMode;
    return fakeResult(auditId, document, ["supported"]);
  });
  const rec = await svc.create({ document: "d", mode: "live", auditMode: "quick", workspaceId: "ws" });
  await svc.process(rec.id);
  expect((await store.loadAudit(rec.id)).record.auditMode).toBe("quick");
  expect(received).toBe("quick");
});

test("mapping is bounded by a timeout", async () => {
  const store = new InMemoryAuditStore(() => "2026-07-13T00:00:00.000Z");
  const svc = new AuditService(store, {
    mapClaims: async () => new Promise<Claim[]>(() => {}),
    runAudit: async ({ auditId, document }) => fakeResult(auditId, document, ["supported"]),
  }, { mappingTimeoutMs: 5 });
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("failed");
  expect(loaded.record.error).toMatch(/mapping timed out/i);
});

test("cancelling a running audit aborts the runner and stays cancelled", async () => {
  const store = new InMemoryAuditStore(() => "2026-07-13T00:00:00.000Z");
  let started!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const svc = new AuditService(store, {
    mapClaims: async () => [claim("c0")],
    runAudit: async ({ signal }) => {
      started();
      return new Promise<LiveAuditResult>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  const processing = svc.process(rec.id);
  await running;
  await svc.cancel(rec.id);
  await processing;
  expect((await store.loadAudit(rec.id)).record.status).toBe("cancelled");
});

test("real flight events survive a later runner failure", async () => {
  const store = new InMemoryAuditStore(() => "2026-07-13T00:00:00.000Z");
  const svc = new AuditService(store, {
    mapClaims: async () => [claim("c0")],
    runAudit: async ({ auditId, onEvent }) => {
      onEvent?.({ seq: 1, auditId, claimId: "c0", type: "QUERY_EXECUTED", detail: { query: "real query" }, at: "t" });
      throw new Error("receipt failed");
    },
  });
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("failed");
  expect(loaded.events).toEqual([
    { seq: 1, auditId: rec.id, claimId: "c0", type: "QUERY_EXECUTED", detail: { query: "real query" }, at: "t" },
  ]);
});

test("a tampered receipt cannot be persisted as completed", async () => {
  const { store, svc } = service(async ({ auditId, document }) => {
    const result = fakeResult(auditId, document, ["supported"]);
    result.receipt.finalAuditHash = "0".repeat(64);
    return result;
  });
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("failed");
  expect(loaded.record.error).toMatch(/receipt/i);
  expect(loaded.result).toBeNull();
});

test("the full signed result graph matches its receipt before persistence", async () => {
  const mapped = async (document: string) => [{ ...claim("c0", document), claimType: "numeric" as const }];
  const { store, svc } = service(async ({ auditId, document }) => richResult(auditId, document), mapped);
  const rec = await svc.create({ document: "The verified total is 30.", mode: "live", workspaceId: "ws" });

  await svc.process(rec.id);

  expect((await store.loadAudit(rec.id)).record.status).toBe("completed");
});

test("same-id evidence tampering cannot diverge from a valid receipt", async () => {
  const mapped = async (document: string) => [{ ...claim("c0", document), claimType: "numeric" as const }];
  const { store, svc } = service(async ({ auditId, document }) => {
    const result = richResult(auditId, document);
    result.claimAudits[0]!.evidence[0]!.excerpt = "Altered evidence with the same id.";
    return result;
  }, mapped);
  const rec = await svc.create({ document: "The verified total is 30.", mode: "live", workspaceId: "ws" });

  await svc.process(rec.id);

  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("failed");
  expect(loaded.record.error).toMatch(/receipt evidence/i);
  expect(loaded.result).toBeNull();
});

test("a result missing a mapped claim cannot be persisted as completed", async () => {
  const { store, svc } = service(async ({ auditId, document }) => fakeResult(auditId, document, []));
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  const loaded = await store.loadAudit(rec.id);
  expect(loaded.record.status).toBe("failed");
  expect(loaded.record.error).toMatch(/claim coverage/i);
  expect(loaded.result).toBeNull();
});

test("persisted duration covers claim mapping and the full audit", async () => {
  let time = 100;
  const store = new InMemoryAuditStore(() => "2026-07-13T00:00:00.000Z");
  const svc = new AuditService(store, {
    mapClaims: async () => {
      time = 115;
      return [claim("c0")];
    },
    runAudit: async ({ auditId, document }) => {
      time = 160;
      return fakeResult(auditId, document, ["supported"]);
    },
  }, { clock: () => time });
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  const result = (await store.loadAudit(rec.id)).result as LiveAuditResult;
  expect(result.metrics.durationMs).toBe(60);
});

test("a completed audit cannot be retried in place", async () => {
  const { store, svc } = service(async ({ auditId, document }) => fakeResult(auditId, document, ["supported"]));
  const rec = await svc.create({ document: "d", mode: "live", workspaceId: "ws" });
  await svc.process(rec.id);
  await expect(svc.retry(rec.id)).rejects.toThrow(/cannot retry.*completed/i);
  expect((await store.loadAudit(rec.id)).record.status).toBe("completed");
});
