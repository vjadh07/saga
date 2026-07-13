import { expect, test } from "vitest";
import {
  extractQuotes,
  hashId,
  jaccard,
  normalizeText,
  sha256hex,
  shingles,
  tokens,
} from "../src/verify/text.js";

test("normalizeText lowercases, strips punctuation, collapses whitespace", () => {
  expect(normalizeText("  The   Model's  score: 92%!! ")).toBe("the models score 92");
});

test("tokens returns normalized word array, splitting on punctuation", () => {
  expect(tokens("GDP grew by 3.1 percent.")).toEqual(["gdp", "grew", "by", "3", "1", "percent"]);
});

test("shingles produces k-word sets and identical text scores jaccard 1", () => {
  const a = shingles("the quick brown fox jumps", 3);
  const b = shingles("the quick brown fox jumps", 3);
  expect(jaccard(a, b)).toBe(1);
});

test("jaccard of disjoint shingle sets is 0", () => {
  const a = shingles("alpha beta gamma delta", 3);
  const b = shingles("one two three four", 3);
  expect(jaccard(a, b)).toBe(0);
});

test("near-duplicate paragraphs score high jaccard", () => {
  const release = "The startup announced record quarterly revenue of forty million dollars today";
  const syndicated = "The startup announced record quarterly revenue of forty million dollars this morning";
  const score = jaccard(shingles(release, 3), shingles(syndicated, 3));
  expect(score).toBeGreaterThan(0.6);
});

test("extractQuotes pulls verbatim quotations, both straight and curly, ignoring tiny ones", () => {
  const text = 'The CEO said "we tripled our user base in a single quarter" during the call. He added “no regrets”.';
  expect(extractQuotes(text)).toEqual(["we tripled our user base in a single quarter"]);
});

test("hashId is deterministic and prefixed", () => {
  const a = hashId("claim", "the sky is blue");
  const b = hashId("claim", "the sky is blue");
  expect(a).toBe(b);
  expect(a.startsWith("claim_")).toBe(true);
  expect(hashId("claim", "different")).not.toBe(a);
});

test("sha256hex is stable", () => {
  expect(sha256hex("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
