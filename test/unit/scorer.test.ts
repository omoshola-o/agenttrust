import { describe, it, expect } from "vitest";
import { computeConsistencyScore } from "../../src/consistency/scorer.js";
import type { ConsistencyFinding } from "../../src/consistency/types.js";

function makeFinding(type: ConsistencyFinding["type"], severity: ConsistencyFinding["severity"]): ConsistencyFinding {
  return {
    type,
    severity,
    description: "test finding",
    details: {},
  };
}

describe("computeConsistencyScore", () => {
  it("returns 100 for no findings", () => {
    expect(computeConsistencyScore([])).toBe(100);
  });

  it("penalizes unclaimed execution (info: -2)", () => {
    const findings = [makeFinding("unclaimed_execution", "info")];
    expect(computeConsistencyScore(findings)).toBe(98);
  });

  it("penalizes unclaimed execution (warning: -5)", () => {
    const findings = [makeFinding("unclaimed_execution", "warning")];
    expect(computeConsistencyScore(findings)).toBe(95);
  });

  it("penalizes unfulfilled claim (-3)", () => {
    const findings = [makeFinding("unfulfilled_claim", "warning")];
    expect(computeConsistencyScore(findings)).toBe(97);
  });

  it("penalizes target mismatch (critical: -10)", () => {
    const findings = [makeFinding("target_mismatch", "critical")];
    expect(computeConsistencyScore(findings)).toBe(90);
  });

  it("penalizes target mismatch (warning: -5)", () => {
    const findings = [makeFinding("target_mismatch", "warning")];
    expect(computeConsistencyScore(findings)).toBe(95);
  });

  it("penalizes action type mismatch (-15)", () => {
    const findings = [makeFinding("action_type_mismatch", "critical")];
    expect(computeConsistencyScore(findings)).toBe(85);
  });

  it("penalizes risk underestimate (-5)", () => {
    const findings = [makeFinding("risk_underestimate", "warning")];
    expect(computeConsistencyScore(findings)).toBe(95);
  });

  it("penalizes scope violation (-15)", () => {
    const findings = [makeFinding("scope_violation", "critical")];
    expect(computeConsistencyScore(findings)).toBe(85);
  });

  it("penalizes escalation undeclared (-20)", () => {
    const findings = [makeFinding("escalation_undeclared", "critical")];
    expect(computeConsistencyScore(findings)).toBe(80);
  });

  it("penalizes outcome unexpected (-1)", () => {
    const findings = [makeFinding("outcome_unexpected", "info")];
    expect(computeConsistencyScore(findings)).toBe(99);
  });

  it("floors at 0 for many findings", () => {
    const findings = Array(20).fill(makeFinding("escalation_undeclared", "critical"));
    expect(computeConsistencyScore(findings)).toBe(0);
  });

  it("accumulates penalties from multiple findings", () => {
    const findings = [
      makeFinding("unclaimed_execution", "warning"),
      makeFinding("target_mismatch", "critical"),
      makeFinding("outcome_unexpected", "info"),
    ];
    // -5 + -10 + -1 = -16
    expect(computeConsistencyScore(findings)).toBe(84);
  });
});
