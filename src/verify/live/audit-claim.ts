// The live per-claim pipeline: the integration of every research stage for one claim,
// running on real providers with no fixture labels. Contract, plan, independent Investigator
// and Skeptic research, source-quality gating, citation entailment, lineage, temporal,
// numeric, contract enforcement, conflict resolution, and the grounded verdict. A single
// claim's research failure is isolated here and surfaced as a failed verdict, never a
// contradiction. Emits real flight events as it goes.
import { defaultContract } from "../contract.js";
import { planResearch, type ResearchPlan } from "../research/plan.js";
import { investigateClaim } from "../research/investigator.js";
import { skepticResearch } from "../research/skeptic.js";
import { assessSourceQuality } from "../research/quality.js";
import { validateEvidence, type EvidenceCandidate } from "../research/citation.js";
import { evaluateContract } from "../research/contract-eval.js";
import { resolveContradiction } from "../research/conflict.js";
import { verifyNumericClaim } from "../research/numeric.js";
import { groundedArbitrate } from "../research/arbiter-grounded.js";
import { detectLineage } from "../lineage.js";
import { assessTemporal, temporalScope } from "../temporal.js";
import { citedSources } from "../corpus.js";
import type { AuditMode } from "../mapview.js";
import type { ModelProvider } from "../providers/model.js";
import type { PageFetcher } from "../providers/fetch.js";
import type { SearchProvider } from "../providers/search.js";
import type {
  Claim,
  ConflictAnalysis,
  ContractEvaluation,
  Evidence,
  EvidenceContract,
  FlightEventType,
  NumericCheck,
  SafetyEvent,
  Source,
  SourceQualityAssessment,
  TemporalAssessment,
  Verdict,
} from "../types.js";

export interface LiveClaimAudit {
  claim: Claim;
  contract: EvidenceContract;
  plan: ResearchPlan | null;
  evidence: Evidence[];
  sourceQuality: SourceQualityAssessment[];
  sourcesExamined: Source[];
  contractEvaluation: ContractEvaluation;
  temporal: TemporalAssessment;
  numeric: NumericCheck | null;
  conflict: ConflictAnalysis;
  verdict: Verdict;
  safety: SafetyEvent[];
  errors: Array<{ url: string; error: string }>;
}

export interface AuditClaimInput {
  claim: Claim;
  mode: AuditMode;
  model: ModelProvider;
  search: SearchProvider;
  fetcher: PageFetcher;
  now: string;
  emit?: (type: FlightEventType, detail: Record<string, unknown>) => void;
}

export async function auditClaim(input: AuditClaimInput): Promise<LiveClaimAudit> {
  const { claim, mode, model, search, fetcher, now } = input;
  const emit = input.emit ?? (() => {});
  const contract = defaultContract(claim);
  emit("CONTRACT_DEFINED", { claimId: claim.id, primaryRequired: contract.primaryRequired });

  const emptyTemporal = assessTemporal({ scope: temporalScope(claim), asOf: claim.asOf, supporting: [], contradicting: [], now });
  const noConflict: ConflictAnalysis = { claimId: claim.id, hasConflict: false, cause: "none", reconciled: false, explanation: "" };

  // opinions are not researched
  if (!claim.verifiable) {
    const verdict = groundedArbitrate({
      claim, contractEvaluation: emptyContractEval(claim.id), temporal: emptyTemporal, numeric: null, conflict: noConflict,
      evidence: [], supportOrigins: 0, contraOrigins: 0,
    });
    emit("VERDICT_REACHED", { claimId: claim.id, verdict: verdict.verdict, confidence: verdict.confidence });
    return baseAudit(claim, contract, null, verdict, emptyTemporal, noConflict, emptyContractEval(claim.id), [], [], [], [], null);
  }

  // 1. plan before retrieval
  const plan = await planResearch({ claim, contract, mode, model });

  // 2. independent Investigator and Skeptic
  const inv = await investigateClaim({ claim, plan, search, fetcher, model });
  emit("QUERY_EXECUTED", { claimId: claim.id, agent: "investigator", found: inv.evidence.length });
  const skep = await skepticResearch({ claim, plan, search, fetcher, model });
  emit("QUERY_EXECUTED", { claimId: claim.id, agent: "skeptic", found: skep.evidence.length });

  const safety = [...inv.safety, ...skep.safety];
  for (const s of safety) if (s.action === "quarantined") emit("INJECTION_QUARANTINED", { claimId: claim.id, sourceId: s.sourceId, kind: s.kind });
  const errors = [...inv.errors, ...skep.errors];

  // if nothing at all could be retrieved, this claim's research failed
  const examined = dedupeSources([...inv.sourcesExamined, ...skep.sourcesExamined]);
  if (examined.length === 0) {
    const verdict = groundedArbitrate({ claim, contractEvaluation: emptyContractEval(claim.id), temporal: emptyTemporal, numeric: null, conflict: noConflict, evidence: [], supportOrigins: 0, contraOrigins: 0, researchFailed: true });
    emit("VERDICT_REACHED", { claimId: claim.id, verdict: verdict.verdict, confidence: verdict.confidence });
    return baseAudit(claim, contract, plan, verdict, emptyTemporal, noConflict, emptyContractEval(claim.id), [], examined, safety, errors, null);
  }

  // 3. source-quality gate
  const byId = new Map(examined.map((s) => [s.id, s]));
  const quality: SourceQualityAssessment[] = [];
  const rejectedSources = new Set<string>();
  for (const s of examined) {
    const q = await assessSourceQuality({ claim, source: s, model });
    quality.push(q);
    if (!q.accepted) {
      rejectedSources.add(s.id);
      emit("SOURCE_REJECTED", { claimId: claim.id, sourceId: s.id, reason: q.rejectionReason });
    } else if (q.sourceType === "primary") {
      emit("PRIMARY_SOURCE_FOUND", { claimId: claim.id, sourceId: s.id });
    }
    // reflect the resolved source type back onto the source for lineage/contract checks
    const src = byId.get(s.id);
    if (src) src.sourceType = q.sourceType;
  }

  // 4. citation entailment: only excerpts from accepted sources, verified verbatim
  const candidates: EvidenceCandidate[] = [...inv.evidence, ...skep.evidence]
    .filter((e) => !rejectedSources.has(e.sourceId))
    .map((e) => ({ evidence: e, source: byId.get(e.sourceId)! }))
    .filter((c) => c.source);
  const { validated } = await validateEvidence({ claim, candidates, model });

  const supporting = validated.filter((e) => e.stance === "supports");
  const contradicting = validated.filter((e) => e.stance === "contradicts");
  const qualifying = validated.filter((e) => e.stance === "qualifies");
  const againstAll = [...contradicting, ...qualifying];
  if (contradicting.length > 0) emit("CONTRADICTION_FOUND", { claimId: claim.id, count: contradicting.length });

  // 5. lineage per side (independent origins)
  const supportSources = citedSources(supporting, byId);
  const contraSources = citedSources(againstAll, byId);
  const supportOrigins = detectLineage(supportSources).independentOrigins;
  const contraOrigins = detectLineage(contraSources).independentOrigins;
  for (const g of detectLineage(dedupeSources([...supportSources, ...contraSources])).groups) {
    emit("LINEAGE_GROUP_DETECTED", { claimId: claim.id, sourceIds: g.sourceIds, originLabel: g.originLabel, signals: g.signals });
  }

  // 6. temporal (only contradictions drive supersession)
  const temporal = assessTemporal({
    scope: temporalScope(claim), asOf: claim.asOf,
    supporting: supporting.map((e) => byId.get(e.sourceId)?.publishedAt ?? "").filter(Boolean),
    contradicting: contradicting.map((e) => byId.get(e.sourceId)?.publishedAt ?? "").filter(Boolean),
    now,
  });
  if (temporal.superseded) emit("TEMPORAL_FLAGGED", { claimId: claim.id, note: temporal.note });

  // 7. numeric recomputation
  const numeric = claim.claimType === "numeric" ? await verifyNumericClaim({ claim, model }) : null;

  // 8. operational contract enforcement
  const contractEvaluation = evaluateContract({
    claim, contract, plan, supporting, contradicting: againstAll, sourceById: byId, independentOrigins: supportOrigins,
    evidenceCurrent: !temporal.superseded,
  });

  // 9. conflict resolution when both sides are strong
  const conflict =
    supporting.some((e) => e.relevance === "strong") && contradicting.some((e) => e.relevance === "strong")
      ? await resolveContradiction({ claim, supporting, contradicting, model })
      : noConflict;

  // 10. grounded verdict
  const verdict = groundedArbitrate({ claim, contractEvaluation, temporal, numeric, conflict, evidence: validated, supportOrigins, contraOrigins });
  emit("VERDICT_REACHED", { claimId: claim.id, verdict: verdict.verdict, confidence: verdict.confidence });

  return {
    claim, contract, plan, evidence: validated, sourceQuality: quality, sourcesExamined: examined,
    contractEvaluation, temporal, numeric, conflict, verdict, safety, errors,
  };
}

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

function emptyContractEval(claimId: string): ContractEvaluation {
  return { claimId, supportingCriteriaMet: false, contradictingCriteriaMet: false, primaryRequirementMet: false, independentOriginRequirementMet: false, triggeredAbstentionConditions: ["no evidence was retrieved"], explanation: "no evidence" };
}

function baseAudit(
  claim: Claim, contract: EvidenceContract, plan: ResearchPlan | null, verdict: Verdict,
  temporal: TemporalAssessment, conflict: ConflictAnalysis, contractEvaluation: ContractEvaluation,
  evidence: Evidence[], sourcesExamined: Source[], safety: SafetyEvent[], errors: Array<{ url: string; error: string }>, numeric: NumericCheck | null,
): LiveClaimAudit {
  return { claim, contract, plan, evidence, sourceQuality: [], sourcesExamined, contractEvaluation, temporal, numeric, conflict, verdict, safety, errors };
}
