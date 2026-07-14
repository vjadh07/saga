// Inputs for the small mock evaluation. Case definitions contain only submitted claims,
// ordinary search results, and ordinary page text. The stateless evaluation model derives
// its structured responses from request text after the runner receives each input.
import { FixturePageFetcher } from "../providers/fetch.js";
import { FixtureSearchProvider } from "../providers/search.js";
import type { LiveAuditInput } from "../live/audit.js";
import type { Claim } from "../types.js";
import { TextDerivedEvaluationModelProvider, evaluationQueriesForClaim } from "./text-derived-model.js";

const NOW = "2026-07-14T00:00:00.000Z";

export const HIDDEN_CASE_IDS = ["case-01", "case-02", "case-03"] as const;
export type HiddenCaseId = (typeof HIDDEN_CASE_IDS)[number];

export interface UnlabeledLiveCase {
  caseId: HiddenCaseId;
  createInput(): LiveAuditInput;
}

function claim(id: string, document: string, claimType: Claim["claimType"], risk: Claim["risk"]): Claim {
  return {
    id,
    originalText: document,
    normalized: document.toLocaleLowerCase("en-US"),
    claimType,
    location: { start: 0, end: document.length },
    verifiable: true,
    timeSensitive: false,
    risk,
    status: "contracted",
    asOf: null,
  };
}

function caseOneInput(): LiveAuditInput {
  const document = "The River Bridge opened on June 1, 2026.";
  const sourceUrl = "https://news.example/river-bridge";
  const queries = evaluationQueriesForClaim(document);
  return {
    auditId: "eval-01",
    document,
    claims: [claim("claim-01", document, "general", "low")],
    mode: "quick",
    model: new TextDerivedEvaluationModelProvider(),
    search: new FixtureSearchProvider({
      [queries.supporting]: [{
        title: "Regional news report",
        url: sourceUrl,
        snippet: "River Bridge opening report",
        publisher: "Regional News",
        publishedAt: "2026-06-02T00:00:00.000Z",
      }],
      [queries.skeptic]: [],
    }),
    fetcher: new FixturePageFetcher({
      [sourceUrl]: { title: "Regional news report", text: document },
    }, () => NOW),
    now: NOW,
  };
}

function caseTwoInput(): LiveAuditInput {
  const document = "Revenue moved from $80 million to $100 million, a 40% increase.";
  const page = "The audited filing states revenue moved from $80 million to $100 million in the period.";
  const sourceUrl = "https://filings.example/revenue";
  const queries = evaluationQueriesForClaim(document);
  return {
    auditId: "eval-02",
    document,
    claims: [claim("claim-02", document, "numeric", "high")],
    mode: "quick",
    model: new TextDerivedEvaluationModelProvider(),
    search: new FixtureSearchProvider({
      [queries.supporting]: [{
        title: "Audited filing",
        url: sourceUrl,
        snippet: "Audited revenue values",
        publisher: "Example Holdings",
        publishedAt: "2026-06-30T00:00:00.000Z",
      }],
      [queries.skeptic]: [],
    }),
    fetcher: new FixturePageFetcher({
      [sourceUrl]: { title: "Audited filing", text: page },
    }, () => NOW),
    now: NOW,
  };
}

function caseThreeInput(): LiveAuditInput {
  const document = "The agency completed Project Cedar in 2026.";
  const sourceUrl = "https://records.example/project-cedar";
  const queries = evaluationQueriesForClaim(document);
  return {
    auditId: "eval-03",
    document,
    claims: [claim("claim-03", document, "event", "medium")],
    mode: "quick",
    model: new TextDerivedEvaluationModelProvider(),
    search: new FixtureSearchProvider({
      [queries.supporting]: [{
        title: "Agency project record",
        url: sourceUrl,
        snippet: "Project record",
        publisher: "Agency Records",
      }],
      [queries.skeptic]: [],
    }),
    fetcher: new FixturePageFetcher({}, () => NOW),
    now: NOW,
  };
}

export const UNLABELED_LIVE_CASES: readonly UnlabeledLiveCase[] = [
  { caseId: "case-01", createInput: caseOneInput },
  { caseId: "case-02", createInput: caseTwoInput },
  { caseId: "case-03", createInput: caseThreeInput },
];
