// The audit receipt. "Trust, with receipts" means a tamper-evident record of exactly what
// Saga did: which model and search provider, which queries, which URLs at which times, the
// hash of every source's content and every excerpt, the contract evaluations, the verdicts,
// the safety events, and the approved changes. The whole thing is serialized to canonical
// JSON and hashed, so any later modification is detectable. No blockchain: one hash over
// deterministic JSON is enough.
import { sha256hex } from "./text.js";
import type { Confidence, ContractEvaluation, NumericCheck, SafetyEvent, Stance, VerdictKind } from "./types.js";
import type { ExecutionMode } from "./mode.js";

export const WORKFLOW_VERSION = "saga-audit-3";
export const PROMPT_VERSIONS: Record<string, string> = {
  claim_mapper: "1",
  research_plan: "1",
  investigator: "1",
  skeptic: "1",
  citation_assessment: "2",
  source_quality: "1",
  conflict_analysis: "2",
  numeric_extract: "2",
  revision: "1",
};

// Deterministic, key-sorted JSON. Keys are sorted at every level and undefined values are
// dropped so serialization does not depend on insertion order.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export interface ReceiptSource {
  originalUrl: string;
  finalUrl: string;
  accessedAt: string;
  contentHash: string;
}
export interface ReceiptEvidenceInput {
  id: string;
  claimId: string;
  sourceId: string;
  stance: Stance;
  excerpt: string;
  relation?: string;
}
export interface ReceiptEvidence extends ReceiptEvidenceInput {
  excerptHash: string;
}
export interface ReceiptVerdict {
  claimId: string;
  verdict: VerdictKind;
  confidence: Confidence;
}

export interface BuildReceiptInput {
  auditId: string;
  mode: ExecutionMode;
  modelProvider: string;
  modelId: string;
  searchProvider: string;
  document: string;
  finalDraft: string;
  searchQueries: string[];
  sources: ReceiptSource[];
  evidence: ReceiptEvidenceInput[];
  numericChecks: NumericCheck[];
  contractEvaluations: ContractEvaluation[];
  verdicts: ReceiptVerdict[];
  safetyEvents: SafetyEvent[];
  approvedChangeIds: string[];
  startedAt: string;
  completedAt: string;
}

export interface AuditReceipt {
  auditId: string;
  mode: ExecutionMode;
  workflowVersion: string;
  promptVersions: Record<string, string>;
  modelProvider: string;
  modelId: string;
  searchProvider: string;
  documentHash: string;
  finalDraftHash: string;
  searchQueries: string[];
  sources: ReceiptSource[];
  evidence: ReceiptEvidence[];
  numericChecks: NumericCheck[];
  contractEvaluations: ContractEvaluation[];
  verdicts: ReceiptVerdict[];
  safetyEvents: SafetyEvent[];
  approvedChangeIds: string[];
  startedAt: string;
  completedAt: string;
  finalAuditHash: string;
}

export function buildReceipt(input: BuildReceiptInput): AuditReceipt {
  const body: Omit<AuditReceipt, "finalAuditHash"> = {
    auditId: input.auditId,
    mode: input.mode,
    workflowVersion: WORKFLOW_VERSION,
    promptVersions: PROMPT_VERSIONS,
    modelProvider: input.modelProvider,
    modelId: input.modelId,
    searchProvider: input.searchProvider,
    documentHash: sha256hex(input.document),
    finalDraftHash: sha256hex(input.finalDraft),
    searchQueries: input.searchQueries,
    sources: input.sources,
    evidence: input.evidence.map((e) => ({ ...e, excerptHash: sha256hex(e.excerpt) })),
    numericChecks: input.numericChecks,
    contractEvaluations: input.contractEvaluations,
    verdicts: input.verdicts,
    safetyEvents: input.safetyEvents,
    approvedChangeIds: input.approvedChangeIds,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
  return { ...body, finalAuditHash: sha256hex(canonicalJson(body)) };
}

// Recomputes the hash over every field except the hash itself; any modification is detected.
export function verifyReceipt(receipt: AuditReceipt): { valid: boolean; reason: string } {
  const { finalAuditHash, ...body } = receipt;
  const recomputed = sha256hex(canonicalJson(body));
  if (recomputed !== finalAuditHash) {
    return { valid: false, reason: "receipt hash does not match its contents; the receipt was modified" };
  }
  return { valid: true, reason: "receipt is intact" };
}
