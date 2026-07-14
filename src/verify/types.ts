// The typed workflow state shared by every stage. Boundary artifacts that an LLM
// produces (claims, verdicts, evidence citations) get zod schemas so malformed or
// hallucinated output is rejected at the edge. Internal deterministic artifacts are
// plain interfaces. Nothing here does I/O.
import { z } from "zod";

// ---------- claims ----------

export const CLAIM_TYPES = [
  "numeric",
  "event",
  "causal",
  "definitional",
  "quote",
  "prediction",
  "existence",
  "comparison",
  "general",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const CLAIM_STATUSES = [
  "pending",
  "contracted",
  "investigating",
  "arbitrated",
  "abstained",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const ClaimSchema = z.object({
  id: z.string(),
  originalText: z.string(),
  normalized: z.string(),
  claimType: z.enum(CLAIM_TYPES),
  // char offsets into the submitted document; [start, end)
  location: z.object({ start: z.number().int(), end: z.number().int() }),
  verifiable: z.boolean(),
  timeSensitive: z.boolean(),
  risk: z.enum(RISK_LEVELS),
  status: z.enum(CLAIM_STATUSES),
  // the date the claim asserts as its "as of", when it states one
  asOf: z.string().nullable().default(null),
});
export type Claim = z.infer<typeof ClaimSchema>;

// ---------- evidence contract (defined before retrieval) ----------

export const SOURCE_TYPES = [
  "primary",
  "press_release",
  "news",
  "blog",
  "encyclopedia",
  "academic",
  "gov",
  "unknown",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const EvidenceContractSchema = z.object({
  claimId: z.string(),
  supportingCriteria: z.array(z.string()).min(1),
  contradictingCriteria: z.array(z.string()).min(1),
  abstentionConditions: z.array(z.string()).min(1),
  preferredSourceTypes: z.array(z.enum(SOURCE_TYPES)).min(1),
  primaryRequired: z.boolean(),
});
export type EvidenceContract = z.infer<typeof EvidenceContractSchema>;

// ---------- contract evaluation ----------

export interface ContractEvaluation {
  claimId: string;
  supportingCriteriaMet: boolean;
  contradictingCriteriaMet: boolean;
  primaryRequirementMet: boolean;
  preferredSourceRequirementMet: boolean;
  independentOriginRequirementMet: boolean;
  temporalRequirementMet: boolean;
  triggeredAbstentionConditions: string[];
  explanation: string;
}

// ---------- sources and evidence ----------

export interface SourceRetrieval {
  originalUrl: string;
  finalUrl: string;
  fetchedAt: string; // ISO timestamp for this specific retrieval
  contentHash: string; // sha256 of the raw fetched text before sanitization
  claimId?: string;
  agent?: "investigator" | "skeptic";
  query?: string;
}

export interface Source {
  id: string;
  url: string;
  canonicalUrl: string | null;
  title: string;
  publisher: string;
  publishedAt: string; // ISO date
  sourceType: SourceType;
  content: string; // as retrieved, possibly untrusted
  quotes: string[]; // deterministically extracted quotations
  outboundCitations: string[]; // URLs this source points at
  // Live retrieval attaches one entry per fetch. Optional so deterministic fixture
  // sources and persisted legacy records remain compatible.
  retrievals?: SourceRetrieval[];
}

export const STANCES = ["supports", "contradicts", "qualifies", "irrelevant"] as const;
export type Stance = (typeof STANCES)[number];

export const RELEVANCE = ["strong", "weak"] as const;
export type Relevance = (typeof RELEVANCE)[number];

export const CITATION_RELATIONS = [
  "direct_support",
  "partial_support",
  "qualification",
  "direct_contradiction",
  "context_only",
  "irrelevant",
] as const;
export type CitationRelation = (typeof CITATION_RELATIONS)[number];

export interface CitationAssessment {
  relation: CitationRelation;
  explanation: string;
  exactMatchVerified: boolean; // the excerpt was located verbatim in the sanitized source
  sameEntity: boolean;
  sameMetric: boolean;
  samePeriod: boolean;
  samePopulation: boolean;
  claimStrongerThanSource: boolean;
  qualifiersOmitted: boolean;
}

export interface Evidence {
  id: string;
  claimId: string;
  sourceId: string;
  stance: Stance;
  excerpt: string; // exact passage from the source
  relevance: Relevance;
  capturedBy: "investigator" | "skeptic";
  // set once the Citation Verifier has validated the excerpt; only validated evidence
  // reaches the Arbiter
  citationAssessment?: CitationAssessment;
}

// ---------- claim dependencies ----------

export const DEPENDENCY_KINDS = [
  "depends_on",
  "derived_from",
  "assumes",
  "calculated_from",
  "qualifies",
  "contradicts",
] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export interface ClaimDependency {
  from: string; // the dependent claim
  to: string; // the claim it relies on or relates to
  kind: DependencyKind;
}

// ---------- numeric verification ----------

export const NUMERIC_KINDS = [
  "percent_change",
  "ratio",
  "total",
  "average",
  "unit_conversion",
  "market_share",
  "date_interval",
  "none",
] as const;
export type NumericKind = (typeof NUMERIC_KINDS)[number];

export interface NumericCheck {
  claimId: string;
  kind: NumericKind;
  expression: string; // substituted calculation trace, including the computed result
  inputs: Record<string, number>;
  computedResult: number | null;
  claimedResult: number | null;
  matches: boolean | null; // null when there is nothing deterministic to check
  explanation: string;
  grounded: boolean; // every used input is in the claim or validated evidence
  groundingIssues: string[];
  sourceEvidenceIds: string[]; // validated evidence excerpts that supplied inputs
}

// ---------- source quality ----------

export const DIRECTNESS = ["direct", "indirect", "contextual"] as const;
export type Directness = (typeof DIRECTNESS)[number];

export const INDEPENDENCE = ["independent", "derived", "unknown"] as const;
export type Independence = (typeof INDEPENDENCE)[number];

export interface SourceQualityAssessment {
  sourceId: string;
  sourceType: SourceType;
  directness: Directness;
  independence: Independence;
  methodologyVisible: boolean | null;
  promotional: boolean;
  strengths: string[];
  weaknesses: string[];
  accepted: boolean;
  rejectionReason: string | null;
}

// ---------- source lineage ----------

export const LINEAGE_SIGNALS = [
  "near_duplicate_text",
  "shared_verbatim_quote",
  "shared_canonical_url",
  "shared_primary_source",
  "syndication_window",
] as const;
export type LineageSignal = (typeof LINEAGE_SIGNALS)[number];

export interface LineageGroup {
  id: string;
  sourceIds: string[];
  signals: LineageSignal[];
  originLabel: string; // human label for the shared origin
  representativeSourceId: string;
}

export interface LineageReport {
  sourceCount: number;
  independentOrigins: number;
  groups: LineageGroup[]; // groups of size >= 2 only
}

// ---------- safety ----------

export const SAFETY_KINDS = [
  "instruction_injection",
  "role_override",
  "exfiltration",
  "hidden_content",
  "script_stripped",
] as const;
export type SafetyKind = (typeof SAFETY_KINDS)[number];

export interface SafetyEvent {
  sourceId: string;
  kind: SafetyKind;
  excerpt: string;
  action: "quarantined" | "sanitized";
}

export interface SanitizedContent {
  clean: string; // safe to hand to an LLM as data
  events: SafetyEvent[];
  quarantined: string[]; // spans removed as instruction-like
}

// ---------- temporal ----------

export const TEMPORAL_SCOPES = ["historical", "current", "undated", "prediction"] as const;
export type TemporalScope = (typeof TEMPORAL_SCOPES)[number];

export interface TemporalAssessment {
  scope: TemporalScope;
  claimAsOf: string | null;
  latestEvidenceAt: string | null;
  superseded: boolean;
  note: string;
}

// ---------- contradiction resolution ----------

export const CONFLICT_CAUSES = [
  "different_period",
  "different_definition",
  "different_population",
  "different_region",
  "preliminary_vs_final",
  "global_vs_segment",
  "correction",
  "superseding",
  "different_methodology",
  "genuine_dispute",
  "none",
] as const;
export type ConflictCause = (typeof CONFLICT_CAUSES)[number];

export interface ConflictAnalysis {
  claimId: string;
  hasConflict: boolean;
  cause: ConflictCause;
  reconciled: boolean; // true when the apparent conflict is explained away, not a real disagreement
  explanation: string;
}

// ---------- verdicts ----------

export const VERDICTS = [
  "supported",
  "supported_with_qualifications",
  "contradicted",
  "disputed",
  "outdated",
  "insufficient_evidence",
  "not_verifiable",
  "failed",
] as const;
export type VerdictKind = (typeof VERDICTS)[number];

export const CONFIDENCE = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export interface Verdict {
  claimId: string;
  verdict: VerdictKind;
  confidence: Confidence;
  rationale: string;
  supporting: string[]; // evidence ids
  contradicting: string[]; // evidence ids
  independentOrigins: number;
  temporal: TemporalAssessment | null;
  requiredCorrection: string | null;
}

// the full per-claim record the UI renders
export interface ClaimAudit {
  claim: Claim;
  contract: EvidenceContract;
  evidence: Evidence[];
  verdict: Verdict;
}

// ---------- trust passport ----------

export const DOCUMENT_STATUSES = [
  "strongly_supported",
  "mostly_supported",
  "revision_required",
  "insufficiently_supported",
  "materially_contradicted",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface TrustPassport {
  totalClaims: number;
  supported: number;
  qualified: number;
  contradicted: number;
  disputed: number;
  outdated: number;
  insufficient: number;
  notVerifiable: number;
  primarySourceCount: number;
  independentOrigins: number;
  claimsRequiringRevision: number;
  lastVerifiedAt: string;
  documentStatus: DocumentStatus;
}

// ---------- corrected draft ----------

export const CHANGE_KINDS = ["rewrite", "qualify", "update", "flag", "remove"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export interface DraftChange {
  claimId: string;
  kind: ChangeKind;
  original: string;
  replacement: string; // for flag/remove this may wrap or blank the original
  note: string;
  citations?: string[]; // evidence ids the replacement prose is grounded in
  source?: "revision_agent" | "deterministic_marker" | "deterministic_revision"; // how the replacement was produced
  numericCheckClaimId?: string; // set only when the replacement prose used this deterministic numeric check
}

export interface CorrectedDraft {
  original: string;
  changes: DraftChange[];
  draft: string; // assembled corrected text, pending approval
}

// ---------- flight recorder ----------

export const FLIGHT_EVENTS = [
  "CLAIMS_EXTRACTED",
  "CLAIM_CLASSIFIED",
  "CONTRACT_DEFINED",
  "QUERY_EXECUTED",
  "SOURCE_ACCEPTED",
  "SOURCE_REJECTED",
  "PRIMARY_SOURCE_FOUND",
  "CONTRADICTION_FOUND",
  "LINEAGE_GROUP_DETECTED",
  "INJECTION_QUARANTINED",
  "TEMPORAL_FLAGGED",
  "VERDICT_REACHED",
  "AUDIT_COMPLETED",
] as const;
export type FlightEventType = (typeof FLIGHT_EVENTS)[number];

export interface FlightEvent {
  seq: number;
  auditId: string;
  claimId: string; // "" for document-level events
  type: FlightEventType;
  detail: Record<string, unknown>;
  at: string;
}
