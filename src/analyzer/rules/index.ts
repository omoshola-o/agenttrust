import type { RiskRule } from "../types.js";
import { financialRules } from "./financial.js";
import { credentialRules } from "./credential.js";
import { communicationRules } from "./communication.js";
import { escalationRules } from "./escalation.js";
import { dataExfilRules } from "./data-exfil.js";
import { scopeDriftRules } from "./scope-drift.js";
import { frequencyRules } from "./frequency.js";
import { destructiveRules } from "./destructive.js";

const ALL_RULES: RiskRule[] = [
  ...financialRules,
  ...credentialRules,
  ...communicationRules,
  ...escalationRules,
  ...dataExfilRules,
  ...scopeDriftRules,
  ...frequencyRules,
  ...destructiveRules,
];

const ruleIndex = new Map<string, RiskRule>();
for (const rule of ALL_RULES) {
  ruleIndex.set(rule.id, rule);
}

export function getAllBuiltinRules(): RiskRule[] {
  return [...ALL_RULES];
}

export function getRuleById(id: string): RiskRule | undefined {
  return ruleIndex.get(id);
}

export function getRulesByCategory(category: string): RiskRule[] {
  return ALL_RULES.filter((r) => r.category === category);
}
