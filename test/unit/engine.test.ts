import { describe, it, expect } from "vitest";
import { RuleEngine } from "../../src/analyzer/engine.js";
import { DEFAULT_CONFIG } from "../../src/analyzer/types.js";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type { ClaimEntry } from "../../src/ledger/claim.js";
import type { RuleContext, RuleEngineConfig } from "../../src/analyzer/types.js";

function makeEntry(overrides: Partial<ATFEntry> = {}): ATFEntry {
  return {
    id: "01TESTENTRY000000000000001",
    v: 1,
    ts: "2026-02-15T18:00:00.000Z",
    prevHash: "",
    hash: "testhash",
    agent: "default",
    session: "ses_test",
    action: {
      type: "file.read" as ATFEntry["action"]["type"],
      target: "/home/user/test.txt",
      detail: "Read test file",
    },
    context: {
      goal: "Test goal",
      trigger: "test",
    },
    outcome: {
      status: "success",
    },
    risk: {
      score: 0,
      labels: [],
      autoFlagged: false,
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    sessionHistory: [],
    recentEntries: [],
    knownTargets: new Set<string>(),
    config: DEFAULT_CONFIG,
    ...overrides,
  };
}

function makeClaim(overrides: Partial<ClaimEntry> = {}): ClaimEntry {
  return {
    id: "01TESTCLAIM000000000000001",
    v: 1,
    ts: "2026-02-15T17:59:00.000Z",
    prevHash: "",
    hash: "claimhash",
    agent: "default",
    session: "ses_test",
    intent: {
      plannedAction: "file.read" as ClaimEntry["intent"]["plannedAction"],
      plannedTarget: "/home/user/config.yaml",
      goal: "Read config",
      expectedOutcome: "success",
      selfAssessedRisk: 2,
    },
    constraints: {
      withinScope: true,
      requiresElevation: false,
      involvesExternalComms: false,
      involvesFinancial: false,
    },
    ...overrides,
  };
}

describe("RuleEngine", () => {
  describe("constructor", () => {
    it("uses all builtin rules and default config when no args provided", () => {
      const engine = new RuleEngine();
      const rules = engine.getAllRules();
      expect(rules.length).toBe(14);
      const config = engine.getConfig();
      expect(config.riskThreshold).toBe(DEFAULT_CONFIG.riskThreshold);
      expect(config.maxActionsPerMinute).toBe(DEFAULT_CONFIG.maxActionsPerMinute);
    });

    it("accepts custom config overrides", () => {
      const engine = new RuleEngine(undefined, { riskThreshold: 3 });
      expect(engine.getConfig().riskThreshold).toBe(3);
    });
  });

  describe("getConfig", () => {
    it("returns a copy of the config", () => {
      const engine = new RuleEngine();
      const config1 = engine.getConfig();
      const config2 = engine.getConfig();
      expect(config1).toEqual(config2);
      // Mutating the returned copy should not affect the engine's internal config
      config1.riskThreshold = 999;
      expect(engine.getConfig().riskThreshold).toBe(DEFAULT_CONFIG.riskThreshold);
    });
  });

  describe("getAllRules", () => {
    it("returns all 14 builtin rules", () => {
      const engine = new RuleEngine();
      const rules = engine.getAllRules();
      expect(rules.length).toBe(14);

      const ruleIds = rules.map((r) => r.id);
      expect(ruleIds).toContain("fin-001");
      expect(ruleIds).toContain("fin-002");
      expect(ruleIds).toContain("cred-001");
      expect(ruleIds).toContain("cred-002");
      expect(ruleIds).toContain("cred-003");
      expect(ruleIds).toContain("comm-001");
      expect(ruleIds).toContain("comm-002");
      expect(ruleIds).toContain("esc-001");
      expect(ruleIds).toContain("esc-002");
      expect(ruleIds).toContain("exfil-001");
      expect(ruleIds).toContain("scope-001");
      expect(ruleIds).toContain("freq-001");
      expect(ruleIds).toContain("destr-001");
      expect(ruleIds).toContain("destr-002");
    });

    it("returns a copy (not the internal array)", () => {
      const engine = new RuleEngine();
      const rules1 = engine.getAllRules();
      rules1.pop();
      expect(engine.getAllRules().length).toBe(14);
    });
  });

  describe("getEnabledRules", () => {
    it("returns all rules when no overrides are set", () => {
      const engine = new RuleEngine();
      const enabled = engine.getEnabledRules();
      expect(enabled.length).toBe(14);
    });

    it("respects ruleOverrides to disable a rule", () => {
      const engine = new RuleEngine(undefined, {
        ruleOverrides: { "fin-001": false },
      });
      const enabled = engine.getEnabledRules();
      const enabledIds = enabled.map((r) => r.id);
      expect(enabledIds).not.toContain("fin-001");
      expect(enabled.length).toBe(13);
    });

    it("respects ruleOverrides to disable multiple rules", () => {
      const engine = new RuleEngine(undefined, {
        ruleOverrides: { "fin-001": false, "cred-001": false, "esc-002": false },
      });
      const enabled = engine.getEnabledRules();
      const enabledIds = enabled.map((r) => r.id);
      expect(enabledIds).not.toContain("fin-001");
      expect(enabledIds).not.toContain("cred-001");
      expect(enabledIds).not.toContain("esc-002");
      expect(enabled.length).toBe(11);
    });
  });

  describe("isRuleEnabled", () => {
    it("returns true for default-enabled rules", () => {
      const engine = new RuleEngine();
      expect(engine.isRuleEnabled("fin-001")).toBe(true);
      expect(engine.isRuleEnabled("cred-001")).toBe(true);
      expect(engine.isRuleEnabled("destr-002")).toBe(true);
    });

    it("returns false for unknown rule ids", () => {
      const engine = new RuleEngine();
      expect(engine.isRuleEnabled("nonexistent-999")).toBe(false);
      expect(engine.isRuleEnabled("")).toBe(false);
    });

    it("respects overrides to disable a rule", () => {
      const engine = new RuleEngine(undefined, {
        ruleOverrides: { "fin-001": false },
      });
      expect(engine.isRuleEnabled("fin-001")).toBe(false);
    });

    it("respects overrides to explicitly enable a rule", () => {
      const engine = new RuleEngine(undefined, {
        ruleOverrides: { "fin-001": true },
      });
      expect(engine.isRuleEnabled("fin-001")).toBe(true);
    });
  });

  describe("evaluate", () => {
    it("returns matches for a risky entry (payment.initiate)", () => {
      const engine = new RuleEngine();
      const entry = makeEntry({
        action: {
          type: "payment.initiate" as ATFEntry["action"]["type"],
          target: "stripe:checkout_abc",
          detail: "Initiated payment",
        },
      });
      const ctx = makeContext();
      const matches = engine.evaluate(entry, ctx);
      expect(matches.length).toBeGreaterThan(0);

      // Should at least trigger fin-001 (paymentDetected)
      const finMatch = matches.find((m) => m.ruleId === "fin-001");
      expect(finMatch).toBeDefined();
      expect(finMatch!.labels).toEqual(["financial"]);
    });

    it("returns empty array for a safe entry", () => {
      const engine = new RuleEngine();
      const entry = makeEntry({
        action: {
          type: "file.read" as ATFEntry["action"]["type"],
          target: "/home/user/readme.txt",
          detail: "Read readme",
        },
      });
      const ctx = makeContext();
      const matches = engine.evaluate(entry, ctx);
      expect(matches).toEqual([]);
    });

    it("does not evaluate disabled rules", () => {
      const engine = new RuleEngine(undefined, {
        ruleOverrides: { "fin-001": false },
      });
      const entry = makeEntry({
        action: {
          type: "payment.initiate" as ATFEntry["action"]["type"],
          target: "stripe:checkout_abc",
          detail: "Initiated payment",
        },
      });
      const ctx = makeContext();
      const matches = engine.evaluate(entry, ctx);
      const finMatch = matches.find((m) => m.ruleId === "fin-001");
      expect(finMatch).toBeUndefined();
    });

    it("returns multiple matches when multiple rules trigger", () => {
      const engine = new RuleEngine();
      const entry = makeEntry({
        action: {
          type: "file.delete" as ATFEntry["action"]["type"],
          target: "/home/user/.ssh/id_rsa",
          detail: "Deleted SSH key",
        },
      });
      const ctx = makeContext();
      const matches = engine.evaluate(entry, ctx);
      // destr-001 should trigger (file.delete of a sensitive path)
      const destrMatch = matches.find((m) => m.ruleId === "destr-001");
      expect(destrMatch).toBeDefined();
    });
  });

  describe("evaluateBatch", () => {
    it("processes multiple entries and returns a report", () => {
      const engine = new RuleEngine();
      const entries = [
        makeEntry({
          id: "01TESTENTRY000000000000001",
          ts: "2026-02-15T18:00:00.000Z",
          action: {
            type: "file.read" as ATFEntry["action"]["type"],
            target: "/home/user/readme.txt",
            detail: "Read readme",
          },
        }),
        makeEntry({
          id: "01TESTENTRY000000000000002",
          ts: "2026-02-15T18:00:01.000Z",
          action: {
            type: "payment.initiate" as ATFEntry["action"]["type"],
            target: "stripe:checkout_abc",
            detail: "Initiated payment",
          },
        }),
      ];
      const report = engine.evaluateBatch(entries);
      expect(report.entriesEvaluated).toBe(2);
      expect(report.totalMatches).toBeGreaterThan(0);
      // The payment entry should have at least one match
      expect(report.matches.length).toBeGreaterThanOrEqual(1);
    });

    it("tracks knownTargets across entries", () => {
      const engine = new RuleEngine();
      const entries = [
        makeEntry({
          id: "01TESTENTRY000000000000001",
          ts: "2026-02-15T18:00:00.000Z",
          action: {
            type: "message.send" as ATFEntry["action"]["type"],
            target: "user@example.com",
            detail: "First message to this contact",
          },
        }),
        makeEntry({
          id: "01TESTENTRY000000000000002",
          ts: "2026-02-15T18:00:01.000Z",
          action: {
            type: "message.send" as ATFEntry["action"]["type"],
            target: "user@example.com",
            detail: "Second message to same contact",
          },
        }),
      ];
      const report = engine.evaluateBatch(entries);

      // First entry should trigger comm-002 (unknown recipient)
      const firstEntryMatches = report.matches.find(
        (m) => m.entry.id === "01TESTENTRY000000000000001",
      );
      expect(firstEntryMatches).toBeDefined();
      const unknownMatch = firstEntryMatches?.ruleMatches.find(
        (m) => m.ruleId === "comm-002",
      );
      expect(unknownMatch).toBeDefined();

      // Second entry should NOT trigger comm-002 (target now known)
      const secondEntryMatches = report.matches.find(
        (m) => m.entry.id === "01TESTENTRY000000000000002",
      );
      if (secondEntryMatches) {
        const secondUnknownMatch = secondEntryMatches.ruleMatches.find(
          (m) => m.ruleId === "comm-002",
        );
        expect(secondUnknownMatch).toBeUndefined();
      }
    });

    it("pairs claims with entries via claimId in meta", () => {
      const engine = new RuleEngine();
      const claim = makeClaim({
        id: "01TESTCLAIM000000000000001",
        constraints: {
          withinScope: true,
          requiresElevation: false,
          involvesExternalComms: false,
          involvesFinancial: false,
        },
      });
      const entries = [
        makeEntry({
          id: "01TESTENTRY000000000000001",
          ts: "2026-02-15T18:00:00.000Z",
          action: {
            type: "elevated.enable" as ATFEntry["action"]["type"],
            target: "host",
            detail: "Enabled elevated mode",
          },
          meta: { claimId: "01TESTCLAIM000000000000001" },
        }),
      ];
      const report = engine.evaluateBatch(entries, [claim]);

      // Should trigger scope-001 because the claim says withinScope=true
      // but the action is elevated.enable
      const entryMatches = report.matches.find(
        (m) => m.entry.id === "01TESTENTRY000000000000001",
      );
      expect(entryMatches).toBeDefined();
      const scopeMatch = entryMatches?.ruleMatches.find(
        (m) => m.ruleId === "scope-001",
      );
      expect(scopeMatch).toBeDefined();
    });

    it("returns zero matches for safe entries", () => {
      const engine = new RuleEngine();
      const entries = [
        makeEntry({
          id: "01TESTENTRY000000000000001",
          ts: "2026-02-15T18:00:00.000Z",
          action: {
            type: "file.read" as ATFEntry["action"]["type"],
            target: "/home/user/readme.txt",
            detail: "Read readme",
          },
        }),
      ];
      const report = engine.evaluateBatch(entries);
      expect(report.entriesEvaluated).toBe(1);
      expect(report.totalMatches).toBe(0);
      expect(report.matches).toEqual([]);
    });

    it("correctly aggregates matchesBySeverity", () => {
      const engine = new RuleEngine();
      const entries = [
        makeEntry({
          id: "01TESTENTRY000000000000001",
          ts: "2026-02-15T18:00:00.000Z",
          action: {
            type: "payment.initiate" as ATFEntry["action"]["type"],
            target: "stripe:checkout_abc",
            detail: "Initiated payment",
          },
        }),
      ];
      const report = engine.evaluateBatch(entries);
      expect(report.matchesBySeverity.low).toBeGreaterThanOrEqual(0);
      expect(report.matchesBySeverity.medium).toBeGreaterThanOrEqual(0);
      expect(report.matchesBySeverity.high).toBeGreaterThanOrEqual(0);
      expect(report.matchesBySeverity.critical).toBeGreaterThanOrEqual(0);
      // fin-001 has severity "high"
      expect(report.matchesBySeverity.high).toBeGreaterThanOrEqual(1);
    });

    it("correctly aggregates matchesByCategory", () => {
      const engine = new RuleEngine();
      const entries = [
        makeEntry({
          id: "01TESTENTRY000000000000001",
          ts: "2026-02-15T18:00:00.000Z",
          action: {
            type: "payment.initiate" as ATFEntry["action"]["type"],
            target: "stripe:checkout_abc",
            detail: "Initiated payment",
          },
        }),
      ];
      const report = engine.evaluateBatch(entries);
      expect(report.matchesByCategory["financial"]).toBeGreaterThanOrEqual(1);
    });
  });

  describe("updateConfig", () => {
    it("changes the config", () => {
      const engine = new RuleEngine();
      expect(engine.getConfig().riskThreshold).toBe(7);
      engine.updateConfig({ riskThreshold: 3 });
      expect(engine.getConfig().riskThreshold).toBe(3);
    });

    it("merges partial config with existing config", () => {
      const engine = new RuleEngine();
      engine.updateConfig({ maxActionsPerMinute: 10 });
      const config = engine.getConfig();
      expect(config.maxActionsPerMinute).toBe(10);
      // Other fields should remain unchanged
      expect(config.riskThreshold).toBe(DEFAULT_CONFIG.riskThreshold);
      expect(config.sensitivePathPatterns).toEqual(DEFAULT_CONFIG.sensitivePathPatterns);
    });

    it("updates ruleOverrides", () => {
      const engine = new RuleEngine();
      expect(engine.isRuleEnabled("fin-001")).toBe(true);
      engine.updateConfig({ ruleOverrides: { "fin-001": false } });
      expect(engine.isRuleEnabled("fin-001")).toBe(false);
    });
  });
});
