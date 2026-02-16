import { describe, it, expect } from "vitest";
import { loadPreset, loadRuleConfig, mergeConfigs } from "../../src/analyzer/config-loader.js";
import { DEFAULT_CONFIG } from "../../src/analyzer/types.js";
import type { RuleEngineConfig } from "../../src/analyzer/types.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadPreset", () => {
  it("loadPreset('default') returns config with riskThreshold 7", () => {
    const config = loadPreset("default");
    expect(config.riskThreshold).toBe(7);
  });

  it("loadPreset('default') returns config with maxActionsPerMinute 30", () => {
    const config = loadPreset("default");
    expect(config.maxActionsPerMinute).toBe(30);
  });

  it("loadPreset('default') has all rules enabled", () => {
    const config = loadPreset("default");
    const ruleIds = [
      "fin-001", "fin-002", "cred-001", "cred-002", "cred-003",
      "comm-001", "comm-002", "esc-001", "esc-002", "exfil-001",
      "scope-001", "freq-001", "destr-001", "destr-002",
    ];
    for (const id of ruleIds) {
      expect(config.ruleOverrides[id]).toBe(true);
    }
  });

  it("loadPreset('strict') returns config with riskThreshold 4", () => {
    const config = loadPreset("strict");
    expect(config.riskThreshold).toBe(4);
  });

  it("loadPreset('strict') returns config with maxActionsPerMinute 15", () => {
    const config = loadPreset("strict");
    expect(config.maxActionsPerMinute).toBe(15);
  });

  it("loadPreset('strict') has additional sensitive path patterns", () => {
    const config = loadPreset("strict");
    const hasGnupg = config.sensitivePathPatterns.some((p) => p.includes(".gnupg"));
    const hasAws = config.sensitivePathPatterns.some((p) => p.includes(".aws"));
    const hasKube = config.sensitivePathPatterns.some((p) => p.includes(".kube"));
    const hasDocker = config.sensitivePathPatterns.some((p) => p.includes(".docker"));
    expect(hasGnupg).toBe(true);
    expect(hasAws).toBe(true);
    expect(hasKube).toBe(true);
    expect(hasDocker).toBe(true);
  });

  it("loadPreset('strict') has additional sensitive domains", () => {
    const config = loadPreset("strict");
    expect(config.sensitiveDomains).toContain("braintree.com");
    expect(config.sensitiveDomains).toContain("square.com");
    expect(config.sensitiveDomains).toContain("wise.com");
  });

  it("loadPreset('minimal') disables comm-001, comm-002, exfil-001, scope-001, freq-001, destr-001, destr-002", () => {
    const config = loadPreset("minimal");
    expect(config.ruleOverrides["comm-001"]).toBe(false);
    expect(config.ruleOverrides["comm-002"]).toBe(false);
    expect(config.ruleOverrides["exfil-001"]).toBe(false);
    expect(config.ruleOverrides["scope-001"]).toBe(false);
    expect(config.ruleOverrides["freq-001"]).toBe(false);
    expect(config.ruleOverrides["destr-001"]).toBe(false);
    expect(config.ruleOverrides["destr-002"]).toBe(false);
  });

  it("loadPreset('minimal') keeps financial, credential, and escalation rules enabled", () => {
    const config = loadPreset("minimal");
    expect(config.ruleOverrides["fin-001"]).toBe(true);
    expect(config.ruleOverrides["fin-002"]).toBe(true);
    expect(config.ruleOverrides["cred-001"]).toBe(true);
    expect(config.ruleOverrides["cred-002"]).toBe(true);
    expect(config.ruleOverrides["cred-003"]).toBe(true);
    expect(config.ruleOverrides["esc-001"]).toBe(true);
    expect(config.ruleOverrides["esc-002"]).toBe(true);
  });

  it("loadPreset('minimal') has riskThreshold 7", () => {
    const config = loadPreset("minimal");
    expect(config.riskThreshold).toBe(7);
  });

  it("loadPreset('minimal') has maxActionsPerMinute 60", () => {
    const config = loadPreset("minimal");
    expect(config.maxActionsPerMinute).toBe(60);
  });

  it("loadPreset with invalid name throws", () => {
    expect(() => loadPreset("nonexistent" as "default")).toThrow();
  });
});

describe("loadRuleConfig", () => {
  let tmpDir: string;

  function createTempYaml(content: string): string {
    tmpDir = mkdtempSync(join(tmpdir(), "agenttrust-test-"));
    const filePath = join(tmpDir, "test.rules.yaml");
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  it("loads a YAML config file and returns RuleEngineConfig", () => {
    const path = createTempYaml(`
version: 1
preset: custom
engine:
  riskThreshold: 5
  maxActionsPerMinute: 20
rules:
  fin-001: { enabled: true }
  cred-001: { enabled: false }
`);
    const config = loadRuleConfig(path);
    expect(config.riskThreshold).toBe(5);
    expect(config.maxActionsPerMinute).toBe(20);
    expect(config.ruleOverrides["fin-001"]).toBe(true);
    expect(config.ruleOverrides["cred-001"]).toBe(false);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses defaults for missing engine fields", () => {
    const path = createTempYaml(`
version: 1
engine:
  riskThreshold: 3
`);
    const config = loadRuleConfig(path);
    expect(config.riskThreshold).toBe(3);
    expect(config.maxActionsPerMinute).toBe(DEFAULT_CONFIG.maxActionsPerMinute);
    expect(config.sensitivePathPatterns).toEqual(DEFAULT_CONFIG.sensitivePathPatterns);
    expect(config.sensitiveDomains).toEqual(DEFAULT_CONFIG.sensitiveDomains);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws for non-existent file", () => {
    expect(() => loadRuleConfig("/nonexistent/path/config.yaml")).toThrow();
  });
});

describe("mergeConfigs", () => {
  it("merges ruleOverrides with override taking precedence", () => {
    const base: RuleEngineConfig = {
      ...DEFAULT_CONFIG,
      ruleOverrides: { "fin-001": true, "cred-001": true },
    };
    const override: Partial<RuleEngineConfig> = {
      ruleOverrides: { "fin-001": false, "esc-001": false },
    };
    const merged = mergeConfigs(base, override);
    // Override replaces fin-001
    expect(merged.ruleOverrides["fin-001"]).toBe(false);
    // Base cred-001 is kept
    expect(merged.ruleOverrides["cred-001"]).toBe(true);
    // Override adds esc-001
    expect(merged.ruleOverrides["esc-001"]).toBe(false);
  });

  it("uses base values when override is missing", () => {
    const base: RuleEngineConfig = {
      ...DEFAULT_CONFIG,
      riskThreshold: 5,
      maxActionsPerMinute: 20,
    };
    const override: Partial<RuleEngineConfig> = {};
    const merged = mergeConfigs(base, override);
    expect(merged.riskThreshold).toBe(5);
    expect(merged.maxActionsPerMinute).toBe(20);
    expect(merged.sensitivePathPatterns).toEqual(base.sensitivePathPatterns);
    expect(merged.sensitiveDomains).toEqual(base.sensitiveDomains);
  });

  it("replaces arrays (sensitivePathPatterns) rather than merging them", () => {
    const base: RuleEngineConfig = {
      ...DEFAULT_CONFIG,
      sensitivePathPatterns: ["^.*\\.ssh/", "^.*\\.env"],
    };
    const override: Partial<RuleEngineConfig> = {
      sensitivePathPatterns: ["^.*\\.aws/"],
    };
    const merged = mergeConfigs(base, override);
    // Should be replaced, not merged
    expect(merged.sensitivePathPatterns).toEqual(["^.*\\.aws/"]);
    expect(merged.sensitivePathPatterns).not.toContain("^.*\\.ssh/");
  });

  it("replaces sensitiveDomains array rather than merging", () => {
    const base: RuleEngineConfig = {
      ...DEFAULT_CONFIG,
      sensitiveDomains: ["stripe.com", "paypal.com"],
    };
    const override: Partial<RuleEngineConfig> = {
      sensitiveDomains: ["wise.com"],
    };
    const merged = mergeConfigs(base, override);
    expect(merged.sensitiveDomains).toEqual(["wise.com"]);
  });

  it("overrides scalar values", () => {
    const base: RuleEngineConfig = { ...DEFAULT_CONFIG };
    const override: Partial<RuleEngineConfig> = {
      riskThreshold: 3,
      maxActionsPerMinute: 10,
    };
    const merged = mergeConfigs(base, override);
    expect(merged.riskThreshold).toBe(3);
    expect(merged.maxActionsPerMinute).toBe(10);
  });

  it("deep merges ruleOverrides from both base and override", () => {
    const base: RuleEngineConfig = {
      ...DEFAULT_CONFIG,
      ruleOverrides: { "fin-001": true, "fin-002": true, "cred-001": false },
    };
    const override: Partial<RuleEngineConfig> = {
      ruleOverrides: { "fin-002": false, "esc-001": true },
    };
    const merged = mergeConfigs(base, override);
    expect(merged.ruleOverrides["fin-001"]).toBe(true); // from base
    expect(merged.ruleOverrides["fin-002"]).toBe(false); // overridden
    expect(merged.ruleOverrides["cred-001"]).toBe(false); // from base
    expect(merged.ruleOverrides["esc-001"]).toBe(true); // from override
  });
});
