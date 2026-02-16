import { describe, it, expect } from "vitest";
import { computeWitnessConfidence } from "../../src/correlation/scorer.js";
import type { WitnessConfidenceContext } from "../../src/correlation/scorer.js";
import type { CorrelationFinding } from "../../src/correlation/types.js";

function makeFinding(overrides: {
  type: CorrelationFinding["type"];
  severity: CorrelationFinding["severity"];
  details?: Record<string, unknown>;
}): CorrelationFinding {
  return {
    type: overrides.type,
    severity: overrides.severity,
    description: `Test finding: ${overrides.type}`,
    details: overrides.details ?? {},
  };
}

function makeContext(overrides: Partial<WitnessConfidenceContext> = {}): WitnessConfidenceContext {
  return {
    totalWitnessEvents: 100,
    totalExecutionEntries: 50,
    correlatedPairs: 40,
    backgroundNoise: 0,
    infrastructureTraffic: 0,
    ...overrides,
  };
}

// ─── Legacy mode (no context) ─────────────────────────────────────

describe("correlation-scorer", () => {
  describe("legacy mode (no context)", () => {
    it("returns 100 when there are no findings", () => {
      expect(computeWitnessConfidence([])).toBe(100);
    });

    it("applies -5 penalty for unwitnessed_execution warning", () => {
      const findings = [makeFinding({ type: "unwitnessed_execution", severity: "warning" })];
      expect(computeWitnessConfidence(findings)).toBe(95);
    });

    it("applies -10 penalty for unwitnessed_execution critical", () => {
      const findings = [makeFinding({ type: "unwitnessed_execution", severity: "critical" })];
      expect(computeWitnessConfidence(findings)).toBe(90);
    });

    it("applies -20 penalty for phantom_process", () => {
      const findings = [makeFinding({ type: "phantom_process", severity: "critical" })];
      expect(computeWitnessConfidence(findings)).toBe(80);
    });

    it("applies -15 penalty for target_discrepancy", () => {
      const findings = [makeFinding({ type: "target_discrepancy", severity: "critical" })];
      expect(computeWitnessConfidence(findings)).toBe(85);
    });

    it("applies -10 penalty for evidence_mismatch", () => {
      const findings = [makeFinding({ type: "evidence_mismatch", severity: "warning" })];
      expect(computeWitnessConfidence(findings)).toBe(90);
    });

    it("applies -2 penalty for unlogged_observation info", () => {
      const findings = [makeFinding({ type: "unlogged_observation", severity: "info" })];
      expect(computeWitnessConfidence(findings)).toBe(98);
    });

    it("applies -5 penalty for unlogged_observation warning", () => {
      const findings = [makeFinding({ type: "unlogged_observation", severity: "warning" })];
      expect(computeWitnessConfidence(findings)).toBe(95);
    });

    it("applies -1 penalty for timing_discrepancy info", () => {
      const findings = [makeFinding({ type: "timing_discrepancy", severity: "info" })];
      expect(computeWitnessConfidence(findings)).toBe(99);
    });

    it("applies -5 penalty for timing_discrepancy critical", () => {
      const findings = [makeFinding({ type: "timing_discrepancy", severity: "critical" })];
      expect(computeWitnessConfidence(findings)).toBe(95);
    });

    it("applies -5 penalty for silent_network warning", () => {
      const findings = [makeFinding({ type: "silent_network", severity: "warning" })];
      expect(computeWitnessConfidence(findings)).toBe(95);
    });

    it("applies -10 penalty for silent_network critical", () => {
      const findings = [makeFinding({ type: "silent_network", severity: "critical" })];
      expect(computeWitnessConfidence(findings)).toBe(90);
    });

    it("applies -10 penalty for sensitive silent_file_access", () => {
      const findings = [
        makeFinding({
          type: "silent_file_access",
          severity: "warning",
          details: { sensitive: true },
        }),
      ];
      expect(computeWitnessConfidence(findings)).toBe(90);
    });

    it("applies -5 penalty for non-sensitive silent_file_access", () => {
      const findings = [
        makeFinding({
          type: "silent_file_access",
          severity: "warning",
          details: { sensitive: false },
        }),
      ];
      expect(computeWitnessConfidence(findings)).toBe(95);
    });

    it("stacks penalties from multiple findings", () => {
      const findings = [
        makeFinding({ type: "phantom_process", severity: "critical" }),   // -20
        makeFinding({ type: "unwitnessed_execution", severity: "warning" }), // -5
        makeFinding({ type: "evidence_mismatch", severity: "warning" }),     // -10
        makeFinding({ type: "target_discrepancy", severity: "critical" }),   // -15
      ];
      // 100 - 20 - 5 - 10 - 15 = 50
      expect(computeWitnessConfidence(findings)).toBe(50);
    });

    it("floors at 0 when penalties exceed 100", () => {
      const findings: CorrelationFinding[] = [];
      // 6 phantom_process findings = 6 * 20 = 120 penalty
      for (let i = 0; i < 6; i++) {
        findings.push(makeFinding({ type: "phantom_process", severity: "critical" }));
      }
      expect(computeWitnessConfidence(findings)).toBe(0);
    });

    it("handles many small penalties accumulating", () => {
      const findings: CorrelationFinding[] = [];
      // 10 unlogged_observation info = 10 * 2 = 20 penalty
      for (let i = 0; i < 10; i++) {
        findings.push(makeFinding({ type: "unlogged_observation", severity: "info" }));
      }
      // 100 - 20 = 80
      expect(computeWitnessConfidence(findings)).toBe(80);
    });
  });

  // ─── Proportional mode (with context) ────────────────────────────

  describe("proportional mode (with context)", () => {
    describe("edge cases", () => {
      it("returns 100 when no agent events and no executions", () => {
        const ctx = makeContext({
          totalWitnessEvents: 0,
          totalExecutionEntries: 0,
          correlatedPairs: 0,
        });
        expect(computeWitnessConfidence([], ctx)).toBe(100);
      });

      it("returns 100 when all events are background/infrastructure and no executions", () => {
        const ctx = makeContext({
          totalWitnessEvents: 2000,
          totalExecutionEntries: 0,
          correlatedPairs: 0,
          backgroundNoise: 1500,
          infrastructureTraffic: 500,
        });
        expect(computeWitnessConfidence([], ctx)).toBe(100);
      });

      it("returns 50 when no agent events but executions exist", () => {
        const ctx = makeContext({
          totalWitnessEvents: 0,
          totalExecutionEntries: 10,
          correlatedPairs: 0,
        });
        expect(computeWitnessConfidence([], ctx)).toBe(50);
      });

      it("returns 50 when all witness events are noise but executions exist", () => {
        const ctx = makeContext({
          totalWitnessEvents: 1000,
          totalExecutionEntries: 20,
          correlatedPairs: 0,
          backgroundNoise: 600,
          infrastructureTraffic: 400,
        });
        // totalAgentEvents = 1000 - 600 - 400 = 0, but executions > 0
        expect(computeWitnessConfidence([], ctx)).toBe(50);
      });
    });

    describe("noise tolerance (under 5% unmatched)", () => {
      it("returns 100 with zero findings and healthy context", () => {
        const ctx = makeContext({
          totalWitnessEvents: 100,
          totalExecutionEntries: 50,
          correlatedPairs: 50,
        });
        expect(computeWitnessConfidence([], ctx)).toBe(100);
      });

      it("returns 100 when unmatched ratio is under 5%", () => {
        // 2 warning findings out of 100 agent events = 2% unmatched → no penalty
        const findings = [
          makeFinding({ type: "silent_network", severity: "warning" }),
          makeFinding({ type: "silent_network", severity: "warning" }),
        ];
        const ctx = makeContext({
          totalWitnessEvents: 100,
          totalExecutionEntries: 50,
          correlatedPairs: 48,
        });
        // 2/100 = 2% < 5% → no proportional penalty, no critical types → 100
        expect(computeWitnessConfidence(findings, ctx)).toBe(100);
      });

      it("treats info-severity findings as not-unmatched", () => {
        // 10 info findings shouldn't count toward unmatched ratio
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 10; i++) {
          findings.push(makeFinding({ type: "unlogged_observation", severity: "info" }));
        }
        const ctx = makeContext({
          totalWitnessEvents: 50,
          totalExecutionEntries: 20,
          correlatedPairs: 15,
        });
        // info findings don't count toward unmatchedCount → 0% → 100
        expect(computeWitnessConfidence(findings, ctx)).toBe(100);
      });
    });

    describe("moderate penalty (5-20% unmatched)", () => {
      it("applies linear penalty for 10% unmatched ratio", () => {
        // 10 warning findings out of 100 agent events = 10%
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 10; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        const ctx = makeContext({
          totalWitnessEvents: 100,
          totalExecutionEntries: 50,
          correlatedPairs: 40,
        });
        // unmatchedRatio = 10/100 = 0.10 → penalty = 0.10 * 100 = 10
        // score = 100 - 10 = 90
        expect(computeWitnessConfidence(findings, ctx)).toBe(90);
      });

      it("applies linear penalty for 20% unmatched ratio", () => {
        // 20 warning findings out of 100 agent events = 20%
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 20; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        const ctx = makeContext({
          totalWitnessEvents: 100,
          totalExecutionEntries: 50,
          correlatedPairs: 30,
        });
        // unmatchedRatio = 20/100 = 0.20 → penalty = 0.20 * 100 = 20
        // score = 100 - 20 = 80
        expect(computeWitnessConfidence(findings, ctx)).toBe(80);
      });

      it("correctly subtracts background/infra from agent event count", () => {
        // 5 warning findings, but only 50 agent events (150 total - 50 bg - 50 infra)
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 5; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        const ctx = makeContext({
          totalWitnessEvents: 150,
          totalExecutionEntries: 50,
          correlatedPairs: 30,
          backgroundNoise: 50,
          infrastructureTraffic: 50,
        });
        // totalAgentEvents = 150 - 50 - 50 = 50
        // unmatchedRatio = 5/50 = 0.10 → penalty = 0.10 * 100 = 10
        // score = 100 - 10 = 90
        expect(computeWitnessConfidence(findings, ctx)).toBe(90);
      });
    });

    describe("high penalty (over 20% unmatched)", () => {
      it("applies accelerated penalty for 30% unmatched ratio", () => {
        // 30 warning findings out of 100 agent events = 30%
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 30; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        const ctx = makeContext({
          totalWitnessEvents: 100,
          totalExecutionEntries: 50,
          correlatedPairs: 20,
        });
        // unmatchedRatio = 30/100 = 0.30 → penalty = 20 + (0.30 - 0.20) * 200 = 20 + 20 = 40
        // score = 100 - 40 = 60
        expect(computeWitnessConfidence(findings, ctx)).toBe(60);
      });

      it("applies heavy penalty for 60% unmatched ratio", () => {
        // 30 warning findings out of 50 agent events = 60%
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 30; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        const ctx = makeContext({
          totalWitnessEvents: 50,
          totalExecutionEntries: 20,
          correlatedPairs: 10,
        });
        // unmatchedRatio = 30/50 = 0.60 → penalty = 20 + (0.60 - 0.20) * 200 = 20 + 80 = 100
        // score = 100 - 100 = 0
        expect(computeWitnessConfidence(findings, ctx)).toBe(0);
      });

      it("floors at 0 for extreme unmatched ratio", () => {
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 40; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        const ctx = makeContext({
          totalWitnessEvents: 40,
          totalExecutionEntries: 5,
          correlatedPairs: 0,
        });
        // unmatchedRatio = 40/40 = 1.0 → penalty = 20 + (1.0 - 0.20) * 200 = 20 + 160 = 180
        // score = 100 - 180 → floor at 0
        expect(computeWitnessConfidence(findings, ctx)).toBe(0);
      });
    });

    describe("critical finding fixed penalties", () => {
      it("applies -15 fixed penalty for phantom_process", () => {
        // 1 phantom_process is critical type and also a warning/critical severity finding
        const findings = [makeFinding({ type: "phantom_process", severity: "critical" })];
        const ctx = makeContext({
          totalWitnessEvents: 100,
          totalExecutionEntries: 50,
          correlatedPairs: 49,
        });
        // unmatchedRatio = 1/100 = 1% → under 5% → no proportional penalty
        // fixed penalty = 15
        // score = 100 - 15 = 85
        expect(computeWitnessConfidence(findings, ctx)).toBe(85);
      });

      it("applies -15 fixed penalty for evidence_mismatch", () => {
        const findings = [makeFinding({ type: "evidence_mismatch", severity: "warning" })];
        const ctx = makeContext({
          totalWitnessEvents: 100,
          totalExecutionEntries: 50,
          correlatedPairs: 49,
        });
        // unmatchedRatio = 1/100 = 1% → no proportional penalty
        // fixed penalty = 15
        // score = 100 - 15 = 85
        expect(computeWitnessConfidence(findings, ctx)).toBe(85);
      });

      it("stacks multiple critical finding penalties", () => {
        const findings = [
          makeFinding({ type: "phantom_process", severity: "critical" }),
          makeFinding({ type: "phantom_process", severity: "critical" }),
          makeFinding({ type: "evidence_mismatch", severity: "warning" }),
        ];
        const ctx = makeContext({
          totalWitnessEvents: 100,
          totalExecutionEntries: 50,
          correlatedPairs: 47,
        });
        // unmatchedRatio = 3/100 = 3% → under 5% → no proportional penalty
        // fixed penalty = 15 * 3 = 45
        // score = 100 - 45 = 55
        expect(computeWitnessConfidence(findings, ctx)).toBe(55);
      });

      it("combines proportional and critical penalties", () => {
        // 10 silent_network warnings + 1 phantom_process out of 100 agent events
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 10; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        findings.push(makeFinding({ type: "phantom_process", severity: "critical" }));
        const ctx = makeContext({
          totalWitnessEvents: 100,
          totalExecutionEntries: 50,
          correlatedPairs: 39,
        });
        // unmatchedCount = 11 (all are warning/critical)
        // unmatchedRatio = 11/100 = 0.11 → penalty = 0.11 * 100 = 11
        // fixed penalty for phantom_process = 15
        // total = 11 + 15 = 26
        // score = 100 - 26 = 74
        expect(computeWitnessConfidence(findings, ctx)).toBe(74);
      });
    });

    describe("real-world scenarios", () => {
      it("scenario: 2000 events, 1950 filtered, 2/50 unmatched → high confidence", () => {
        const findings = [
          makeFinding({ type: "silent_network", severity: "warning" }),
          makeFinding({ type: "silent_network", severity: "warning" }),
        ];
        const ctx = makeContext({
          totalWitnessEvents: 2000,
          totalExecutionEntries: 30,
          correlatedPairs: 28,
          backgroundNoise: 1500,
          infrastructureTraffic: 450,
        });
        // totalAgentEvents = 2000 - 1500 - 450 = 50
        // unmatchedRatio = 2/50 = 4% → under 5% → no penalty
        // score = 100
        expect(computeWitnessConfidence(findings, ctx)).toBe(100);
      });

      it("scenario: 2000 events, 1950 filtered, 30/50 unmatched → significant penalty", () => {
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 30; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        const ctx = makeContext({
          totalWitnessEvents: 2000,
          totalExecutionEntries: 15,
          correlatedPairs: 5,
          backgroundNoise: 1500,
          infrastructureTraffic: 450,
        });
        // totalAgentEvents = 2000 - 1500 - 450 = 50
        // unmatchedRatio = 30/50 = 0.60 → penalty = 20 + (0.60 - 0.20) * 200 = 100
        // score = 100 - 100 = 0
        expect(computeWitnessConfidence(findings, ctx)).toBe(0);
      });

      it("scenario: healthy workspace with a few minor timing issues", () => {
        const findings = [
          makeFinding({ type: "timing_discrepancy", severity: "info" }),
          makeFinding({ type: "timing_discrepancy", severity: "info" }),
          makeFinding({ type: "timing_discrepancy", severity: "info" }),
        ];
        const ctx = makeContext({
          totalWitnessEvents: 200,
          totalExecutionEntries: 80,
          correlatedPairs: 77,
          backgroundNoise: 80,
          infrastructureTraffic: 40,
        });
        // totalAgentEvents = 200 - 80 - 40 = 80
        // info findings don't count toward unmatched → 0%
        // score = 100
        expect(computeWitnessConfidence(findings, ctx)).toBe(100);
      });

      it("scenario: phantom process detected among otherwise clean activity", () => {
        const findings = [
          makeFinding({ type: "phantom_process", severity: "critical" }),
        ];
        const ctx = makeContext({
          totalWitnessEvents: 500,
          totalExecutionEntries: 100,
          correlatedPairs: 99,
          backgroundNoise: 300,
          infrastructureTraffic: 100,
        });
        // totalAgentEvents = 500 - 300 - 100 = 100
        // unmatchedRatio = 1/100 = 1% → no proportional penalty
        // fixed penalty = 15
        // score = 100 - 15 = 85
        expect(computeWitnessConfidence(findings, ctx)).toBe(85);
      });

      it("scenario: mostly infrastructure with few agent events that are all matched", () => {
        const ctx = makeContext({
          totalWitnessEvents: 5000,
          totalExecutionEntries: 10,
          correlatedPairs: 10,
          backgroundNoise: 2000,
          infrastructureTraffic: 2990,
        });
        // totalAgentEvents = 5000 - 2000 - 2990 = 10
        // no findings → score = 100
        expect(computeWitnessConfidence([], ctx)).toBe(100);
      });
    });

    describe("boundary conditions", () => {
      it("exactly 5% boundary: no penalty", () => {
        // 4 out of 100 = 4% → just under 5% → no penalty
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 4; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        const ctx = makeContext({ totalWitnessEvents: 100 });
        // 4/100 = 4% < 5% → no penalty
        expect(computeWitnessConfidence(findings, ctx)).toBe(100);
      });

      it("just over 5% boundary: penalty applied", () => {
        // 6 out of 100 = 6% → over 5% → linear penalty
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 6; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        const ctx = makeContext({ totalWitnessEvents: 100 });
        // 6/100 = 0.06 → penalty = 0.06 * 100 = 6
        // score = 100 - 6 = 94
        expect(computeWitnessConfidence(findings, ctx)).toBe(94);
      });

      it("exactly 20% boundary: still linear", () => {
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 20; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        const ctx = makeContext({ totalWitnessEvents: 100 });
        // 20/100 = 0.20 → penalty = 0.20 * 100 = 20
        // score = 100 - 20 = 80
        expect(computeWitnessConfidence(findings, ctx)).toBe(80);
      });

      it("just over 20% boundary: accelerated penalty", () => {
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 21; i++) {
          findings.push(makeFinding({ type: "silent_network", severity: "warning" }));
        }
        const ctx = makeContext({ totalWitnessEvents: 100 });
        // 21/100 = 0.21 → penalty = 20 + (0.21 - 0.20) * 200 = 20 + 2 = 22
        // score = 100 - 22 = 78
        expect(computeWitnessConfidence(findings, ctx)).toBe(78);
      });

      it("score is capped at 100 (never exceeds)", () => {
        const ctx = makeContext({
          totalWitnessEvents: 1000,
          totalExecutionEntries: 500,
          correlatedPairs: 500,
        });
        expect(computeWitnessConfidence([], ctx)).toBe(100);
      });

      it("score floors at 0 (never negative)", () => {
        const findings: CorrelationFinding[] = [];
        for (let i = 0; i < 10; i++) {
          findings.push(makeFinding({ type: "phantom_process", severity: "critical" }));
        }
        const ctx = makeContext({ totalWitnessEvents: 10 });
        // fixed penalty = 10 * 15 = 150
        // score = 100 - 150 → floor at 0
        expect(computeWitnessConfidence(findings, ctx)).toBe(0);
      });
    });
  });
});
