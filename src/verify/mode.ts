// Execution mode: the hard seam between Live and Demo. Demo mode is deterministic and may
// use fixtures; it must always be visibly labeled. Live mode accepts arbitrary text and
// must discover all evidence independently. Live mode must never receive fixture
// ground-truth (stance, relatesTo, relevance) and must never silently fall back to the
// demo corpus.
export const EXECUTION_MODES = ["live", "demo"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const DEMO_BADGE = "Demo mode";

export function isDemo(m: ExecutionMode): boolean {
  return m === "demo";
}
export function isLive(m: ExecutionMode): boolean {
  return m === "live";
}

// Guards the live path: any object carrying a hand-labeled stance, relatesTo, or relevance
// is a fixture CorpusEntry and must never reach live retrieval or reasoning.
export function assertNoFixtureLabels(sources: unknown[], context = "live audit"): void {
  for (const s of sources) {
    if (s && typeof s === "object" && ("stance" in s || "relatesTo" in s || "relevance" in s)) {
      throw new Error(
        `${context} received fixture-labeled evidence; live mode must discover stance and relevance independently`,
      );
    }
  }
}
