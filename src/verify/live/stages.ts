// Persisted workflow stages. A stage is reported only when the live orchestrator enters
// the corresponding operation. These are status updates, not synthetic flight events.
export const LIVE_AUDIT_STAGES = [
  "planning_research",
  "researching_support",
  "researching_counterevidence",
  "validating_evidence",
  "analyzing_lineage",
  "validating_temporal",
  "validating_numeric",
  "arbitrating",
  "generating_revision",
] as const;

export type LiveAuditStage = (typeof LIVE_AUDIT_STAGES)[number];
