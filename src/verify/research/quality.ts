// Source-quality assessment, per claim. There is no universal list of trusted domains: the
// model judges concrete, structured factors from the source itself (type, directness,
// independence, methodology visibility, whether it is promotional). Deterministic code then
// decides admissibility. A company marketing page can testify to what the company claims but
// is not admitted as proof of a factual claim on its own. The output resolves the source's
// type, which retrieval left as "unknown".
import { z } from "zod";
import { SOURCE_TYPES, type Claim, type Source, type SourceQualityAssessment } from "../types.js";
import type { ModelProvider } from "../providers/model.js";

const QualitySchema = z.object({
  sourceType: z.enum(SOURCE_TYPES),
  directness: z.enum(["direct", "indirect", "contextual"]),
  independence: z.enum(["independent", "derived", "unknown"]),
  methodologyVisible: z.boolean().nullable(),
  promotional: z.boolean(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
});

const PROMPT = `You are the Source-Quality analyst for Saga. Given a claim and one source, judge the source on concrete factors, using the source content, not its domain name or reputation:
- sourceType: primary, press_release, news, blog, encyclopedia, academic, gov, or unknown.
- directness: direct (first-hand evidence of the claim), indirect (reports someone else's evidence), or contextual (background only).
- independence: independent, derived (repackages another source), or unknown.
- methodologyVisible: true if it shows how it knows, false if not, null if not applicable.
- promotional: true if it is marketing or self-promotion for the subject of the claim.
- strengths and weaknesses: short concrete phrases.
Do not output a numeric score.`;

export async function assessSourceQuality(input: { claim: Claim; source: Source; model: ModelProvider }): Promise<SourceQualityAssessment> {
  const { claim, source, model } = input;
  const f = await model.generateStructured({
    purpose: "source_quality",
    system: PROMPT,
    prompt: `Claim: "${claim.originalText}"\n\nSource: ${source.title} (${source.publisher})\n\nContent:\n${source.content}`,
    schema: QualitySchema,
  });

  // deterministic admissibility: a purely promotional, contextual page is not proof of a
  // factual claim on its own
  let accepted = true;
  let rejectionReason: string | null = null;
  if (f.promotional && f.directness === "contextual") {
    accepted = false;
    rejectionReason = "promotional page with only contextual relevance; not admissible as proof on its own";
  }

  return {
    sourceId: source.id,
    sourceType: f.sourceType,
    directness: f.directness,
    independence: f.independence,
    methodologyVisible: f.methodologyVisible,
    promotional: f.promotional,
    strengths: f.strengths,
    weaknesses: f.weaknesses,
    accepted,
    rejectionReason,
  };
}
