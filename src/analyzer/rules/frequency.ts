import type { RiskRule } from "../types.js";

export const highActionRate: RiskRule = {
  id: "freq-001",
  name: "high_action_rate",
  category: "frequency",
  severity: "medium",
  description: "Detects unusually high action rates (more than configured max per minute)",
  enabledByDefault: true,
  evaluate(entry, context) {
    const entryTime = new Date(entry.ts).getTime();
    const oneMinuteAgo = entryTime - 60_000;

    const recentCount = context.recentEntries.filter((e) => {
      const t = new Date(e.ts).getTime();
      return t >= oneMinuteAgo && t <= entryTime;
    }).length;

    if (recentCount <= context.config.maxActionsPerMinute) return null;

    return {
      ruleId: "freq-001",
      severity: "medium",
      reason: `${recentCount} actions in last minute (threshold: ${context.config.maxActionsPerMinute})`,
      riskContribution: 6,
      labels: ["high_frequency"],
      evidence: {
        actionCount: recentCount,
        threshold: context.config.maxActionsPerMinute,
      },
    };
  },
};

export const frequencyRules: RiskRule[] = [highActionRate];
