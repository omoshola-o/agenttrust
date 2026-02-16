import type { RiskRule } from "../types.js";

function isSensitivePath(target: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(target));
}

export const fileDeletion: RiskRule = {
  id: "destr-001",
  name: "file_deletion",
  category: "destructive",
  severity: "medium",
  description: "Detects file deletion actions (elevated severity for sensitive paths)",
  enabledByDefault: true,
  evaluate(entry, context) {
    if (entry.action.type !== "file.delete") return null;

    const sensitive = isSensitivePath(entry.action.target, context.config.sensitivePathPatterns);

    return {
      ruleId: "destr-001",
      severity: sensitive ? "high" : "medium",
      reason: `File deleted: ${entry.action.target}${sensitive ? " (sensitive path)" : ""}`,
      riskContribution: sensitive ? 8 : 5,
      labels: ["execution"],
    };
  },
};

export const recursiveDelete: RiskRule = {
  id: "destr-002",
  name: "recursive_delete",
  category: "destructive",
  severity: "critical",
  description: "Detects recursive delete commands (rm -rf, rm -r)",
  enabledByDefault: true,
  evaluate(entry) {
    if (entry.action.type !== "exec.command") return null;
    const target = entry.action.target.toLowerCase();
    const detail = entry.action.detail.toLowerCase();
    if (target.includes("rm -rf") || target.includes("rm -r") || detail.includes("rm -rf") || detail.includes("rm -r")) {
      return {
        ruleId: "destr-002",
        severity: "critical",
        reason: `Recursive delete command: ${entry.action.target}`,
        riskContribution: 9,
        labels: ["execution"],
      };
    }
    return null;
  },
};

export const destructiveRules: RiskRule[] = [fileDeletion, recursiveDelete];
