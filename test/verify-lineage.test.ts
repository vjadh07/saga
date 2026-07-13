import { expect, test } from "vitest";
import type { Source, SourceType } from "../src/verify/types.js";
import { detectLineage } from "../src/verify/lineage.js";

let n = 0;
function src(p: Partial<Source> & { id: string }): Source {
  n++;
  return {
    id: p.id,
    url: p.url ?? `https://example${n}.com/a`,
    canonicalUrl: p.canonicalUrl ?? null,
    title: p.title ?? `Article ${p.id}`,
    publisher: p.publisher ?? `Publisher ${p.id}`,
    publishedAt: p.publishedAt ?? "2026-06-01T00:00:00.000Z",
    sourceType: (p.sourceType ?? "news") as SourceType,
    content: p.content ?? "",
    quotes: p.quotes ?? [],
    outboundCitations: p.outboundCitations ?? [],
  };
}

test("unrelated sources form no groups and each is its own origin", () => {
  const sources = [
    src({ id: "a", content: "solar capacity in germany rose sharply last year across the north" }),
    src({ id: "b", content: "the central bank held interest rates steady through the summer months" }),
    src({ id: "c", content: "a new species of frog was found in the highland rainforest reserve" }),
  ];
  const r = detectLineage(sources);
  expect(r.sourceCount).toBe(3);
  expect(r.independentOrigins).toBe(3);
  expect(r.groups).toHaveLength(0);
});

test("near-duplicate articles are grouped and counted as one origin", () => {
  const body = "the company reported record quarterly revenue of forty million dollars and said it would double its workforce by the end of the year";
  const sources = [
    src({ id: "wire", sourceType: "press_release", title: "Company posts record revenue", content: body, publishedAt: "2026-06-10T09:00:00.000Z" }),
    src({ id: "n1", title: "Firm sees record revenue", content: "In a statement, " + body, publishedAt: "2026-06-10T11:00:00.000Z" }),
    src({ id: "n2", title: "Record quarter", content: body + " Analysts welcomed the news.", publishedAt: "2026-06-11T08:00:00.000Z" }),
  ];
  const r = detectLineage(sources);
  expect(r.sourceCount).toBe(3);
  expect(r.independentOrigins).toBe(1);
  expect(r.groups).toHaveLength(1);
  expect(r.groups[0]!.sourceIds.sort()).toEqual(["n1", "n2", "wire"]);
  // the origin (press release, earliest) represents the group
  expect(r.groups[0]!.representativeSourceId).toBe("wire");
  expect(r.groups[0]!.signals).toContain("near_duplicate_text");
  expect(r.groups[0]!.signals).toContain("syndication_window");
});

test("a shared verbatim quote groups otherwise differently worded articles", () => {
  const quote = "we will triple our manufacturing output within eighteen months";
  const sources = [
    src({ id: "x", content: `The founder told reporters, "${quote}" at the launch event downtown.`, quotes: [quote] }),
    src({ id: "y", content: `Executives reaffirmed the target. "${quote}" a spokesperson repeated.`, quotes: [quote] }),
  ];
  const r = detectLineage(sources);
  expect(r.independentOrigins).toBe(1);
  expect(r.groups[0]!.signals).toContain("shared_verbatim_quote");
});

test("a shared canonical url groups syndicated copies", () => {
  const sources = [
    src({ id: "p", canonicalUrl: "https://origin.example/story", content: "one two three four five six" }),
    src({ id: "q", canonicalUrl: "https://origin.example/story", content: "totally different words here entirely" }),
  ];
  const r = detectLineage(sources);
  expect(r.independentOrigins).toBe(1);
  expect(r.groups[0]!.signals).toContain("shared_canonical_url");
});

test("a common outbound citation groups articles as one evidence origin", () => {
  const sources = [
    src({ id: "j", content: "coverage of the study with unique framing about the results", outboundCitations: ["https://journal.example/paper-42"] }),
    src({ id: "k", content: "separate coverage using its own words to describe findings", outboundCitations: ["https://journal.example/paper-42"] }),
  ];
  const r = detectLineage(sources);
  expect(r.independentOrigins).toBe(1);
  expect(r.groups[0]!.signals).toContain("shared_primary_source");
});

test("seven sources, five from one release, resolve to three independent origins", () => {
  const body = "the ministry said the new subsidy would cut household energy bills by thirty percent starting in august across all regions";
  const release = (id: string, hour: number): Source =>
    src({ id, sourceType: id === "rel" ? "press_release" : "news", content: body + ` filed by ${id}`, publishedAt: `2026-06-15T0${hour}:00:00.000Z` });
  const sources = [
    release("rel", 6),
    release("c1", 7),
    release("c2", 8),
    release("c3", 9),
    release("c4", 9),
    src({ id: "indieA", content: "an unrelated investigation into water quality in coastal towns this spring" }),
    src({ id: "indieB", content: "a feature on the history of the national rail network and its founders" }),
  ];
  const r = detectLineage(sources);
  expect(r.sourceCount).toBe(7);
  expect(r.independentOrigins).toBe(3);
  const big = r.groups.find((g) => g.sourceIds.length === 5);
  expect(big).toBeDefined();
  expect(big!.representativeSourceId).toBe("rel");
});
