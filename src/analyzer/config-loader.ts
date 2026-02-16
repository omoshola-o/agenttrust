import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { RuleEngineConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

interface YamlRuleConfig {
  version?: number;
  preset?: string;
  engine?: {
    riskThreshold?: number;
    maxActionsPerMinute?: number;
    sensitivePathPatterns?: string[];
    sensitiveDomains?: string[];
  };
  rules?: Record<string, { enabled: boolean }>;
}

function getConfigsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // Go from src/analyzer/ up to project root, then into configs/
  return join(dirname(thisFile), "..", "..", "configs");
}

export function loadRuleConfig(path: string): RuleEngineConfig {
  const content = readFileSync(path, "utf-8");
  const parsed: unknown = parseYaml(content);
  return yamlToConfig(parsed as YamlRuleConfig);
}

export function loadPreset(name: "default" | "strict" | "minimal"): RuleEngineConfig {
  const configsDir = getConfigsDir();
  const filePath = join(configsDir, `${name}.rules.yaml`);
  return loadRuleConfig(filePath);
}

function yamlToConfig(yaml: YamlRuleConfig): RuleEngineConfig {
  const ruleOverrides: Record<string, boolean> = {};
  if (yaml.rules) {
    for (const [ruleId, rule] of Object.entries(yaml.rules)) {
      ruleOverrides[ruleId] = rule.enabled;
    }
  }

  return {
    riskThreshold: yaml.engine?.riskThreshold ?? DEFAULT_CONFIG.riskThreshold,
    maxActionsPerMinute: yaml.engine?.maxActionsPerMinute ?? DEFAULT_CONFIG.maxActionsPerMinute,
    sensitivePathPatterns:
      yaml.engine?.sensitivePathPatterns ?? DEFAULT_CONFIG.sensitivePathPatterns,
    sensitiveDomains: yaml.engine?.sensitiveDomains ?? DEFAULT_CONFIG.sensitiveDomains,
    ruleOverrides,
  };
}

export function mergeConfigs(
  base: RuleEngineConfig,
  override: Partial<RuleEngineConfig>,
): RuleEngineConfig {
  return {
    riskThreshold: override.riskThreshold ?? base.riskThreshold,
    maxActionsPerMinute: override.maxActionsPerMinute ?? base.maxActionsPerMinute,
    sensitivePathPatterns: override.sensitivePathPatterns ?? base.sensitivePathPatterns,
    sensitiveDomains: override.sensitiveDomains ?? base.sensitiveDomains,
    ruleOverrides: { ...base.ruleOverrides, ...override.ruleOverrides },
  };
}
