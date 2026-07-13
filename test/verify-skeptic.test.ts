import { expect, test } from "vitest";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { FixtureSearchProvider } from "../src/verify/providers/search.js";
import { FixturePageFetcher } from "../src/verify/providers/fetch.js";
import { skepticResearch } from "../src/verify/research/skeptic.js";
import type { ResearchPlan } from "../src/verify/research/plan.js";
import type { Claim } from "../src/verify/types.js";

const claim: Claim = {
  id: "c1",
  originalText: "Northwind is the largest home battery maker in North America.",
  normalized: "northwind is the largest home battery maker in north america",
  claimType: "comparison",
  location: { start: 0, end: 10 },
  verifiable: true,
  timeSensitive: true,
  risk: "high",
  status: "contracted",
  asOf: null,
};
const plan: ResearchPlan = {
  claimId: "c1",
  supportingQueries: ["northwind market share"],
  skepticQueries: ["northwind not largest battery maker"],
  preferredSourceTypes: ["primary"],
  primaryRequired: true,
  minimumIndependentOrigins: 2,
  maximumIterations: 1,
  maximumSources: 8,
  stopWhen: ["done"],
  abstainWhen: ["nothing"],
};

test("uses its own counter-queries and captures contradicting evidence", async () => {
  const search = new FixtureSearchProvider({
    "northwind not largest battery maker": [
      { title: "Analyst", url: "https://analyst.example/s", snippet: "s", publisher: "Rho" },
      { title: "Fluff", url: "https://fluff.example/s", snippet: "s" },
    ],
  });
  const fetcher = new FixturePageFetcher({
    "https://analyst.example/s": { title: "Analyst", text: "By units shipped a rival overtook Northwind as the largest home battery maker in 2025." },
    "https://fluff.example/s": { title: "Fluff", text: "A lifestyle piece with nothing about market share." },
  });
  const model = new MockModelProvider({
    skeptic_assess: [
      { relevant: true, stance: "contradicts", excerpt: "a rival overtook Northwind as the largest home battery maker in 2025", relevance: "strong", reasoning: "rival leads" },
      { relevant: false, stance: "none", excerpt: "", relevance: "weak", reasoning: "off topic" },
    ],
  });
  const r = await skepticResearch({ claim, plan, search, fetcher, model });
  expect(r.evidence).toHaveLength(1);
  expect(r.evidence[0]!.stance).toBe("contradicts");
  expect(r.evidence[0]!.capturedBy).toBe("skeptic");
  expect(r.queriesUsed).toContain("northwind not largest battery maker");
  expect(r.queriesUsed).not.toContain("northwind market share");
});

test("may conclude that no meaningful counterevidence was found", async () => {
  const search = new FixtureSearchProvider({ "northwind not largest battery maker": [{ title: "X", url: "https://x.example/s", snippet: "s" }] });
  const fetcher = new FixturePageFetcher({ "https://x.example/s": { title: "X", text: "Northwind is a company that makes batteries." } });
  const model = new MockModelProvider({ skeptic_assess: [{ relevant: false, stance: "none", excerpt: "", relevance: "weak", reasoning: "no counter" }] });
  const r = await skepticResearch({ claim, plan, search, fetcher, model });
  expect(r.evidence).toHaveLength(0);
  expect(r.rejected.length).toBeGreaterThan(0);
});

test("rejects a contradicting excerpt that is not verbatim", async () => {
  const search = new FixtureSearchProvider({ "northwind not largest battery maker": [{ title: "X", url: "https://x.example/s", snippet: "s" }] });
  const fetcher = new FixturePageFetcher({ "https://x.example/s": { title: "X", text: "Northwind sells batteries in several regions." } });
  const model = new MockModelProvider({ skeptic_assess: [{ relevant: true, stance: "contradicts", excerpt: "a competitor is clearly the largest maker now", relevance: "strong", reasoning: "made up" }] });
  const r = await skepticResearch({ claim, plan, search, fetcher, model });
  expect(r.evidence).toHaveLength(0);
  expect(r.rejected.some((x) => x.reason.match(/verbatim|not found/i))).toBe(true);
});
