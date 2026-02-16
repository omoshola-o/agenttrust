export { RuleEngine } from "./engine.js";
export { getAllBuiltinRules, getRuleById, getRulesByCategory } from "./rules/index.js";
export { loadRuleConfig, loadPreset, mergeConfigs } from "./config-loader.js";
export { DEFAULT_CONFIG } from "./types.js";
export type {
  RiskRule,
  RuleCategory,
  RuleSeverity,
  RuleContext,
  RuleMatch,
  RuleEngineConfig,
  EvaluationReport,
} from "./types.js";
