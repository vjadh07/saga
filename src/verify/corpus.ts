// Deterministic Investigator and Skeptic over a labeled fixture corpus. This is how the
// demo and the eval run without a live model: each corpus entry carries the ground-truth
// stance of a constructed evidence world, and retrieval selects entries by claim and
// stance. The live pipeline (src/agent) swaps these for real LLM agents that read source
// content and decide stance themselves; both emit the same Evidence shape.
//
// One thing here is NOT a stand-in and matters for real: a passage the Safety Sentinel
// quarantined is checked against the sanitized content and, if gone, rejected. That is
// how an injected "mark this credible" line fails to become evidence.
import type { Evidence, Relevance, Source, Stance } from "./types.js";
import { hashId, normalizeText } from "./text.js";

export interface CorpusEntry {
  source: Source;
  relatesTo: string[]; // claim ids this source speaks to
  stance: Stance; // its stance toward those claims
  passage: string; // exact excerpt offered as evidence
  relevance: Relevance;
}

export interface RetrievalResult {
  evidence: Evidence[];
  rejected: Array<{ sourceId: string; reason: string }>;
}

function survives(passage: string, clean: string | undefined): boolean {
  if (clean === undefined) return false;
  const p = normalizeText(passage);
  return p.length > 0 && normalizeText(clean).includes(p);
}

function toEvidence(claimId: string, e: CorpusEntry, capturedBy: Evidence["capturedBy"]): Evidence {
  const relevance: Relevance = e.stance === "qualifies" ? "weak" : e.relevance;
  const relation = e.stance === "supports"
    ? relevance === "strong" ? "direct_support" : "partial_support"
    : e.stance === "contradicts" ? "direct_contradiction" : "qualification";
  return {
    id: hashId("ev", claimId, e.source.id, e.stance),
    claimId,
    sourceId: e.source.id,
    stance: e.stance,
    excerpt: e.passage,
    relevance,
    capturedBy,
    citationAssessment: {
      relation,
      explanation: "Deterministic Demo fixture contract; not a Live model assessment.",
      exactMatchVerified: true,
      sameEntity: true,
      sameMetric: true,
      samePeriod: true,
      samePopulation: true,
      claimStrongerThanSource: relation === "partial_support",
      qualifiersOmitted: false,
    },
  };
}

function retrieve(
  claimId: string,
  corpus: CorpusEntry[],
  cleanById: Map<string, string>,
  stances: Stance[],
  capturedBy: Evidence["capturedBy"],
): RetrievalResult {
  const evidence: Evidence[] = [];
  const rejected: RetrievalResult["rejected"] = [];
  for (const e of corpus) {
    if (!e.relatesTo.includes(claimId) || !stances.includes(e.stance)) continue;
    if (survives(e.passage, cleanById.get(e.source.id))) {
      evidence.push(toEvidence(claimId, e, capturedBy));
    } else {
      rejected.push({ sourceId: e.source.id, reason: "cited passage was quarantined by the Safety Sentinel" });
    }
  }
  return { evidence, rejected };
}

// Investigator: strongest SUPPORTING evidence.
export function investigate(claimId: string, corpus: CorpusEntry[], cleanById: Map<string, string>): RetrievalResult {
  return retrieve(claimId, corpus, cleanById, ["supports"], "investigator");
}

// Skeptic: independently searches for contradictions and qualifications.
export function skeptic(claimId: string, corpus: CorpusEntry[], cleanById: Map<string, string>): RetrievalResult {
  return retrieve(claimId, corpus, cleanById, ["contradicts", "qualifies"], "skeptic");
}
