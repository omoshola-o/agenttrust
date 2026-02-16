import { describe, it, expect } from "vitest";
import { actionOutsideClaimScope } from "../../../src/analyzer/rules/scope-drift.js";
import { DEFAULT_CONFIG } from "../../../src/analyzer/types.js";
import type { ATFEntry } from "../../../src/ledger/entry.js";
import type { RuleContext } from "../../../src/analyzer/types.js";
import type { ClaimEntry } from "../../../src/ledger/claim.js";

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

function makeContext(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    sessionHistory: [],
    recentEntries: [],
    knownTargets: new Set<string>(),
    config: DEFAULT_CONFIG,
    ...overrides,
  };
}

describe("actionOutsideClaimScope (scope-001)", () => {
  it("returns null when no pairedClaim is present", () => {
    const entry = makeEntry({
      action: {
        type: "elevated.enable" as ATFEntry["action"]["type"],
        target: "host",
        detail: "Enabled elevated mode",
      },
    });
    const ctx = makeContext();
    expect(actionOutsideClaimScope.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null when pairedClaim has withinScope=false", () => {
    const claim = makeClaim({
      constraints: {
        withinScope: false,
        requiresElevation: false,
        involvesExternalComms: false,
        involvesFinancial: false,
      },
    });
    const entry = makeEntry({
      action: {
        type: "elevated.enable" as ATFEntry["action"]["type"],
        target: "host",
        detail: "Enabled elevated mode",
      },
    });
    const ctx = makeContext({ pairedClaim: claim });
    expect(actionOutsideClaimScope.evaluate(entry, ctx)).toBeNull();
  });

  it("triggers when pairedClaim has withinScope=true and action type is elevated.enable", () => {
    const claim = makeClaim();
    const entry = makeEntry({
      action: {
        type: "elevated.enable" as ATFEntry["action"]["type"],
        target: "host",
        detail: "Enabled elevated mode",
      },
    });
    const ctx = makeContext({ pairedClaim: claim });
    const result = actionOutsideClaimScope.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("scope-001");
    expect(result!.severity).toBe("high");
    expect(result!.riskContribution).toBe(8);
    expect(result!.labels).toEqual(["escalation"]);
  });

  it("triggers when pairedClaim has withinScope=true and action type is payment.initiate", () => {
    const claim = makeClaim();
    const entry = makeEntry({
      action: {
        type: "payment.initiate" as ATFEntry["action"]["type"],
        target: "stripe:checkout_123",
        detail: "Initiated payment",
      },
    });
    const ctx = makeContext({ pairedClaim: claim });
    const result = actionOutsideClaimScope.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("scope-001");
    expect(result!.severity).toBe("high");
    expect(result!.riskContribution).toBe(8);
    expect(result!.labels).toEqual(["escalation"]);
  });

  it("triggers when pairedClaim has withinScope=true and target matches sensitive path pattern", () => {
    const claim = makeClaim();
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/.ssh/id_rsa",
        detail: "Read SSH key",
      },
    });
    const ctx = makeContext({ pairedClaim: claim });
    const result = actionOutsideClaimScope.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("scope-001");
    expect(result!.severity).toBe("high");
    expect(result!.riskContribution).toBe(8);
    expect(result!.labels).toEqual(["escalation"]);
    expect(result!.reason).toContain(".ssh/id_rsa");
  });

  it("returns null when pairedClaim has withinScope=true but action is normal file.read of non-sensitive path", () => {
    const claim = makeClaim();
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/documents/notes.txt",
        detail: "Read notes",
      },
    });
    const ctx = makeContext({ pairedClaim: claim });
    expect(actionOutsideClaimScope.evaluate(entry, ctx)).toBeNull();
  });

  it("triggers for .env sensitive path pattern", () => {
    const claim = makeClaim();
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/project/.env",
        detail: "Read env file",
      },
    });
    const ctx = makeContext({ pairedClaim: claim });
    const result = actionOutsideClaimScope.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("scope-001");
  });

  it("triggers for credentials sensitive path pattern", () => {
    const claim = makeClaim();
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/.aws/credentials",
        detail: "Read AWS credentials",
      },
    });
    const ctx = makeContext({ pairedClaim: claim });
    const result = actionOutsideClaimScope.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("scope-001");
  });

  it("has correct rule metadata", () => {
    expect(actionOutsideClaimScope.id).toBe("scope-001");
    expect(actionOutsideClaimScope.category).toBe("scope_drift");
    expect(actionOutsideClaimScope.severity).toBe("high");
    expect(actionOutsideClaimScope.enabledByDefault).toBe(true);
  });
});
