import { describe, it, expect, beforeAll } from "vitest";
import chalk from "chalk";
import {
  formatCorrelationReport,
  formatTrustVerdict,
} from "../../cli/formatters/table.js";
import { colorizeTrustLevel } from "../../cli/formatters/color.js";
import type { CorrelationReport, TrustVerdict, TrustLevel } from "../../src/correlation/types.js";

beforeAll(() => {
  chalk.level = 0;
});

function makeReport(overrides: Partial<CorrelationReport> = {}): CorrelationReport {
  return {
    timeRange: {
      from: "2026-02-15T00:00:00.000Z",
      to: "2026-02-16T00:00:00.000Z",
    },
    matches: [],
    findings: [],
    summary: {
      totalWitnessEvents: 10,
      totalExecutionEntries: 8,
      correlatedPairs: 7,
      unwitnessedExecutions: 1,
      unloggedObservations: 2,
      mismatchedPairs: 0,
      backgroundNoise: 0,
      infrastructureTraffic: 0,
    },
    witnessConfidence: 90,
    ...overrides,
  };
}

function makeVerdict(overrides: Partial<TrustVerdict> = {}): TrustVerdict {
  return {
    trustScore: 95,
    level: "verified" as TrustLevel,
    components: {
      integrity: 100,
      consistency: 100,
      witnessConfidence: 85,
    },
    explanation: "All components are healthy.",
    ...overrides,
  };
}

describe("formatCorrelationReport", () => {
  it("includes period header", () => {
    const output = formatCorrelationReport(makeReport(), false);
    expect(output).toContain("AgentTrust Correlation Report");
    expect(output).toContain("Period:");
  });

  it("includes summary counts", () => {
    const output = formatCorrelationReport(makeReport(), false);
    expect(output).toContain("Witness Events");
    expect(output).toContain("Execution Entries");
    expect(output).toContain("Correlated Pairs");
    expect(output).toContain("Unwitnessed Executions");
    expect(output).toContain("Unlogged Observations");
    expect(output).toContain("Mismatched Pairs");
    expect(output).toContain("Infrastructure Traffic");
  });

  it("includes witness confidence score", () => {
    const output = formatCorrelationReport(makeReport({ witnessConfidence: 85 }), false);
    expect(output).toContain("Witness Confidence:");
    expect(output).toContain("85/100");
  });

  it("shows no-findings message when there are no findings", () => {
    const output = formatCorrelationReport(makeReport({ findings: [] }), false);
    expect(output).toContain("No findings");
  });

  it("shows findings when present", () => {
    const report = makeReport({
      findings: [
        {
          type: "phantom_process",
          severity: "critical",
          description: "exec.command with no witness",
          execution: {
            id: "01TESTEXEC000000000000001",
            v: 1,
            ts: "2026-02-15T12:00:00.000Z",
            prevHash: "",
            hash: "h1",
            agent: "default",
            session: "ses_test",
            action: { type: "exec.command", target: "rm -rf /tmp", detail: "Delete" },
            context: { goal: "Clean up", trigger: "chain" },
            outcome: { status: "success" },
            risk: { score: 8, labels: ["execution"], autoFlagged: true },
          },
        },
      ],
    });
    const output = formatCorrelationReport(report, false);
    expect(output).toContain("Findings (1)");
    expect(output).toContain("phantom_process");
    expect(output).toContain("CRITICAL");
  });

  it("shows matched pairs table when showMatches is true", () => {
    const report = makeReport({
      matches: [
        {
          witnessEntry: {
            id: "01TESTWITNESS0000000000001",
            v: 1,
            ts: "2026-02-15T12:00:00.000Z",
            prevHash: "",
            hash: "wh1",
            source: "filesystem",
            event: {
              type: "file_created",
              path: "/tmp/test.txt",
              observedAt: "2026-02-15T12:00:00.000Z",
            },
            correlated: true,
          },
          executionEntry: {
            id: "01TESTEXEC000000000000001",
            v: 1,
            ts: "2026-02-15T12:00:01.000Z",
            prevHash: "",
            hash: "eh1",
            agent: "default",
            session: "ses_test",
            action: { type: "file.write", target: "/tmp/test.txt", detail: "Write" },
            context: { goal: "Create file", trigger: "chain" },
            outcome: { status: "success" },
            risk: { score: 1, labels: [], autoFlagged: false },
          },
          confidence: 95,
          discrepancies: [],
        },
      ],
    });
    const withMatches = formatCorrelationReport(report, true);
    expect(withMatches).toContain("Matched Pairs (1)");
    expect(withMatches).toContain("Confidence");

    const withoutMatches = formatCorrelationReport(report, false);
    expect(withoutMatches).not.toContain("Matched Pairs");
  });

  it("shows filtered note when backgroundNoise > 0", () => {
    const output = formatCorrelationReport(
      makeReport({ summary: { ...makeReport().summary, backgroundNoise: 5 } }),
      false,
    );
    expect(output).toContain("5 background");
    expect(output).toContain("event(s) filtered");
  });

  it("shows filtered note when infrastructureTraffic > 0", () => {
    const output = formatCorrelationReport(
      makeReport({ summary: { ...makeReport().summary, infrastructureTraffic: 3 } }),
      false,
    );
    expect(output).toContain("3 infrastructure");
    expect(output).toContain("event(s) filtered");
  });

  it("shows combined filtered note when both > 0", () => {
    const output = formatCorrelationReport(
      makeReport({
        summary: { ...makeReport().summary, backgroundNoise: 5, infrastructureTraffic: 3 },
      }),
      false,
    );
    expect(output).toContain("5 background");
    expect(output).toContain("3 infrastructure");
    expect(output).toContain("event(s) filtered");
  });

  it("does not show filtered note when both are 0", () => {
    const output = formatCorrelationReport(
      makeReport({ summary: { ...makeReport().summary, backgroundNoise: 0, infrastructureTraffic: 0 } }),
      false,
    );
    expect(output).not.toContain("event(s) filtered");
  });

  it("includes Background Noise row in summary table", () => {
    const output = formatCorrelationReport(
      makeReport({ summary: { ...makeReport().summary, backgroundNoise: 3 } }),
      false,
    );
    expect(output).toContain("Background Noise");
  });
});

describe("formatTrustVerdict", () => {
  it("includes trust verdict header and period", () => {
    const output = formatTrustVerdict(makeVerdict(), "24h");
    expect(output).toContain("AgentTrust Trust Verdict");
    expect(output).toContain("Period: last 24h");
  });

  it("includes trust score and level", () => {
    const output = formatTrustVerdict(makeVerdict({ trustScore: 95, level: "verified" }), "1h");
    expect(output).toContain("TRUST SCORE: 95/100");
    expect(output).toContain("VERIFIED");
  });

  it("includes component scores", () => {
    const output = formatTrustVerdict(
      makeVerdict({
        components: { integrity: 100, consistency: 90, witnessConfidence: 80 },
      }),
      "24h",
    );
    expect(output).toContain("Integrity (hash chains)");
    expect(output).toContain("100");
    expect(output).toContain("Consistency (intent)");
    expect(output).toContain("90");
    expect(output).toContain("Witness (independent)");
    expect(output).toContain("80");
  });

  it("shows all-chains-intact for integrity 100", () => {
    const output = formatTrustVerdict(
      makeVerdict({ components: { integrity: 100, consistency: 100, witnessConfidence: 100 } }),
      "24h",
    );
    expect(output).toContain("All chains intact");
  });

  it("shows integrity-failed for integrity 0", () => {
    const output = formatTrustVerdict(
      makeVerdict({ components: { integrity: 0, consistency: 100, witnessConfidence: 100 } }),
      "24h",
    );
    expect(output).toContain("Integrity verification failed");
  });

  it("shows minor-inconsistencies for consistency between 70 and 95", () => {
    const output = formatTrustVerdict(
      makeVerdict({ components: { integrity: 100, consistency: 80, witnessConfidence: 100 } }),
      "24h",
    );
    expect(output).toContain("Minor inconsistencies");
  });

  it("shows significant-mismatches for consistency below 70", () => {
    const output = formatTrustVerdict(
      makeVerdict({ components: { integrity: 100, consistency: 50, witnessConfidence: 100 } }),
      "24h",
    );
    expect(output).toContain("Significant mismatches");
  });

  it("shows fully-corroborated for witness confidence >= 95", () => {
    const output = formatTrustVerdict(
      makeVerdict({ components: { integrity: 100, consistency: 100, witnessConfidence: 95 } }),
      "24h",
    );
    expect(output).toContain("Fully corroborated");
  });

  it("shows some-uncorroborated for witness confidence between 70 and 95", () => {
    const output = formatTrustVerdict(
      makeVerdict({ components: { integrity: 100, consistency: 100, witnessConfidence: 80 } }),
      "24h",
    );
    expect(output).toContain("Some uncorroborated actions");
  });

  it("shows significant-witness-concerns for witness confidence below 70", () => {
    const output = formatTrustVerdict(
      makeVerdict({ components: { integrity: 100, consistency: 100, witnessConfidence: 50 } }),
      "24h",
    );
    expect(output).toContain("Significant witness concerns");
  });

  it("includes explanation text", () => {
    const output = formatTrustVerdict(
      makeVerdict({ explanation: "Custom explanation for testing." }),
      "24h",
    );
    expect(output).toContain("Explanation:");
    expect(output).toContain("Custom explanation for testing.");
  });

  it("handles all trust levels", () => {
    const levels: TrustLevel[] = ["verified", "high", "moderate", "low", "untrusted"];
    for (const level of levels) {
      const output = formatTrustVerdict(makeVerdict({ level }), "24h");
      expect(output).toContain(level.toUpperCase());
    }
  });
});

describe("colorizeTrustLevel", () => {
  it("returns text for all trust levels without chalk colors", () => {
    const levels: TrustLevel[] = ["verified", "high", "moderate", "low", "untrusted"];
    for (const level of levels) {
      const result = colorizeTrustLevel(level, `score-${level}`);
      expect(result).toContain(`score-${level}`);
    }
  });
});
