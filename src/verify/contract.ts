// The Evidence Contract, defined for a claim BEFORE any retrieval so Saga cannot move
// the goalposts after seeing results. It states what would support the claim, what
// would contradict it, and when to abstain. This is the deterministic default keyed to
// claim type and risk; the live pipeline can let an LLM elaborate it, but never after
// evidence is in hand.
import type { Claim, EvidenceContract, SourceType } from "./types.js";

interface Template {
  supporting: string[];
  contradicting: string[];
  preferred: SourceType[];
  primary: boolean;
}

const TEMPLATES: Record<Claim["claimType"], Template> = {
  numeric: {
    supporting: ["A primary dataset, filing, or official statistic reporting the same figure"],
    contradicting: ["A primary source reporting a materially different figure for the same measure"],
    preferred: ["primary", "gov", "academic"],
    primary: true,
  },
  event: {
    supporting: ["A primary record or contemporaneous first-hand report that the event occurred"],
    contradicting: ["A primary record showing the event did not occur or occurred differently"],
    preferred: ["primary", "news", "gov"],
    primary: true,
  },
  causal: {
    supporting: ["A controlled study or analysis establishing the causal mechanism"],
    contradicting: ["A study finding no effect, a confound, or reverse causation"],
    preferred: ["academic", "primary"],
    primary: true,
  },
  definitional: {
    supporting: ["An authoritative reference or standard defining the term this way"],
    contradicting: ["An authoritative reference defining the term differently"],
    preferred: ["encyclopedia", "academic", "gov"],
    primary: false,
  },
  quote: {
    supporting: ["The original transcript, recording, or document containing the quotation"],
    contradicting: ["The original showing the quotation is altered or out of context"],
    preferred: ["primary", "news"],
    primary: true,
  },
  prediction: {
    supporting: ["A credible forecast with a stated basis pointing the same direction"],
    contradicting: ["A credible forecast pointing the other way, or the outcome already differing"],
    preferred: ["academic", "news"],
    primary: false,
  },
  existence: {
    supporting: ["A reputable source confirming the thing exists as described"],
    contradicting: ["A reputable source showing it does not exist or differs materially"],
    preferred: ["primary", "news", "encyclopedia"],
    primary: false,
  },
  comparison: {
    supporting: ["A source ranking or comparing the same entities on the same metric"],
    contradicting: ["A source with a different ranking, or a newer one that reorders them"],
    preferred: ["primary", "academic", "news"],
    primary: true,
  },
  general: {
    supporting: ["A reputable source stating the same thing"],
    contradicting: ["A reputable source stating the opposite or a material qualification"],
    preferred: ["news", "encyclopedia"],
    primary: false,
  },
};

export function defaultContract(claim: Claim): EvidenceContract {
  const t = TEMPLATES[claim.claimType];
  const abstention = [
    "No source in the preferred set reports on the claim",
    "The only supporting sources trace to a single origin with no independent corroboration",
  ];
  if (claim.timeSensitive) {
    abstention.push("The most recent evidence predates the period the claim refers to");
  }
  return {
    claimId: claim.id,
    supportingCriteria: t.supporting,
    contradictingCriteria: t.contradicting,
    abstentionConditions: abstention,
    preferredSourceTypes: t.preferred,
    // high-risk claims always demand a primary source, whatever the type default
    primaryRequired: t.primary || claim.risk === "high",
  };
}
