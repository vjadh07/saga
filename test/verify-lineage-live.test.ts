import { expect, test } from "vitest";
import { LivePageFetcher } from "../src/verify/net/fetcher.js";
import { FixtureSearchProvider } from "../src/verify/providers/search.js";
import { FixturePageFetcher } from "../src/verify/providers/fetch.js";
import { retrieveSources } from "../src/verify/research/retrieve.js";
import { detectLineage } from "../src/verify/lineage.js";

test("the fetcher extracts outbound http links", async () => {
  const f = new LivePageFetcher({
    transport: async () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: `<html><body><p>See the <a href="https://journal.example/paper-42">study</a> and <a href="/relative">this</a>.</p></body></html>`,
    }),
  });
  const page = await f.fetch("https://news.example/x");
  expect(page.links).toContain("https://journal.example/paper-42");
  expect(page.links).not.toContain("/relative");
});

test("real retrieved sources are grouped by a shared outbound citation", async () => {
  const search = new FixtureSearchProvider({
    q: [
      { title: "Outlet A", url: "https://a.example/story", snippet: "s" },
      { title: "Outlet B", url: "https://b.example/story", snippet: "s" },
    ],
  });
  const study = "https://journal.example/paper-42";
  const fetcher = new FixturePageFetcher({
    "https://a.example/story": { title: "Outlet A", text: "Outlet A's own framing of the findings.", links: [study] },
    "https://b.example/story": { title: "Outlet B", text: "Outlet B describes the results differently.", links: [study] },
  });

  const { sources } = await retrieveSources({ queries: ["q"], search, fetcher, maxSources: 10 });
  expect(sources[0]!.source.outboundCitations).toContain(study);
  const lineage = detectLineage(sources.map((s) => s.source));
  expect(lineage.independentOrigins).toBe(1);
  expect(lineage.groups[0]!.signals).toContain("shared_primary_source");
});
