import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { assertNoFixtureLabels, DEMO_BADGE, isDemo, isLive } from "../src/verify/mode.js";
import { runAudit } from "../src/verify/pipeline.js";
import { DEMO_CLAIMS, DEMO_CORPUS, DEMO_DOCUMENT, DEMO_NOW } from "../src/verify/fixtures/demo.js";

test("mode predicates and the demo badge", () => {
  expect(isDemo("demo")).toBe(true);
  expect(isDemo("live")).toBe(false);
  expect(isLive("live")).toBe(true);
  expect(DEMO_BADGE).toMatch(/demo/i);
});

test("assertNoFixtureLabels rejects fixture-labeled evidence in live mode", () => {
  expect(() => assertNoFixtureLabels([{ url: "https://example.com", content: "x" }])).not.toThrow();
  expect(() => assertNoFixtureLabels([{ stance: "supports" }])).toThrow(/fixture-labeled/i);
  expect(() => assertNoFixtureLabels([{ relatesTo: ["c1"] }])).toThrow(/fixture-labeled/i);
  expect(() => assertNoFixtureLabels([{ relevance: "strong" }])).toThrow(/fixture-labeled/i);
});

test("fixture-backed runAudit is explicitly demo-only", () => {
  const demo = runAudit({ auditId: "a", document: DEMO_DOCUMENT, claims: DEMO_CLAIMS, corpus: DEMO_CORPUS, now: DEMO_NOW, mode: "demo" });
  expect(demo.mode).toBe("demo");
  const mislabeled = {
    auditId: "a",
    document: DEMO_DOCUMENT,
    claims: DEMO_CLAIMS,
    corpus: DEMO_CORPUS,
    now: DEMO_NOW,
    mode: "live",
  } as unknown as Parameters<typeof runAudit>[0];
  expect(() => runAudit(mislabeled)).toThrow(/demo-only/i);
});

test("the live audit module graph cannot reach fixture modules or fixture symbols", () => {
  const verifyRoot = fileURLToPath(new URL("../src/verify/", import.meta.url));
  const pending = [
    resolve(verifyRoot, "live/audit.ts"),
    resolve(verifyRoot, "live/composition.ts"),
    resolve(verifyRoot, "live/service.ts"),
  ];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    const imports = source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)(["'])(\.[^"']+)\1/g);
    for (const match of imports) {
      const specifier = match[2]!;
      const requested = resolve(dirname(file), specifier);
      const target = requested.endsWith(".js") ? `${requested.slice(0, -3)}.ts` : requested;
      if (target.startsWith(verifyRoot)) pending.push(target);
    }
  }

  const modules = [...visited].map((file) => relative(verifyRoot, file));
  const forbidden = modules.filter((file) =>
    file === "corpus.ts" || file === "pipeline.ts" || file === "bench.ts" || file.startsWith("fixtures/"));
  expect(forbidden).toEqual([]);
  const liveSourceGraph = [...visited]
    .map((file) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))
    .join("\n");
  expect(liveSourceGraph).not.toMatch(/\b(?:CorpusEntry|DEMO_CORPUS|DEMO_CLAIMS|DEMO_DOCUMENT|DEMO_NOW)\b/);
});
