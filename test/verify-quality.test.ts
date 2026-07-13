import { expect, test } from "vitest";
import { MockModelProvider } from "../src/verify/providers/model.js";
import { assessSourceQuality } from "../src/verify/research/quality.js";
import type { Claim, Source } from "../src/verify/types.js";

const claim: Claim = {
  id: "c1", originalText: "Northwind shipped 50,000 units in 2025.", normalized: "x", claimType: "numeric",
  location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "high", status: "contracted", asOf: null,
};
function src(id: string): Source {
  return { id, url: `https://e/${id}`, canonicalUrl: null, title: id, publisher: id, publishedAt: "2026-02-01T00:00:00.000Z", sourceType: "unknown", content: "text", quotes: [], outboundCitations: [] };
}

test("assesses a primary independent source as accepted and sets its resolved type", async () => {
  const model = new MockModelProvider({
    source_quality: [{ sourceType: "primary", directness: "direct", independence: "independent", methodologyVisible: true, promotional: false, strengths: ["official filing"], weaknesses: [] }],
  });
  const q = await assessSourceQuality({ claim, source: src("s1"), model });
  expect(q.accepted).toBe(true);
  expect(q.sourceType).toBe("primary");
  expect(q.rejectionReason).toBeNull();
});

test("rejects a purely promotional contextual page as proof of a factual claim", async () => {
  const model = new MockModelProvider({
    source_quality: [{ sourceType: "press_release", directness: "contextual", independence: "derived", methodologyVisible: null, promotional: true, strengths: [], weaknesses: ["marketing copy"] }],
  });
  const q = await assessSourceQuality({ claim, source: src("s1"), model });
  expect(q.accepted).toBe(false);
  expect(q.rejectionReason).toMatch(/promotional|marketing/i);
});

test("returns structured factors, not a single credibility number", async () => {
  const model = new MockModelProvider({
    source_quality: [{ sourceType: "news", directness: "indirect", independence: "independent", methodologyVisible: false, promotional: false, strengths: ["named author"], weaknesses: ["secondary reporting"] }],
  });
  const q = await assessSourceQuality({ claim, source: src("s1"), model });
  expect(q).not.toHaveProperty("score");
  expect(q.directness).toBe("indirect");
  expect(q.independence).toBe("independent");
  expect(q.strengths).toContain("named author");
});
