import { expect, test } from "vitest";
import type { RawClaim } from "../src/verify/agent/mapper.js";
import type { LiveAuditResult } from "../src/verify/live/audit.js";
import { createLiveAuditService } from "../src/verify/live/composition.js";
import type { FetchedPage, PageFetcher } from "../src/verify/providers/fetch.js";
import { MockModelProvider, type ModelProvider, type StructuredModelRequest } from "../src/verify/providers/model.js";
import type { SearchProvider, SearchRequest, SearchResult } from "../src/verify/providers/search.js";
import { InMemoryAuditStore } from "../src/verify/providers/store.js";
import { verifyReceipt } from "../src/verify/receipt.js";
import { validateRevision } from "../src/verify/research/revision.js";
import { hashId, sha256hex } from "../src/verify/text.js";

const NOW = "2026-07-14T12:00:00.000Z";
const DOCUMENT = "Quarterly note: Acme reported revenue grew from $80 million to $100 million during 2025, a 40% increase.";
const CLAIM_TEXT = "Acme reported revenue grew from $80 million to $100 million during 2025, a 40% increase.";
const CLAIM_NORMALIZED = "acme revenue grew from 80 million to 100 million during 2025 by 40 percent";
const CLAIM_ID = hashId("claim", CLAIM_NORMALIZED);

const SUPPORT_QUERY = "Acme 2025 audited revenue filing 80 100";
const SKEPTIC_QUERY = "Acme 2025 revenue percentage recalculation";
const FILING_URL = "https://records.example/acme-2025-filing";
const WIRE_URL = "https://wire.example/acme-2025-results";
const REVIEW_URL = "https://oversight.example/acme-2025-recalculation";
const SUPPORT_TEXT = "Acme reported that revenue grew from $80 million to $100 million during 2025, a 40% increase.";
const CONTRADICTION_TEXT = "The verified change from $80 million to $100 million during 2025 is 25%, not 40%.";
const FILING_SOURCE_ID = hashId("src", FILING_URL, sha256hex(SUPPORT_TEXT));
const WIRE_SOURCE_ID = hashId("src", WIRE_URL, sha256hex(SUPPORT_TEXT));
const REVIEW_SOURCE_ID = hashId("src", REVIEW_URL, sha256hex(CONTRADICTION_TEXT));
const FILING_EVIDENCE_ID = hashId("ev", CLAIM_ID, FILING_SOURCE_ID, "supports");
const WIRE_EVIDENCE_ID = hashId("ev", CLAIM_ID, WIRE_SOURCE_ID, "supports");
const REVIEW_EVIDENCE_ID = hashId("ev", CLAIM_ID, REVIEW_SOURCE_ID, "contradicts");
const CORRECTION = "Acme reported that revenue grew from $80 million to $100 million during 2025. The verified percent change is 25%.";

const MAPPER_RESPONSE: RawClaim[] = [
  {
    originalText: CLAIM_TEXT,
    normalized: CLAIM_NORMALIZED,
    claimType: "numeric",
    verifiable: true,
    timeSensitive: true,
    risk: "high",
    asOf: "2025-12-31T00:00:00.000Z",
  },
  {
    originalText: "This model-proposed sentence is not in the submitted document.",
    normalized: "not in submitted document",
    claimType: "general",
    verifiable: true,
    timeSensitive: false,
    risk: "low",
    asOf: null,
  },
];

const SEARCH_RESULTS: Readonly<Record<string, SearchResult[]>> = {
  [SUPPORT_QUERY]: [
    { title: "Acme audited filing", url: FILING_URL, snippet: "Audited annual results", publisher: "Acme Records", publishedAt: "2026-02-01T00:00:00.000Z" },
    { title: "Acme annual results", url: WIRE_URL, snippet: "Annual results report", publisher: "Business Wire", publishedAt: "2026-02-02T00:00:00.000Z" },
  ],
  [SKEPTIC_QUERY]: [
    { title: "Revenue recalculation", url: REVIEW_URL, snippet: "Independent arithmetic review", publisher: "Accounting Oversight Board", publishedAt: "2026-03-01T00:00:00.000Z" },
  ],
};

const PAGE_TEXT: Readonly<Record<string, string>> = {
  [FILING_URL]: SUPPORT_TEXT,
  [WIRE_URL]: SUPPORT_TEXT,
  [REVIEW_URL]: CONTRADICTION_TEXT,
};

test("arbitrary text completes and persists the full live audit with deterministic mock providers", async () => {
  const externalInputs = JSON.stringify({ document: DOCUMENT, mapperResponse: MAPPER_RESPONSE, searchResults: SEARCH_RESULTS, pages: PAGE_TEXT });
  expect(externalInputs).not.toMatch(/\bDEMO_/);
  expect(externalInputs).not.toMatch(/"(?:stance|relatesTo|relevance|verdict|expectedVerdict)"\s*:/);

  const searchRequests: SearchRequest[] = [];
  const fetchedUrls: string[] = [];
  const search: SearchProvider = {
    id: "mock-search",
    async search(request) {
      searchRequests.push(structuredClone(request));
      const results = SEARCH_RESULTS[request.query] ?? [];
      return structuredClone(request.limit ? results.slice(0, request.limit) : results);
    },
  };
  const fetcher: PageFetcher = {
    id: "mock-pages",
    async fetch(url): Promise<FetchedPage> {
      fetchedUrls.push(url);
      const text = PAGE_TEXT[url];
      if (!text) throw new Error(`missing mock page for ${url}`);
      return {
        originalUrl: url,
        finalUrl: url,
        status: 200,
        contentType: "text/html",
        title: url === FILING_URL ? "Acme audited filing" : url === WIRE_URL ? "Acme annual results" : "Revenue recalculation",
        text,
        links: [],
        fetchedAt: NOW,
        contentHash: sha256hex(text),
      };
    },
  };
  const scriptedModel = new MockModelProvider({
    claim_mapper: [{ claims: MAPPER_RESPONSE }],
    research_plan: [{ supportingQueries: [SUPPORT_QUERY], skepticQueries: [SKEPTIC_QUERY] }],
    investigator_assess: [
      { relevant: true, supports: true, excerpt: SUPPORT_TEXT, relevance: "strong", reasoning: "The audited filing states the full claim." },
      { relevant: true, supports: true, excerpt: SUPPORT_TEXT, relevance: "strong", reasoning: "The report repeats the full claim." },
    ],
    skeptic_assess: [
      { relevant: true, stance: "contradicts", excerpt: CONTRADICTION_TEXT, relevance: "strong", reasoning: "The independent recalculation rejects the stated percentage." },
    ],
    source_quality: [
      { sourceType: "primary", directness: "direct", independence: "independent", methodologyVisible: true, promotional: false, strengths: ["audited filing"], weaknesses: [] },
      { sourceType: "news", directness: "indirect", independence: "derived", methodologyVisible: true, promotional: false, strengths: ["quotes the filing"], weaknesses: ["derived report"] },
      { sourceType: "gov", directness: "direct", independence: "independent", methodologyVisible: true, promotional: false, strengths: ["recomputed arithmetic"], weaknesses: [] },
    ],
    citation_assessment: [
      { sameEntity: true, sameMetric: true, samePeriod: true, samePopulation: true, claimStrongerThanSource: false, qualifiersOmitted: false, relation: "direct_support", explanation: "The excerpt states the submitted claim." },
      { sameEntity: true, sameMetric: true, samePeriod: true, samePopulation: true, claimStrongerThanSource: false, qualifiersOmitted: false, relation: "direct_support", explanation: "The excerpt states the submitted claim." },
      { sameEntity: true, sameMetric: true, samePeriod: true, samePopulation: true, claimStrongerThanSource: false, qualifiersOmitted: false, relation: "direct_contradiction", explanation: "The excerpt recomputes the same percentage." },
    ],
    numeric_extract: [{ kind: "percent_change", inputs: { from: 80, to: 100 }, claimedResult: 40, explanation: "The claim states a change from 80 to 100 and calls it 40 percent." }],
    conflict_analysis: [{ cause: "genuine_dispute", reconciled: false, explanation: "The sources address the same entity, metric, and period but give incompatible percentages." }],
    revision: [{ replacement: CORRECTION, citationEvidenceIds: [FILING_EVIDENCE_ID, WIRE_EVIDENCE_ID, REVIEW_EVIDENCE_ID] }],
  }, "mock-model/e2e");
  const modelPurposes: string[] = [];
  const model: ModelProvider = {
    id: scriptedModel.id,
    generateStructured<T>(request: StructuredModelRequest<T>): Promise<T> {
      modelPurposes.push(request.purpose);
      return scriptedModel.generateStructured(request);
    },
  };

  const metricClock = [1_000, 1_025];
  const serviceClock = [2_000, 2_025];
  const store = new InMemoryAuditStore(() => NOW);
  const service = createLiveAuditService({
    store,
    model,
    search,
    fetcher,
    now: () => NOW,
    resourceOptions: {
      clock: () => metricClock.shift() ?? 1_025,
      retryDelayMs: 0,
      costRates: { modelCallUsd: 0.01, searchUsd: 0.02, pageFetchUsd: 0.005 },
    },
    serviceOptions: { clock: () => serviceClock.shift() ?? 2_025 },
  });

  const created = await service.create({ document: DOCUMENT, mode: "live", auditMode: "quick", workspaceId: "guest" });
  expect(created).toMatchObject({ mode: "live", auditMode: "quick", document: DOCUMENT, workspaceId: "guest", status: "created" });
  await service.process(created.id);
  const persisted = await service.get(created.id);

  expect(modelPurposes).toEqual([
    "claim_mapper",
    "research_plan",
    "investigator_assess",
    "investigator_assess",
    "skeptic_assess",
    "source_quality",
    "source_quality",
    "source_quality",
    "citation_assessment",
    "citation_assessment",
    "citation_assessment",
    "numeric_extract",
    "conflict_analysis",
    "revision",
  ]);
  expect(persisted.record).toMatchObject({ id: created.id, mode: "live", auditMode: "quick", status: "completed", error: null });
  expect(persisted.claims).toHaveLength(1);
  expect(persisted.claims[0]).toMatchObject({ id: CLAIM_ID, originalText: CLAIM_TEXT, claimType: "numeric", asOf: "2025-12-31T00:00:00.000Z" });
  expect(persisted.result).not.toBeNull();

  const result = persisted.result as LiveAuditResult;
  const audit = result.claimAudits[0]!;
  expect(result).toMatchObject({ auditId: created.id, mode: "live", document: DOCUMENT });
  expect(audit.claim.id).toBe(CLAIM_ID);
  expect(audit.plan).toMatchObject({
    claimId: CLAIM_ID,
    supportingQueries: [SUPPORT_QUERY],
    skepticQueries: [SKEPTIC_QUERY],
    primaryRequired: true,
    minimumIndependentOrigins: 1,
    maximumIterations: 1,
  });

  expect(searchRequests.map((request) => request.query)).toEqual([SUPPORT_QUERY, SKEPTIC_QUERY]);
  expect(fetchedUrls).toEqual([FILING_URL, WIRE_URL, REVIEW_URL]);
  expect(audit.evidence.filter((item) => item.capturedBy === "investigator").map((item) => item.id).sort()).toEqual([FILING_EVIDENCE_ID, WIRE_EVIDENCE_ID].sort());
  expect(audit.evidence.filter((item) => item.capturedBy === "skeptic").map((item) => item.id)).toEqual([REVIEW_EVIDENCE_ID]);
  expect(audit.evidence).toHaveLength(3);
  expect(audit.evidence.every((item) => item.citationAssessment?.exactMatchVerified === true)).toBe(true);
  expect(audit.evidence.map((item) => item.citationAssessment!.relation).sort()).toEqual(["direct_contradiction", "direct_support", "direct_support"]);
  expect(audit.sourceQuality).toHaveLength(3);
  expect(audit.sourceQuality.every((assessment) => assessment.accepted)).toBe(true);
  expect(audit.sourceQuality.map((assessment) => assessment.sourceType)).toEqual(["primary", "news", "gov"]);

  const lineageEvent = result.flight.find((event) => event.type === "LINEAGE_GROUP_DETECTED");
  expect(lineageEvent?.detail.sourceIds).toEqual([FILING_SOURCE_ID, WIRE_SOURCE_ID].sort());
  expect(lineageEvent?.detail.signals).toEqual(expect.arrayContaining(["near_duplicate_text", "syndication_window"]));
  expect(audit.temporal).toMatchObject({
    scope: "historical",
    claimAsOf: "2025-12-31T00:00:00.000Z",
    latestEvidenceAt: "2026-03-01T00:00:00.000Z",
    superseded: false,
  });
  expect(audit.numeric).toMatchObject({
    claimId: CLAIM_ID,
    kind: "percent_change",
    computedResult: 25,
    claimedResult: 40,
    matches: false,
    grounded: true,
    groundingIssues: [],
  });
  expect(audit.numeric!.sourceEvidenceIds).toEqual([FILING_EVIDENCE_ID, WIRE_EVIDENCE_ID, REVIEW_EVIDENCE_ID].sort());
  expect(audit.contractEvaluation).toMatchObject({
    claimId: CLAIM_ID,
    supportingCriteriaMet: true,
    contradictingCriteriaMet: true,
    primaryRequirementMet: true,
    preferredSourceRequirementMet: true,
    independentOriginRequirementMet: true,
    temporalRequirementMet: true,
    triggeredAbstentionConditions: [],
  });
  expect(audit.conflict).toMatchObject({ claimId: CLAIM_ID, hasConflict: true, cause: "genuine_dispute", reconciled: false });
  expect(audit.verdict).toMatchObject({
    claimId: CLAIM_ID,
    verdict: "contradicted",
    confidence: "high",
    supporting: [FILING_EVIDENCE_ID, WIRE_EVIDENCE_ID],
    contradicting: [REVIEW_EVIDENCE_ID],
  });

  const revisionValidation = validateRevision({
    claimId: CLAIM_ID,
    original: CLAIM_TEXT,
    replacement: CORRECTION,
    verdictKind: "contradicted",
    citationIds: [FILING_EVIDENCE_ID, WIRE_EVIDENCE_ID, REVIEW_EVIDENCE_ID],
    evidence: audit.evidence,
    numeric: audit.numeric,
  });
  expect(revisionValidation.reason).toBe("");
  expect(revisionValidation.ok).toBe(true);
  expect(result.correctedDraft.changes[0]!.source).toBe("revision_agent");
  expect(result.correctedDraft).toMatchObject({
    original: DOCUMENT,
    draft: `Quarterly note: ${CORRECTION}`,
  });
  expect(result.correctedDraft.changes).toHaveLength(1);
  expect(result.correctedDraft.changes[0]).toMatchObject({
    claimId: CLAIM_ID,
    replacement: CORRECTION,
    citations: [FILING_EVIDENCE_ID, WIRE_EVIDENCE_ID, REVIEW_EVIDENCE_ID],
    source: "revision_agent",
    numericCheckClaimId: CLAIM_ID,
  });
  expect(result.correctedDraft.draft).not.toMatch(/\[(?:update|removed|qualify|unverified|disputed)/i);
  expect(result.passport).toMatchObject({
    totalClaims: 1,
    contradicted: 1,
    primarySourceCount: 1,
    independentOrigins: 2,
    claimsRequiringRevision: 1,
    documentStatus: "materially_contradicted",
  });

  expect(verifyReceipt(result.receipt)).toMatchObject({ valid: true, reason: expect.stringMatching(/intact/) });
  expect(result.receipt).toMatchObject({
    auditId: created.id,
    mode: "live",
    modelProvider: "mock-model/e2e",
    searchProvider: "mock-search",
    documentHash: sha256hex(DOCUMENT),
    finalDraftHash: sha256hex(result.correctedDraft.draft),
  });
  expect(result.receipt.searches.map(({ agent, query }) => ({ agent, query }))).toEqual([
    { agent: "investigator", query: SUPPORT_QUERY },
    { agent: "skeptic", query: SKEPTIC_QUERY },
  ]);
  expect(result.receipt.evidence.map((item) => item.id).sort()).toEqual([FILING_EVIDENCE_ID, WIRE_EVIDENCE_ID, REVIEW_EVIDENCE_ID].sort());
  expect(result.receipt.numericChecks).toEqual([audit.numeric]);
  expect(result.receipt.revisions[0]).toMatchObject({
    claimId: CLAIM_ID,
    citationEvidenceIds: [FILING_EVIDENCE_ID, WIRE_EVIDENCE_ID, REVIEW_EVIDENCE_ID].sort(),
    source: "revision_agent",
    numericCheckClaimId: CLAIM_ID,
  });
  expect(result.receipt.finalAuditHash).toMatch(/^[0-9a-f]{64}$/);

  expect(persisted.evidence).toEqual(audit.evidence);
  expect(persisted.events).toEqual(result.flight);
  expect(persisted.events.map((event) => event.type)).toEqual(expect.arrayContaining([
    "CLAIMS_EXTRACTED",
    "CONTRACT_DEFINED",
    "QUERY_EXECUTED",
    "PRIMARY_SOURCE_FOUND",
    "CONTRADICTION_FOUND",
    "LINEAGE_GROUP_DETECTED",
    "VERDICT_REACHED",
    "AUDIT_COMPLETED",
  ]));
  expect(result.metrics).toEqual({
    durationMs: 25,
    claims: 1,
    modelCalls: 14,
    searches: 2,
    pageFetches: 3,
    retries: 0,
    estimatedCostUsd: 0.195,
    costBasis: "configured per-call rates",
  });
});
