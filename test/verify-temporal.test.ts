import { expect, test } from "vitest";
import { assessTemporal, temporalScope } from "../src/verify/temporal.js";
import type { Claim } from "../src/verify/types.js";

const NOW = "2026-07-10T00:00:00.000Z";
function claim(p: Partial<Claim>): Claim {
  return {
    id: "c", originalText: "x", normalized: "x", claimType: "general",
    location: { start: 0, end: 1 }, verifiable: true, timeSensitive: false, risk: "medium", status: "contracted", asOf: null, ...p,
  };
}

test("temporalScope classifies claims by their own dating, never inferring one", () => {
  expect(temporalScope(claim({ asOf: "2021-01-01T00:00:00.000Z" }))).toBe("historical");
  expect(temporalScope(claim({ timeSensitive: true }))).toBe("current");
  expect(temporalScope(claim({ claimType: "prediction" }))).toBe("prediction");
  expect(temporalScope(claim({}))).toBe("undated");
});

test("a current claim with newer contradicting evidence is superseded", () => {
  const t = assessTemporal({ scope: "current", asOf: null, supporting: ["2024-01-01T00:00:00.000Z"], contradicting: ["2026-06-20T00:00:00.000Z"], now: NOW });
  expect(t.superseded).toBe(true);
  expect(t.note).toMatch(/no longer current/i);
});

test("an explicitly historical claim is NOT superseded by later changes", () => {
  const t = assessTemporal({ scope: "historical", asOf: "2021-01-01T00:00:00.000Z", supporting: ["2021-06-01T00:00:00.000Z"], contradicting: ["2026-06-20T00:00:00.000Z"], now: NOW });
  expect(t.superseded).toBe(false);
  expect(t.note).toMatch(/historical|scoped/i);
});

test("a prediction is not evaluated as outdated", () => {
  const t = assessTemporal({ scope: "prediction", asOf: null, supporting: [], contradicting: ["2026-06-20T00:00:00.000Z"], now: NOW });
  expect(t.superseded).toBe(false);
  expect(t.note).toMatch(/prediction/i);
});

test("an undated timeless claim is not superseded", () => {
  const t = assessTemporal({ scope: "undated", asOf: null, supporting: ["2024-01-01T00:00:00.000Z"], contradicting: ["2026-06-20T00:00:00.000Z"], now: NOW });
  expect(t.superseded).toBe(false);
});

test("newer support than the contradiction is not superseded even for a current claim", () => {
  const t = assessTemporal({ scope: "current", asOf: null, supporting: ["2026-06-25T00:00:00.000Z"], contradicting: ["2026-01-01T00:00:00.000Z"], now: NOW });
  expect(t.superseded).toBe(false);
});
