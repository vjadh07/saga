import type { Evidence, Source } from "./types.js";

// Sources cited by a set of validated evidence, in stable order. This helper is neutral
// across execution modes and does not depend on the labeled corpus used by Demo mode.
export function citedSources(evidence: Evidence[], byId: Map<string, Source>): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const item of evidence) {
    if (seen.has(item.sourceId)) continue;
    const source = byId.get(item.sourceId);
    if (source) {
      seen.add(item.sourceId);
      out.push(source);
    }
  }
  return out;
}
