// Deterministic model used only by the small mock evaluation. It has no case scripts or
// expected outcomes. Each response is derived from the claim, excerpt, or page text in the
// request after the evaluation runner has received the input.
import type { ModelProvider, StructuredModelRequest } from "../providers/model.js";

export interface EvaluationQueries {
  supporting: string;
  skeptic: string;
}

export function evaluationQueriesForClaim(claim: string): EvaluationQueries {
  return {
    supporting: `evidence ${claim}`,
    skeptic: `challenge ${claim}`,
  };
}

export class TextDerivedEvaluationModelProvider implements ModelProvider {
  readonly id = "deterministic-text-evaluation";

  async generateStructured<T>(request: StructuredModelRequest<T>): Promise<T> {
    let response: unknown;
    switch (request.purpose) {
      case "research_plan":
        response = researchPlan(request.prompt);
        break;
      case "investigator_assess":
        response = investigatorAssessment(request.prompt);
        break;
      case "skeptic_assess":
        response = skepticAssessment(request.prompt);
        break;
      case "source_quality":
        response = sourceQuality(request.prompt);
        break;
      case "citation_assessment":
        response = citationAssessment(request.prompt);
        break;
      case "numeric_extract":
        response = numericRelation(request.prompt);
        break;
      case "revision":
        response = revision(request.prompt);
        break;
      default:
        throw new Error(`evaluation text model does not implement ${request.purpose}`);
    }
    return request.schema.parse(response);
  }
}

function researchPlan(prompt: string): unknown {
  const claim = quotedValue(prompt, "Claim");
  const queries = evaluationQueriesForClaim(claim);
  return { supportingQueries: [queries.supporting], skepticQueries: [queries.skeptic] };
}

function investigatorAssessment(prompt: string): unknown {
  const claim = quotedValue(prompt, "Claim");
  const content = sectionAfter(prompt, "Sanitized text:");
  const excerpt = firstLine(content);
  const overlap = tokenOverlap(claim, excerpt);
  const relevant = overlap >= 0.5;
  const supports = relevant && !hasNegation(excerpt);
  return {
    relevant,
    supports,
    excerpt: supports ? excerpt : "",
    relevance: normalized(excerpt).includes(normalized(claim)) ? "strong" : "weak",
    reasoning: supports ? "The page text addresses the submitted claim." : "The page text does not establish the submitted claim.",
  };
}

function skepticAssessment(prompt: string): unknown {
  const claim = quotedValue(prompt, "Claim");
  const content = sectionAfter(prompt, "Sanitized text:");
  const excerpt = firstLine(content);
  const relevant = tokenOverlap(claim, excerpt) >= 0.5;
  const contradicts = relevant && hasNegation(excerpt);
  return {
    relevant,
    stance: contradicts ? "contradicts" : "none",
    excerpt: contradicts ? excerpt : "",
    relevance: contradicts ? "strong" : "weak",
    reasoning: contradicts ? "The page text explicitly negates the submitted claim." : "The page text supplies no counterevidence.",
  };
}

function sourceQuality(prompt: string): unknown {
  const source = lineValue(prompt, "Source").toLocaleLowerCase("en-US");
  const content = sectionAfter(prompt, "Content:").toLocaleLowerCase("en-US");
  const filing = /\b(?:audited|filing|official record|dataset)\b/.test(`${source} ${content}`);
  const news = /\b(?:news|journal|newspaper|report)\b/.test(source);
  return {
    sourceType: filing ? "primary" : news ? "news" : "unknown",
    directness: "direct",
    independence: "independent",
    methodologyVisible: filing ? true : null,
    promotional: false,
    strengths: [filing ? "contains a first-party record" : "states the relevant event directly"],
    weaknesses: [],
  };
}

function citationAssessment(prompt: string): unknown {
  const claim = quotedValue(prompt, "Claim");
  const excerpt = quotedValue(prompt, "Excerpt");
  const claimNumbers = numbers(claim);
  const excerptNumbers = new Set(numbers(excerpt));
  const missingNumber = claimNumbers.some((value) => !excerptNumbers.has(value));
  const overlap = tokenOverlap(claim, excerpt);
  const sameSubject = overlap >= 0.5;
  const contradicts = sameSubject && hasNegation(excerpt);
  const direct = normalized(excerpt).includes(normalized(claim));
  return {
    sameEntity: sameSubject,
    sameMetric: sameSubject,
    samePeriod: true,
    samePopulation: true,
    claimStrongerThanSource: missingNumber || (!direct && overlap < 0.85),
    qualifiersOmitted: false,
    relation: contradicts ? "direct_contradiction" : direct ? "direct_support" : sameSubject ? "partial_support" : "irrelevant",
    explanation: direct ? "The excerpt states the submitted claim." : "The excerpt covers only the facts it states directly.",
  };
}

function numericRelation(prompt: string): unknown {
  const claim = quotedValue(prompt, "Claim");
  const operands = /\bfrom\b[^\d+\-]*([+\-]?\d+(?:\.\d+)?)[^\n]{0,80}?\bto\b[^\d+\-]*([+\-]?\d+(?:\.\d+)?)/i.exec(claim);
  const result = /([+\-]?\d+(?:\.\d+)?)\s*(?:%|percent(?:age)?)\s+(?:increase|decrease|change)/i.exec(claim);
  if (!operands || !result) {
    return { kind: "none", inputs: {}, claimedResult: null, explanation: "No explicit numerical relationship was found." };
  }
  return {
    kind: "percent_change",
    inputs: { from: Number(operands[1]), to: Number(operands[2]) },
    claimedResult: Number(result[1]),
    explanation: "The submitted claim states a from-to percentage change.",
  };
}

function revision(prompt: string): unknown {
  const trace = sectionAfter(prompt, "Grounded numeric trace:");
  const sentence = firstSentence(trace);
  const eligible = prompt.split("Grounded numeric trace:", 1)[0] ?? "";
  const citationEvidenceIds = [...eligible.matchAll(/^- \[([^\]]+)\]/gm)].map((match) => match[1]!);
  if (!sentence || citationEvidenceIds.length === 0) {
    throw new Error("evaluation text model could not derive a grounded revision");
  }
  return { replacement: sentence, citationEvidenceIds };
}

function quotedValue(text: string, label: string): string {
  const prefix = `${label}: \"`;
  const start = text.indexOf(prefix);
  if (start < 0) throw new Error(`evaluation prompt is missing ${label}`);
  const valueStart = start + prefix.length;
  const end = text.indexOf('"', valueStart);
  if (end < 0) throw new Error(`evaluation prompt has an unterminated ${label}`);
  return text.slice(valueStart, end);
}

function lineValue(text: string, label: string): string {
  const prefix = `${label}: `;
  const start = text.indexOf(prefix);
  if (start < 0) return "";
  return text.slice(start + prefix.length).split("\n", 1)[0]!.trim();
}

function sectionAfter(text: string, marker: string): string {
  const start = text.indexOf(marker);
  if (start < 0) return "";
  return text.slice(start + marker.length).trim();
}

function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function firstSentence(text: string): string {
  const match = /^(.+?[.!?])(?:\s|$)/s.exec(text.trim());
  return match?.[1]?.trim() ?? "";
}

function normalized(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalized(text).split(" ").filter((token) => token.length > 1);
}

function tokenOverlap(claim: string, excerpt: string): number {
  const expected = new Set(tokens(claim));
  if (expected.size === 0) return 0;
  const observed = new Set(tokens(excerpt));
  let shared = 0;
  for (const token of expected) if (observed.has(token)) shared += 1;
  return shared / expected.size;
}

function numbers(text: string): number[] {
  return [...text.matchAll(/[+\-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g)]
    .map((match) => Number(match[0].replaceAll(",", "")))
    .filter(Number.isFinite);
}

function hasNegation(text: string): boolean {
  return /\b(?:not|never|false|incorrect|did not|does not)\b/i.test(text);
}
