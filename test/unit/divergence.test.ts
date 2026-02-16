import { describe, it, expect } from "vitest";
import { detectDivergences } from "../../src/consistency/divergence.js";
import { createClaim } from "../../src/ledger/claim.js";
import { createEntry } from "../../src/ledger/entry.js";
import type { CreateClaimInput } from "../../src/ledger/claim.js";
import type { CreateEntryInput } from "../../src/ledger/entry.js";
import type { MatchResult } from "../../src/consistency/types.js";

function baseClaim(overrides?: Partial<CreateClaimInput>): ReturnType<typeof createClaim> {
  const input: CreateClaimInput = {
    agent: "default",
    session: "ses_1",
    intent: {
      plannedAction: "file.read",
      plannedTarget: "/tmp/test.txt",
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
  return createClaim(input, "");
}

function baseExec(overrides?: Partial<CreateEntryInput>): ReturnType<typeof createEntry> {
  const input: CreateEntryInput = {
    agent: "default",
    session: "ses_1",
    action: { type: "file.read", target: "/tmp/test.txt", detail: "Read config" },
    context: { goal: "Read config", trigger: "manual" },
    outcome: { status: "success" },
    risk: { score: 2, labels: [], autoFlagged: false },
    ...overrides,
  };
  return createEntry(input, "");
}

describe("detectDivergences", () => {
  it("detects unclaimed execution (info severity for low risk)", () => {
    const exec = baseExec({ risk: { score: 1, labels: [], autoFlagged: false } });
    const matches: MatchResult[] = [{ execution: exec, matchType: "unmatched" }];

    const findings = detectDivergences(matches);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("unclaimed_execution");
    expect(findings[0]!.severity).toBe("info");
  });

  it("detects unclaimed execution (warning severity for higher risk)", () => {
    const exec = baseExec({ risk: { score: 5, labels: [], autoFlagged: false } });
    const matches: MatchResult[] = [{ execution: exec, matchType: "unmatched" }];

    const findings = detectDivergences(matches);

    expect(findings[0]!.severity).toBe("warning");
  });

  it("detects unfulfilled claim", () => {
    const claim = baseClaim();
    const matches: MatchResult[] = [{ claim, matchType: "unmatched" }];

    const findings = detectDivergences(matches);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("unfulfilled_claim");
    expect(findings[0]!.severity).toBe("warning");
  });

  it("detects target mismatch (critical when risk >= 7)", () => {
    const claim = baseClaim();
    const exec = baseExec({
      action: { type: "file.read", target: "/home/user/.ssh/id_rsa", detail: "Read SSH key" },
      risk: { score: 9, labels: ["data_access"], autoFlagged: true },
    });
    const matches: MatchResult[] = [{ claim, execution: exec, matchType: "explicit" }];

    const findings = detectDivergences(matches);

    const targetMismatch = findings.find((f) => f.type === "target_mismatch");
    expect(targetMismatch).toBeDefined();
    expect(targetMismatch!.severity).toBe("critical");
  });

  it("detects target mismatch (warning when risk < 7)", () => {
    const claim = baseClaim();
    const exec = baseExec({
      action: { type: "file.read", target: "/tmp/other.txt", detail: "Read other" },
      risk: { score: 2, labels: [], autoFlagged: false },
    });
    const matches: MatchResult[] = [{ claim, execution: exec, matchType: "explicit" }];

    const findings = detectDivergences(matches);

    const targetMismatch = findings.find((f) => f.type === "target_mismatch");
    expect(targetMismatch!.severity).toBe("warning");
  });

  it("detects action type mismatch", () => {
    const claim = baseClaim();
    const exec = baseExec({
      action: { type: "file.write", target: "/tmp/test.txt", detail: "Wrote file" },
    });
    const matches: MatchResult[] = [{ claim, execution: exec, matchType: "explicit" }];

    const findings = detectDivergences(matches);

    const actionMismatch = findings.find((f) => f.type === "action_type_mismatch");
    expect(actionMismatch).toBeDefined();
    expect(actionMismatch!.severity).toBe("critical");
  });

  it("detects risk underestimate (3+ points)", () => {
    const claim = baseClaim();
    const exec = baseExec({
      risk: { score: 7, labels: ["data_access"], autoFlagged: true },
    });
    const matches: MatchResult[] = [{ claim, execution: exec, matchType: "explicit" }];

    const findings = detectDivergences(matches);

    const riskUnder = findings.find((f) => f.type === "risk_underestimate");
    expect(riskUnder).toBeDefined();
    expect(riskUnder!.severity).toBe("warning");
  });

  it("does not flag risk underestimate for small differences", () => {
    const claim = baseClaim();
    const exec = baseExec({
      risk: { score: 4, labels: [], autoFlagged: false },
    });
    const matches: MatchResult[] = [{ claim, execution: exec, matchType: "explicit" }];

    const findings = detectDivergences(matches);

    const riskUnder = findings.find((f) => f.type === "risk_underestimate");
    expect(riskUnder).toBeUndefined();
  });

  it("detects scope violation for elevated actions", () => {
    const claim = baseClaim({
      intent: {
        plannedAction: "elevated.command",
        plannedTarget: "sudo rm -rf /tmp/cache",
        goal: "Clean cache",
        expectedOutcome: "success",
        selfAssessedRisk: 3,
      },
    });
    const exec = baseExec({
      action: { type: "elevated.command", target: "sudo rm -rf /tmp/cache", detail: "Clean cache" },
    });
    const matches: MatchResult[] = [{ claim, execution: exec, matchType: "explicit" }];

    const findings = detectDivergences(matches);

    const scopeViolation = findings.find((f) => f.type === "scope_violation");
    expect(scopeViolation).toBeDefined();
    expect(scopeViolation!.severity).toBe("critical");
  });

  it("detects escalation undeclared", () => {
    const claim = baseClaim({
      intent: {
        plannedAction: "elevated.enable",
        plannedTarget: "host",
        goal: "Enable host access",
        expectedOutcome: "success",
        selfAssessedRisk: 5,
      },
    });
    const exec = baseExec({
      action: { type: "elevated.enable", target: "host", detail: "Elevated" },
    });
    const matches: MatchResult[] = [{ claim, execution: exec, matchType: "explicit" }];

    const findings = detectDivergences(matches);

    const escalation = findings.find((f) => f.type === "escalation_undeclared");
    expect(escalation).toBeDefined();
    expect(escalation!.severity).toBe("critical");
  });

  it("detects outcome unexpected", () => {
    const claim = baseClaim();
    const exec = baseExec({
      outcome: { status: "failure", detail: "File not found" },
    });
    const matches: MatchResult[] = [{ claim, execution: exec, matchType: "explicit" }];

    const findings = detectDivergences(matches);

    const unexpected = findings.find((f) => f.type === "outcome_unexpected");
    expect(unexpected).toBeDefined();
    expect(unexpected!.severity).toBe("info");
  });

  it("returns no findings for consistent pair", () => {
    const claim = baseClaim();
    const exec = baseExec();
    const matches: MatchResult[] = [{ claim, execution: exec, matchType: "explicit" }];

    const findings = detectDivergences(matches);

    expect(findings).toHaveLength(0);
  });
});
