import { expect, test } from "vitest";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { FixtureSearchProvider } from "../src/verify/providers/search.js";
import { FixturePageFetcher } from "../src/verify/providers/fetch.js";
import { investigateClaim } from "../src/verify/research/investigator.js";
import type { ResearchPlan } from "../src/verify/research/plan.js";
import type { Claim } from "../src/verify/types.js";

const claim: Claim = {
  id: "c1",
  originalText: "Solar capacity rose 12 percent in 2025.",
  normalized: "solar capacity rose 12 percent in 2025",
  claimType: "numeric",
  location: { start: 0, end: 10 },
  verifiable: true,
  timeSensitive: false,
  risk: "medium",
  status: "contracted",
  asOf: null,
};
function plan(p: Partial<ResearchPlan> = {}): ResearchPlan {
  return {
    claimId: "c1",
    supportingQueries: ["solar capacity 2025 growth"],
    skepticQueries: ["solar capacity 2025 overstated"],
    preferredSourceTypes: ["primary", "gov"],
    primaryRequired: false,
    minimumIndependentOrigins: 2,
    maximumIterations: 1,
    maximumSources: 8,
    stopWhen: ["done"],
    abstainWhen: ["nothing"],
    ...p,
  };
}

test("accepts supporting evidence only when the excerpt is verbatim in the sanitized page", async () => {
  const search = new FixtureSearchProvider({
    "solar capacity 2025 growth": [
      { title: "Agency", url: "https://gov.example/s", snippet: "s", publisher: "Agency" },
      { title: "Blog", url: "https://blog.example/s", snippet: "s" },
    ],
  });
  const fetcher = new FixturePageFetcher({
    "https://gov.example/s": { title: "Agency", text: "Official data show solar capacity rose 12 percent in 2025 nationwide." },
    "https://blog.example/s": { title: "Blog", text: "Some unrelated musings about the weather this spring." },
  });
  const model = new MockModelProvider({
    investigator_assess: [
      { relevant: true, supports: true, excerpt: "solar capacity rose 12 percent in 2025", relevance: "strong", reasoning: "states the figure" },
      { relevant: false, supports: false, excerpt: "", relevance: "weak", reasoning: "off topic" },
    ],
  });

  const r = await investigateClaim({ claim, plan: plan(), search, fetcher, model });
  expect(r.evidence).toHaveLength(1);
  expect(r.evidence[0]!.stance).toBe("supports");
  expect(r.evidence[0]!.capturedBy).toBe("investigator");
  expect(r.rejected.some((x) => x.reason.match(/not relevant/i))).toBe(true);
  expect(r.sourcesExamined).toHaveLength(2);
});

test("rejects a hallucinated excerpt that does not appear in the source", async () => {
  const search = new FixtureSearchProvider({ "solar capacity 2025 growth": [{ title: "Agency", url: "https://gov.example/s", snippet: "s" }] });
  const fetcher = new FixturePageFetcher({ "https://gov.example/s": { title: "Agency", text: "The agency published a report on energy." } });
  const model = new MockModelProvider({
    investigator_assess: [{ relevant: true, supports: true, excerpt: "solar capacity rose exactly 12 percent in 2025", relevance: "strong", reasoning: "fabricated" }],
  });
  const r = await investigateClaim({ claim, plan: plan({ maximumIterations: 1 }), search, fetcher, model });
  expect(r.evidence).toHaveLength(0);
  expect(r.rejected.some((x) => x.reason.match(/not found|verbatim|hallucin/i))).toBe(true);
});

test("does not use any fixture stance label to decide support", async () => {
  // the source carries no stance; the model must decide. If the model says irrelevant,
  // no evidence is produced even though the text mentions the topic.
  const search = new FixtureSearchProvider({ "solar capacity 2025 growth": [{ title: "News", url: "https://news.example/s", snippet: "s" }] });
  const fetcher = new FixturePageFetcher({ "https://news.example/s": { title: "News", text: "solar capacity rose 12 percent in 2025" } });
  const model = new MockModelProvider({
    investigator_assess: [{ relevant: false, supports: false, excerpt: "", relevance: "weak", reasoning: "different region" }],
  });
  const r = await investigateClaim({ claim, plan: plan({ maximumIterations: 1 }), search, fetcher, model });
  expect(r.evidence).toHaveLength(0);
});
