import type { RiskRule } from "../types.js";

export const elevatedModeUsed: RiskRule = {
  id: "esc-001",
  name: "elevated_mode_used",
  category: "escalation",
  severity: "critical",
  description: "Detects use of elevated/host execution mode",
  enabledByDefault: true,
  evaluate(entry) {
    if (entry.action.type === "elevated.enable" || entry.action.type === "elevated.command") {
      return {
        ruleId: "esc-001",
        severity: "critical",
        reason: `Elevated mode: ${entry.action.type} — ${entry.action.detail}`,
        riskContribution: 9,
        labels: ["escalation"],
      };
    }
    return null;
  },
};

export const sudoCommand: RiskRule = {
  id: "esc-002",
  name: "sudo_command",
  category: "escalation",
  severity: "critical",
  description: "Detects shell commands that use sudo",
  enabledByDefault: true,
  evaluate(entry) {
    if (entry.action.type !== "exec.command") return null;
    const target = entry.action.target.toLowerCase();
    const detail = entry.action.detail.toLowerCase();
    if (target.includes("sudo") || detail.includes("sudo")) {
      return {
        ruleId: "esc-002",
        severity: "critical",
        reason: `Sudo command detected: ${entry.action.target}`,
        riskContribution: 9,
        labels: ["escalation", "execution"],
      };
    }
    return null;
  },
};

export const escalationRules: RiskRule[] = [elevatedModeUsed, sudoCommand];
