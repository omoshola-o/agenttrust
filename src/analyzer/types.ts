import type { ATFEntry } from "../ledger/entry.js";
import type { ClaimEntry } from "../ledger/claim.js";
import type { RiskLabel } from "../schema/risk.js";

export type RuleCategory =
  | "financial"
  | "credential"
  | "communication"
  | "escalation"
  | "data_exfil"
  | "scope_drift"
  | "frequency"
  | "destructive";

export type RuleSeverity = "low" | "medium" | "high" | "critical";

export interface RuleContext {
  sessionHistory: ATFEntry[];
  pairedClaim?: ClaimEntry;
  recentEntries: ATFEntry[];
  knownTargets: Set<string>;
  config: RuleEngineConfig;
}

export interface RuleMatch {
  ruleId: string;
  severity: RuleSeverity;
  reason: string;
  riskContribution: number;
  labels: RiskLabel[];
  evidence?: Record<string, unknown>;
}

export interface RiskRule {
  id: string;
  name: string;
  category: RuleCategory;
  severity: RuleSeverity;
  description: string;
  enabledByDefault: boolean;
  evaluate(entry: ATFEntry, context: RuleContext): RuleMatch | null;
}

export interface RuleEngineConfig {
  riskThreshold: number;
  maxActionsPerMinute: number;
  sensitivePathPatterns: string[];
  sensitiveDomains: string[];
  ruleOverrides: Record<string, boolean>;
}

export interface EvaluationReport {
  entriesEvaluated: number;
  totalMatches: number;
  matchesBySeverity: Record<RuleSeverity, number>;
  matchesByCategory: Record<string, number>;
  matches: Array<{ entry: ATFEntry; ruleMatches: RuleMatch[] }>;
}

export const DEFAULT_CONFIG: RuleEngineConfig = {
  riskThreshold: 7,
  maxActionsPerMinute: 30,
  sensitivePathPatterns: [
    "^.*\\.ssh/",
    "^.*\\.env",
    "^.*credentials",
    "^.*\\.pem$",
    "^.*\\.key$",
    "^.*password",
    "^.*secret",
    "^.*token",
    "^.*keychain",
    "^.*vault",
  ],
  sensitiveDomains: ["stripe.com", "paypal.com", "plaid.com"],
  ruleOverrides: {},
};
