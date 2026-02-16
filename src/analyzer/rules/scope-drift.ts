import type { RiskRule } from "../types.js";

const ESCALATION_TYPES = new Set(["elevated.enable", "elevated.command", "payment.initiate", "payment.confirm"]);

function isSensitivePath(target: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(target));
}

export const actionOutsideClaimScope: RiskRule = {
  id: "scope-001",
  name: "action_outside_claim_scope",
  category: "scope_drift",
  severity: "high",
  description:
    "Detects execution where paired claim declared withinScope=true but action type involves elevated, payment, or sensitive paths",
  enabledByDefault: true,
  evaluate(entry, context) {
    if (!context.pairedClaim) return null;
    if (!context.pairedClaim.constraints.withinScope) return null;

    const isEscalation = ESCALATION_TYPES.has(entry.action.type);
    const isSensitive = isSensitivePath(entry.action.target, context.config.sensitivePathPatterns);

    if (!isEscalation && !isSensitive) return null;

    const reason = isEscalation
      ? `Agent claimed within-scope but performed ${entry.action.type}`
      : `Agent claimed within-scope but accessed sensitive path: ${entry.action.target}`;

    return {
      ruleId: "scope-001",
      severity: "high",
      reason,
      riskContribution: 8,
      labels: ["escalation"],
    };
  },
};

export const scopeDriftRules: RiskRule[] = [actionOutsideClaimScope];
