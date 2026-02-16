import type { RiskRule } from "../types.js";

export const externalMessageSend: RiskRule = {
  id: "comm-001",
  name: "external_message_send",
  category: "communication",
  severity: "medium",
  description: "Detects any external message send action",
  enabledByDefault: true,
  evaluate(entry) {
    if (entry.action.type !== "message.send") return null;
    return {
      ruleId: "comm-001",
      severity: "medium",
      reason: `External message sent to ${entry.action.target}`,
      riskContribution: 5,
      labels: ["communication"],
    };
  },
};

export const unknownRecipient: RiskRule = {
  id: "comm-002",
  name: "unknown_recipient",
  category: "communication",
  severity: "high",
  description: "Detects messages sent to unknown/previously unseen recipients",
  enabledByDefault: true,
  evaluate(entry, context) {
    if (entry.action.type !== "message.send") return null;
    if (context.knownTargets.has(entry.action.target)) return null;
    return {
      ruleId: "comm-002",
      severity: "high",
      reason: `Message sent to unknown contact: ${entry.action.target}`,
      riskContribution: 7,
      labels: ["communication", "unknown_target"],
    };
  },
};

export const communicationRules: RiskRule[] = [externalMessageSend, unknownRecipient];
