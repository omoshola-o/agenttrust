import type { ClaimEntry } from "../ledger/claim.js";
import type { ATFEntry } from "../ledger/entry.js";

export type FindingType =
  | "unclaimed_execution"
  | "unfulfilled_claim"
  | "target_mismatch"
  | "action_type_mismatch"
  | "risk_underestimate"
  | "scope_violation"
  | "escalation_undeclared"
  | "outcome_unexpected";

export type FindingSeverity = "info" | "warning" | "critical";

export interface ConsistencyFinding {
  type: FindingType;
  severity: FindingSeverity;
  description: string;
  claim?: ClaimEntry;
  execution?: ATFEntry;
  details: Record<string, unknown>;
}

export interface ConsistencyReport {
  generatedAt: string;
  timeRange: { from: string; to: string };
  summary: {
    totalClaims: number;
    totalExecutions: number;
    pairedCount: number;
    unclaimedExecutions: number;
    unfulfilledClaims: number;
    divergentPairs: number;
    consistentPairs: number;
  };
  findings: ConsistencyFinding[];
  consistencyScore: number;
}

export type MatchType = "explicit" | "temporal" | "unmatched";

export interface MatchResult {
  claim?: ClaimEntry;
  execution?: ATFEntry;
  matchType: MatchType;
}
