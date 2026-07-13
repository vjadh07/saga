import { expect, test } from "vitest";
import { assessTemporal } from "../src/verify/temporal.js";

const NOW = "2026-07-10T00:00:00.000Z";

test("support with no newer contradiction is not superseded", () => {
  const t = assessTemporal({
    asOf: null,
    supporting: ["2026-05-01T00:00:00.000Z"],
    contradicting: [],
    now: NOW,
  });
  expect(t.superseded).toBe(false);
  expect(t.latestEvidenceAt).toBe("2026-05-01T00:00:00.000Z");
  expect(t.note).toMatch(/no newer evidence/i);
});

test("older support plus newer contradiction is superseded and reads as outdated", () => {
  const t = assessTemporal({
    asOf: "2024-01-01T00:00:00.000Z",
    supporting: ["2024-01-15T00:00:00.000Z"],
    contradicting: ["2026-06-20T00:00:00.000Z"],
    now: NOW,
  });
  expect(t.superseded).toBe(true);
  expect(t.claimAsOf).toBe("2024-01-01T00:00:00.000Z");
  expect(t.latestEvidenceAt).toBe("2026-06-20T00:00:00.000Z");
  expect(t.note).toMatch(/historically accurate/i);
  expect(t.note).toMatch(/outdated as of June 2026/);
});

test("contradiction with no supporting evidence is not classified as outdated", () => {
  const t = assessTemporal({
    asOf: null,
    supporting: [],
    contradicting: ["2026-06-20T00:00:00.000Z"],
    now: NOW,
  });
  expect(t.superseded).toBe(false);
});

test("newer support than the contradiction is not superseded", () => {
  const t = assessTemporal({
    asOf: null,
    supporting: ["2026-06-25T00:00:00.000Z"],
    contradicting: ["2026-01-01T00:00:00.000Z"],
    now: NOW,
  });
  expect(t.superseded).toBe(false);
});
