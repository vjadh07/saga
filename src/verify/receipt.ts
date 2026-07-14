// The audit receipt is a deterministic record of the inputs and validated artifacts used
// by Saga. Raw fetch hashes, sanitized-source hashes, evidence excerpt hashes, revision
// hashes, and cross-references are checked independently before the outer receipt hash is
// accepted. Retaining or publishing finalAuditHash separately makes later changes evident.
import { hashId, sha256hex } from "./text.js";
import { computeNumeric } from "./research/numeric.js";
import { CHANGE_KINDS, CONFIDENCE, SAFETY_KINDS, VERDICTS } from "./types.js";
import type {
  ChangeKind,
  CitationAssessment,
  Confidence,
  ContractEvaluation,
  DraftChange,
  NumericCheck,
  SafetyEvent,
  Stance,
  VerdictKind,
} from "./types.js";
import type { ExecutionMode } from "./mode.js";

export const WORKFLOW_VERSION = "saga-audit-5";
export const PROMPT_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  claim_mapper: "1",
  research_plan: "1",
  investigator: "1",
  skeptic: "1",
  citation_assessment: "2",
  source_quality: "1",
  conflict_analysis: "2",
  numeric_extract: "2",
  revision: "3",
});

// Deterministic JSON for plain JSON values. Unsupported values and non-finite numbers are
// rejected instead of being silently converted or omitted.
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new Error(`canonical JSON cannot contain ${typeof value}`);
  if (Array.isArray(value)) {
    const entries: string[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw new Error("canonical JSON cannot contain a sparse array");
      entries.push(canonicalJson(value[index]));
    }
    return `[${entries.join(",")}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("canonical JSON can contain only plain objects");
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(",")}}`;
}

export interface ReceiptSearch {
  sequence: number;
  claimId: string;
  agent: "investigator" | "skeptic";
  query: string;
}

export interface ReceiptRetrieval {
  claimId: string;
  agent: "investigator" | "skeptic";
  query: string;
  originalUrl: string;
  finalUrl: string;
  accessedAt: string;
  contentHash: string;
}

export interface ReceiptFailure {
  sequence: number;
  claimId: string;
  agent: "investigator" | "skeptic" | "pipeline";
  operation: "search" | "search_result" | "fetch" | "claim";
  query: string | null;
  url: string | null;
  error: string;
}

export interface ReceiptSource {
  sourceId: string;
  sanitizedContentHash: string;
  retrievals: ReceiptRetrieval[];
}

export interface ReceiptEvidenceInput {
  id: string;
  claimId: string;
  sourceId: string;
  stance: Stance;
  excerpt: string;
  citationAssessment: CitationAssessment;
}

export interface ReceiptEvidence extends ReceiptEvidenceInput {
  excerptHash: string;
}

export interface ReceiptVerdict {
  claimId: string;
  verdict: VerdictKind;
  confidence: Confidence;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
}

export interface ReceiptRevisionInput {
  claimId: string;
  kind: ChangeKind;
  original: string;
  replacement: string;
  citationEvidenceIds: string[];
  source: NonNullable<DraftChange["source"]>;
  numericCheckClaimId: string | null;
}

export interface ReceiptRevision extends Omit<ReceiptRevisionInput, "original" | "replacement"> {
  changeId: string;
  originalHash: string;
  replacementHash: string;
}

export interface BuildReceiptInput {
  auditId: string;
  mode: ExecutionMode;
  modelProvider: string;
  modelId: string;
  searchProvider: string;
  document: string;
  finalDraft: string;
  searches: ReceiptSearch[];
  sources: ReceiptSource[];
  evidence: ReceiptEvidenceInput[];
  numericChecks: NumericCheck[];
  contractEvaluations: ContractEvaluation[];
  verdicts: ReceiptVerdict[];
  revisions: ReceiptRevisionInput[];
  safetyEvents: SafetyEvent[];
  failures: ReceiptFailure[];
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
  searches: ReceiptSearch[];
  sources: ReceiptSource[];
  evidence: ReceiptEvidence[];
  numericChecks: NumericCheck[];
  contractEvaluations: ContractEvaluation[];
  verdicts: ReceiptVerdict[];
  revisions: ReceiptRevision[];
  safetyEvents: SafetyEvent[];
  failures: ReceiptFailure[];
  approvedChangeIds: string[];
  startedAt: string;
  completedAt: string;
  finalAuditHash: string;
}

type ReceiptBody = Omit<AuditReceipt, "finalAuditHash">;

function copy<T>(value: T): T {
  return structuredClone(value);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function revisionId(revision: Omit<ReceiptRevision, "changeId">): string {
  return hashId(
    "chg",
    revision.claimId,
    revision.kind,
    revision.originalHash,
    revision.replacementHash,
    revision.citationEvidenceIds.join(","),
    revision.source,
    revision.numericCheckClaimId ?? "",
  );
}

function makeRevision(input: ReceiptRevisionInput): ReceiptRevision {
  const withoutId: Omit<ReceiptRevision, "changeId"> = {
    claimId: input.claimId,
    kind: input.kind,
    originalHash: sha256hex(input.original),
    replacementHash: sha256hex(input.replacement),
    citationEvidenceIds: [...input.citationEvidenceIds].sort(compareStrings),
    source: input.source,
    numericCheckClaimId: input.numericCheckClaimId,
  };
  return { ...withoutId, changeId: revisionId(withoutId) };
}

export function buildReceipt(input: BuildReceiptInput): AuditReceipt {
  const body: ReceiptBody = {
    auditId: input.auditId,
    mode: input.mode,
    workflowVersion: WORKFLOW_VERSION,
    promptVersions: { ...PROMPT_VERSIONS },
    modelProvider: input.modelProvider,
    modelId: input.modelId,
    searchProvider: input.searchProvider,
    documentHash: sha256hex(input.document),
    finalDraftHash: sha256hex(input.finalDraft),
    searches: copy(input.searches).sort((a, b) => a.sequence - b.sequence),
    sources: copy(input.sources).sort((a, b) => compareStrings(a.sourceId, b.sourceId)),
    evidence: copy(input.evidence)
      .map((e) => ({ ...e, excerptHash: sha256hex(e.excerpt) }))
      .sort((a, b) => compareStrings(a.id, b.id)),
    numericChecks: copy(input.numericChecks).sort((a, b) => compareStrings(a.claimId, b.claimId)),
    contractEvaluations: copy(input.contractEvaluations).sort((a, b) => compareStrings(a.claimId, b.claimId)),
    verdicts: copy(input.verdicts).sort((a, b) => compareStrings(a.claimId, b.claimId)),
    revisions: input.revisions.map(makeRevision).sort((a, b) => compareStrings(a.claimId, b.claimId)),
    safetyEvents: copy(input.safetyEvents),
    failures: copy(input.failures).sort((a, b) => a.sequence - b.sequence),
    approvedChangeIds: [...input.approvedChangeIds].sort(compareStrings),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
  validateBody(body);
  return { ...body, finalAuditHash: sha256hex(canonicalJson(body)) };
}

function requireString(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
}

function requireHash(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a SHA-256 content hash`);
}

function requireIsoDate(value: string, label: string): void {
  requireString(value, label);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) throw new Error(`${label} must be a canonical ISO timestamp`);
}

function requireHttpUrl(value: string, label: string): void {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
  } catch {
    throw new Error(`${label} must be an HTTP or HTTPS URL`);
  }
}

function requireUnique(values: string[], label: string): Set<string> {
  const set = new Set(values);
  if (set.size !== values.length) throw new Error(`${label} must be unique`);
  return set;
}

function expectedStance(relation: CitationAssessment["relation"]): Stance | null {
  switch (relation) {
    case "direct_support":
    case "partial_support":
      return "supports";
    case "qualification":
      return "qualifies";
    case "direct_contradiction":
      return "contradicts";
    default:
      return null;
  }
}

function searchKey(claimId: string, agent: "investigator" | "skeptic", query: string): string {
  return canonicalJson([claimId, agent, query]);
}

function validateBody(body: ReceiptBody): void {
  canonicalJson(body);
  requireString(body.auditId, "audit id");
  if (body.mode !== "live" && body.mode !== "demo") throw new Error("receipt mode is invalid");
  if (body.workflowVersion !== WORKFLOW_VERSION) throw new Error("receipt workflow version is unsupported");
  if (canonicalJson(body.promptVersions) !== canonicalJson(PROMPT_VERSIONS)) throw new Error("receipt prompt versions do not match the workflow version");
  requireString(body.modelProvider, "model provider");
  requireString(body.modelId, "model id");
  requireString(body.searchProvider, "search provider");
  requireHash(body.documentHash, "document hash");
  requireHash(body.finalDraftHash, "final draft hash");
  requireIsoDate(body.startedAt, "startedAt");
  requireIsoDate(body.completedAt, "completedAt");
  if (Date.parse(body.completedAt) < Date.parse(body.startedAt)) throw new Error("completedAt cannot precede startedAt");

  body.searches.forEach((search, index) => {
    if (search.sequence !== index + 1) throw new Error("receipt searches must have contiguous execution sequence numbers");
    requireString(search.claimId, "search claim id");
    requireString(search.query, "executed search query");
    if (search.agent !== "investigator" && search.agent !== "skeptic") throw new Error("search agent is invalid");
  });
  const searchKeys = new Set(body.searches.map((search) => searchKey(search.claimId, search.agent, search.query)));

  const sourceIds = requireUnique(body.sources.map((source) => source.sourceId), "receipt source ids");
  for (const source of body.sources) {
    requireString(source.sourceId, "source id");
    requireHash(source.sanitizedContentHash, `source ${source.sourceId} sanitized content hash`);
    if (!Array.isArray(source.retrievals) || source.retrievals.length === 0) {
      throw new Error(`source ${source.sourceId} is missing retrieval provenance`);
    }
    for (const retrieval of source.retrievals) {
      requireString(retrieval.claimId, `source ${source.sourceId} retrieval claim id`);
      requireString(retrieval.query, `source ${source.sourceId} retrieval query`);
      if (retrieval.agent !== "investigator" && retrieval.agent !== "skeptic") throw new Error(`source ${source.sourceId} retrieval agent is invalid`);
      if (!searchKeys.has(searchKey(retrieval.claimId, retrieval.agent, retrieval.query))) {
        throw new Error(`source ${source.sourceId} retrieval does not match an executed search`);
      }
      requireHttpUrl(retrieval.originalUrl, `source ${source.sourceId} original URL`);
      requireHttpUrl(retrieval.finalUrl, `source ${source.sourceId} final URL`);
      requireIsoDate(retrieval.accessedAt, `source ${source.sourceId} accessedAt`);
      requireHash(retrieval.contentHash, `source ${source.sourceId} retrieval content hash`);
      if (body.mode === "live" && hashId("src", retrieval.finalUrl, retrieval.contentHash) !== source.sourceId) {
        throw new Error(`source ${source.sourceId} id does not match its retrieval provenance`);
      }
    }
  }

  const verdictClaimIds = requireUnique(body.verdicts.map((verdict) => verdict.claimId), "receipt verdict claim ids");
  for (const verdict of body.verdicts) {
    requireString(verdict.claimId, "verdict claim id");
    if (!(VERDICTS as readonly string[]).includes(verdict.verdict)) throw new Error(`verdict ${verdict.claimId} has an invalid result`);
    if (!(CONFIDENCE as readonly string[]).includes(verdict.confidence)) throw new Error(`verdict ${verdict.claimId} has invalid confidence`);
  }

  requireUnique(body.evidence.map((evidence) => evidence.id), "receipt evidence ids");
  const evidenceById = new Map(body.evidence.map((evidence) => [evidence.id, evidence]));
  for (const evidence of body.evidence) {
    requireString(evidence.id, "evidence id");
    if (!verdictClaimIds.has(evidence.claimId)) throw new Error(`evidence ${evidence.id} refers to an unknown claim`);
    if (!sourceIds.has(evidence.sourceId)) throw new Error(`evidence ${evidence.id} refers to an unknown source`);
    requireHash(evidence.excerptHash, `evidence ${evidence.id} excerpt hash`);
    if (sha256hex(evidence.excerpt) !== evidence.excerptHash) throw new Error(`evidence ${evidence.id} excerpt hash does not match`);
    const assessment = evidence.citationAssessment;
    if (!assessment || assessment.exactMatchVerified !== true) throw new Error(`evidence ${evidence.id} is not citation validated`);
    for (const key of ["sameEntity", "sameMetric", "samePeriod", "samePopulation", "claimStrongerThanSource", "qualifiersOmitted"] as const) {
      if (typeof assessment[key] !== "boolean") throw new Error(`evidence ${evidence.id} has an invalid citation assessment`);
    }
    if (expectedStance(assessment.relation) !== evidence.stance) throw new Error(`evidence ${evidence.id} citation relation does not match its stance`);
    if (!assessment.sameEntity || !assessment.sameMetric) throw new Error(`evidence ${evidence.id} does not match the claim entity and metric`);
    if (["direct_support", "partial_support", "direct_contradiction"].includes(assessment.relation)
        && (!assessment.samePeriod || !assessment.samePopulation)) {
      throw new Error(`evidence ${evidence.id} relation is stronger than its period or population match`);
    }
    if (assessment.relation === "direct_support" && (assessment.claimStrongerThanSource || assessment.qualifiersOmitted)) {
      throw new Error(`evidence ${evidence.id} direct support omits a required qualification`);
    }
    if (assessment.relation === "partial_support" && assessment.qualifiersOmitted) {
      throw new Error(`evidence ${evidence.id} partial support omits a required qualification`);
    }
  }

  for (const verdict of body.verdicts) {
    requireUnique(verdict.supportingEvidenceIds, `verdict ${verdict.claimId} supporting evidence ids`);
    requireUnique(verdict.contradictingEvidenceIds, `verdict ${verdict.claimId} contradicting evidence ids`);
    const overlap = verdict.supportingEvidenceIds.find((id) => verdict.contradictingEvidenceIds.includes(id));
    if (overlap) throw new Error(`verdict ${verdict.claimId} uses evidence ${overlap} on both sides`);
    for (const evidenceId of verdict.supportingEvidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence || evidence.claimId !== verdict.claimId || evidence.stance !== "supports") {
        throw new Error(`verdict ${verdict.claimId} refers to invalid supporting evidence ${evidenceId}`);
      }
    }
    for (const evidenceId of verdict.contradictingEvidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence || evidence.claimId !== verdict.claimId || evidence.stance !== "contradicts") {
        throw new Error(`verdict ${verdict.claimId} refers to invalid contradicting evidence ${evidenceId}`);
      }
    }
  }

  const numericClaimIds = requireUnique(body.numericChecks.map((numeric) => numeric.claimId), "numeric check claim ids");
  const numericByClaim = new Map(body.numericChecks.map((numeric) => [numeric.claimId, numeric]));
  for (const numeric of body.numericChecks) {
    if (!verdictClaimIds.has(numeric.claimId)) throw new Error(`numeric check ${numeric.claimId} refers to an unknown claim`);
    for (const [name, value] of Object.entries(numeric.inputs)) {
      if (!Number.isFinite(value)) throw new Error(`numeric check ${numeric.claimId} input ${name} is not finite`);
    }
    if (numeric.computedResult !== null && !Number.isFinite(numeric.computedResult)) throw new Error(`numeric check ${numeric.claimId} result is not finite`);
    if (numeric.claimedResult !== null && !Number.isFinite(numeric.claimedResult)) throw new Error(`numeric check ${numeric.claimId} claimed result is not finite`);
    const recomputed = computeNumeric({
      kind: numeric.kind,
      inputs: numeric.inputs,
      claimedResult: numeric.claimedResult,
      explanation: numeric.explanation,
    });
    if (recomputed.expression !== numeric.expression || recomputed.computedResult !== numeric.computedResult) {
      throw new Error(`numeric check ${numeric.claimId} does not match its deterministic calculation`);
    }
    if (numeric.grounded !== (numeric.groundingIssues.length === 0)) throw new Error(`numeric check ${numeric.claimId} has inconsistent grounding state`);
    if (!numeric.grounded && numeric.matches !== null) throw new Error(`numeric check ${numeric.claimId} cannot match while ungrounded`);
    const directionMayOverride = numeric.grounded && numeric.kind === "percent_change" && recomputed.matches === true && numeric.matches === false;
    if (numeric.grounded && !directionMayOverride && numeric.matches !== recomputed.matches) {
      throw new Error(`numeric check ${numeric.claimId} match result does not match its deterministic calculation`);
    }
    requireUnique(numeric.sourceEvidenceIds, `numeric check ${numeric.claimId} evidence ids`);
    for (const evidenceId of numeric.sourceEvidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence || evidence.claimId !== numeric.claimId) throw new Error(`numeric check ${numeric.claimId} refers to invalid evidence ${evidenceId}`);
    }
  }

  for (const verdict of body.verdicts) {
    const supportCount = verdict.supportingEvidenceIds.length;
    const contradictionCount = verdict.contradictingEvidenceIds.length;
    const numericDisproof = numericByClaim.get(verdict.claimId);
    if (verdict.verdict === "supported" && supportCount === 0) throw new Error(`supported verdict ${verdict.claimId} has no supporting evidence`);
    if (verdict.verdict === "supported_with_qualifications" && supportCount === 0) throw new Error(`qualified verdict ${verdict.claimId} has no supporting evidence`);
    if (verdict.verdict === "contradicted" && contradictionCount === 0
        && !(numericDisproof?.grounded === true && numericDisproof.matches === false)) {
      throw new Error(`contradicted verdict ${verdict.claimId} has no contradictory evidence or deterministic numeric disproof`);
    }
    if (verdict.verdict === "disputed" && (supportCount === 0 || contradictionCount === 0)) {
      throw new Error(`disputed verdict ${verdict.claimId} does not reference both evidence sides`);
    }
    if (verdict.verdict === "outdated" && (supportCount === 0 || contradictionCount === 0)) {
      throw new Error(`outdated verdict ${verdict.claimId} lacks historical support or superseding evidence`);
    }
  }

  const contractClaimIds = requireUnique(body.contractEvaluations.map((evaluation) => evaluation.claimId), "contract evaluation claim ids");
  for (const evaluation of body.contractEvaluations) {
    if (!verdictClaimIds.has(evaluation.claimId)) throw new Error(`contract evaluation ${evaluation.claimId} refers to an unknown claim`);
    for (const key of [
      "supportingCriteriaMet", "contradictingCriteriaMet", "primaryRequirementMet",
      "preferredSourceRequirementMet", "independentOriginRequirementMet", "temporalRequirementMet",
    ] as const) {
      if (typeof evaluation[key] !== "boolean") throw new Error(`contract evaluation ${evaluation.claimId} has an invalid ${key} result`);
    }
    if (!Array.isArray(evaluation.triggeredAbstentionConditions)
        || evaluation.triggeredAbstentionConditions.some((condition) => typeof condition !== "string")) {
      throw new Error(`contract evaluation ${evaluation.claimId} has invalid abstention conditions`);
    }
    if (typeof evaluation.explanation !== "string") throw new Error(`contract evaluation ${evaluation.claimId} has an invalid explanation`);
  }
  if (contractClaimIds.size !== verdictClaimIds.size || [...verdictClaimIds].some((claimId) => !contractClaimIds.has(claimId))) {
    throw new Error("every receipt verdict must have exactly one contract evaluation");
  }

  requireUnique(body.revisions.map((revision) => revision.claimId), "receipt revision claim ids");
  const changeIds = requireUnique(body.revisions.map((revision) => revision.changeId), "receipt revision change ids");
  for (const revision of body.revisions) {
    if (!verdictClaimIds.has(revision.claimId)) throw new Error(`revision ${revision.claimId} refers to an unknown claim`);
    requireHash(revision.originalHash, `revision ${revision.claimId} original hash`);
    requireHash(revision.replacementHash, `revision ${revision.claimId} replacement hash`);
    if (!(CHANGE_KINDS as readonly string[]).includes(revision.kind)) throw new Error(`revision ${revision.claimId} has an invalid change kind`);
    if (!["revision_agent", "deterministic_marker", "deterministic_revision"].includes(revision.source)) throw new Error(`revision ${revision.claimId} has an invalid source`);
    if (body.mode === "live" && revision.source === "deterministic_marker") throw new Error(`revision ${revision.claimId} uses a placeholder marker in Live mode`);
    requireUnique(revision.citationEvidenceIds, `revision ${revision.claimId} citation evidence ids`);
    for (const evidenceId of revision.citationEvidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence || evidence.claimId !== revision.claimId) throw new Error(`revision ${revision.claimId} refers to invalid citation evidence ${evidenceId}`);
    }
    if (revision.numericCheckClaimId !== null) {
      if (revision.numericCheckClaimId !== revision.claimId || !numericClaimIds.has(revision.numericCheckClaimId)) {
        throw new Error(`revision ${revision.claimId} refers to an invalid numeric check`);
      }
    }
    if (revision.source === "revision_agent" && revision.citationEvidenceIds.length === 0 && revision.numericCheckClaimId === null) {
      throw new Error(`revision ${revision.claimId} has no validated grounding`);
    }
    const { changeId: _changeId, ...withoutId } = revision;
    if (revisionId(withoutId) !== revision.changeId) throw new Error(`revision ${revision.claimId} change id does not match its hashes and grounding`);
  }

  for (const event of body.safetyEvents) {
    if (!sourceIds.has(event.sourceId)) throw new Error(`safety event refers to unknown source ${event.sourceId}`);
    if (!(SAFETY_KINDS as readonly string[]).includes(event.kind)) throw new Error(`safety event for ${event.sourceId} has an invalid kind`);
    if (event.action !== "quarantined" && event.action !== "sanitized") throw new Error(`safety event for ${event.sourceId} has an invalid action`);
  }
  requireUnique(body.approvedChangeIds, "approved change ids");
  for (const changeId of body.approvedChangeIds) {
    if (!changeIds.has(changeId)) throw new Error(`approved change id ${changeId} does not refer to a revision`);
  }

  for (const search of body.searches) {
    if (!verdictClaimIds.has(search.claimId)) throw new Error(`search ${search.sequence} refers to an unknown claim`);
  }
  for (const source of body.sources) {
    for (const retrieval of source.retrievals) {
      if (!verdictClaimIds.has(retrieval.claimId)) throw new Error(`source ${source.sourceId} retrieval refers to an unknown claim`);
    }
  }
  body.failures.forEach((failure, index) => {
    if (failure.sequence !== index + 1) throw new Error("receipt failures must have contiguous sequence numbers");
    if (!verdictClaimIds.has(failure.claimId)) throw new Error(`failure ${failure.sequence} refers to an unknown claim`);
    requireString(failure.error, `failure ${failure.sequence} error`);
    if (failure.operation === "claim") {
      if (failure.agent !== "pipeline" || failure.query !== null || failure.url !== null) throw new Error(`failure ${failure.sequence} has invalid claim-failure provenance`);
      return;
    }
    if (failure.agent !== "investigator" && failure.agent !== "skeptic") throw new Error(`failure ${failure.sequence} has an invalid research agent`);
    if (failure.operation !== "search" && failure.operation !== "search_result" && failure.operation !== "fetch") throw new Error(`failure ${failure.sequence} has an invalid operation`);
    if (failure.query === null) throw new Error(`failure ${failure.sequence} is missing its search query`);
    requireString(failure.query, `failure ${failure.sequence} query`);
    if (!searchKeys.has(searchKey(failure.claimId, failure.agent, failure.query))) throw new Error(`failure ${failure.sequence} does not match an executed search`);
    if (failure.operation === "search" && failure.url !== null) throw new Error(`failure ${failure.sequence} search failure cannot have a URL`);
    if (failure.operation === "search_result") {
      if (failure.url !== null) requireString(failure.url, `failure ${failure.sequence} malformed search result URL`);
    }
    if (failure.operation === "fetch") {
      if (failure.url === null) throw new Error(`failure ${failure.sequence} fetch failure is missing its URL`);
      requireHttpUrl(failure.url, `failure ${failure.sequence} URL`);
    }
  });
}

// Recompute the outer hash, then independently verify hashes and cross-references. This
// catches a modified nested artifact even when only the outer hash was recomputed.
export function verifyReceipt(receipt: AuditReceipt): { valid: boolean; reason: string } {
  try {
    if (!receipt || typeof receipt !== "object") return { valid: false, reason: "receipt is not an object" };
    const { finalAuditHash, ...body } = receipt;
    requireHash(finalAuditHash, "final audit hash");
    const recomputed = sha256hex(canonicalJson(body));
    if (recomputed !== finalAuditHash) {
      return { valid: false, reason: "receipt hash does not match its contents; the receipt was modified" };
    }
    validateBody(body);
    return { valid: true, reason: "receipt hash, provenance, and grounding references are intact" };
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
