import type { ConsistencyFinding, FindingType, FindingSeverity } from "./types.js";

const PENALTIES: Record<FindingType, Record<FindingSeverity, number>> = {
  unclaimed_execution: { info: 2, warning: 5, critical: 5 },
  unfulfilled_claim: { info: 3, warning: 3, critical: 3 },
  target_mismatch: { info: 5, warning: 5, critical: 10 },
  action_type_mismatch: { info: 15, warning: 15, critical: 15 },
  risk_underestimate: { info: 5, warning: 5, critical: 5 },
  scope_violation: { info: 15, warning: 15, critical: 15 },
  escalation_undeclared: { info: 20, warning: 20, critical: 20 },
  outcome_unexpected: { info: 1, warning: 1, critical: 1 },
};

export function computeConsistencyScore(findings: readonly ConsistencyFinding[]): number {
  let penalty = 0;
  for (const finding of findings) {
    const typePenalties = PENALTIES[finding.type];
    penalty += typePenalties[finding.severity];
  }
  return Math.max(0, 100 - penalty);
}
