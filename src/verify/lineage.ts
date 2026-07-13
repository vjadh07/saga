// Source-lineage detection: the marquee capability. Many articles can trace to one
// press release, study, or report. This connects sources by concrete, deterministic
// signals and reports how many INDEPENDENT evidence origins actually exist behind an
// apparent crowd of sources. No LLM: only text similarity and metadata.
import type { LineageGroup, LineageReport, LineageSignal, Source } from "./types.js";
import { hashId, jaccard, normalizeText, shingles } from "./text.js";

// Body-text similarity at or above this Jaccard counts as near-duplicate.
const NEAR_DUP = 0.5;
// Near-duplicates published within this window look like syndication of one release.
const SYNDICATION_HOURS = 48;

interface Edge {
  signals: Set<LineageSignal>;
}

function hoursApart(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 3_600_000;
}

// Which lineage signals connect two sources, if any.
function edgeSignals(a: Source, b: Source, shA: Set<string>, shB: Set<string>): Set<LineageSignal> {
  const signals = new Set<LineageSignal>();

  const sim = jaccard(shA, shB);
  if (sim >= NEAR_DUP) {
    signals.add("near_duplicate_text");
    if (hoursApart(a.publishedAt, b.publishedAt) <= SYNDICATION_HOURS) {
      signals.add("syndication_window");
    }
  }

  const qA = new Set(a.quotes.map(normalizeText).filter((q) => q.length > 0));
  for (const q of b.quotes) {
    if (qA.has(normalizeText(q))) {
      signals.add("shared_verbatim_quote");
      break;
    }
  }

  if (a.canonicalUrl && b.canonicalUrl && a.canonicalUrl === b.canonicalUrl) {
    signals.add("shared_canonical_url");
  }

  const citesA = new Set(a.outboundCitations);
  if (a.outboundCitations.length > 0 && b.outboundCitations.some((c) => citesA.has(c))) {
    signals.add("shared_primary_source");
  }

  return signals;
}

// The origin of a group: prefer a press release or primary source, then the earliest
// publication. Deterministic tie-break on id.
function pickRepresentative(members: Source[]): Source {
  const rank = (s: Source): number =>
    s.sourceType === "press_release" ? 0 : s.sourceType === "primary" ? 1 : 2;
  return [...members].sort((x, y) => {
    if (rank(x) !== rank(y)) return rank(x) - rank(y);
    if (x.publishedAt !== y.publishedAt) return x.publishedAt < y.publishedAt ? -1 : 1;
    return x.id < y.id ? -1 : 1;
  })[0]!;
}

export function detectLineage(sources: Source[]): LineageReport {
  const parent = sources.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (i: number, j: number): void => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
  };

  // precompute shingles once per source
  const sh = sources.map((s) => shingles(s.content, 3));
  const edges = new Map<string, Edge>();

  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const signals = edgeSignals(sources[i]!, sources[j]!, sh[i]!, sh[j]!);
      if (signals.size > 0) {
        edges.set(`${i}:${j}`, { signals });
        union(i, j);
      }
    }
  }

  // gather connected components
  const components = new Map<number, number[]>();
  for (let i = 0; i < sources.length; i++) {
    const root = find(i);
    (components.get(root) ?? components.set(root, []).get(root)!).push(i);
  }

  const groups: LineageGroup[] = [];
  for (const memberIdx of components.values()) {
    if (memberIdx.length < 2) continue;
    const members = memberIdx.map((i) => sources[i]!);
    const signals = new Set<LineageSignal>();
    for (let a = 0; a < memberIdx.length; a++) {
      for (let b = a + 1; b < memberIdx.length; b++) {
        const key = `${Math.min(memberIdx[a]!, memberIdx[b]!)}:${Math.max(memberIdx[a]!, memberIdx[b]!)}`;
        const e = edges.get(key);
        if (e) for (const s of e.signals) signals.add(s);
      }
    }
    const rep = pickRepresentative(members);
    const sourceIds = members.map((m) => m.id).sort();
    groups.push({
      id: hashId("lineage", ...sourceIds),
      sourceIds,
      signals: [...signals],
      originLabel: `${rep.sourceType.replace(/_/g, " ")}: ${rep.title}`,
      representativeSourceId: rep.id,
    });
  }
  // stable order: biggest groups first, then by id
  groups.sort((a, b) => b.sourceIds.length - a.sourceIds.length || (a.id < b.id ? -1 : 1));

  // one origin per connected component (groups of >=2 collapse to one; singletons each count)
  const independentOrigins = components.size;
  return { sourceCount: sources.length, independentOrigins, groups };
}
