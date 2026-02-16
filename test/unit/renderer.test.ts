import { describe, it, expect, beforeAll } from "vitest";
import chalk from "chalk";
import {
  renderCompact,
  renderDetailed,
  renderClaimArrival,
  renderWatchSummary,
} from "../../src/watch/renderer.js";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type { ClaimEntry } from "../../src/ledger/claim.js";
import type { RuleMatch } from "../../src/analyzer/types.js";
import type { WatchSummary } from "../../src/watch/watcher.js";

beforeAll(() => {
  chalk.level = 0;
});

function makeEntry(overrides: Partial<ATFEntry> = {}): ATFEntry {
  return {
    id: "01TESTENTRY000000000000001",
    v: 1,
    ts: "2026-02-15T18:32:05.000Z",
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
      durationMs: 12,
    },
    risk: {
      score: 1,
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
    ts: "2026-02-15T18:31:00.000Z",
    prevHash: "",
    hash: "claimhash",
    agent: "default",
    session: "ses_test",
    intent: {
      plannedAction: "file.read" as ClaimEntry["intent"]["plannedAction"],
      plannedTarget: "/home/user/test.txt",
      goal: "Read test file",
      expectedOutcome: "success",
      selfAssessedRisk: 1,
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

function makeMatch(overrides: Partial<RuleMatch> = {}): RuleMatch {
  return {
    ruleId: "cred-001",
    severity: "critical",
    reason: "SSH key accessed: ~/.ssh/id_rsa",
    riskContribution: 9,
    labels: ["data_access", "escalation"],
    ...overrides,
  };
}

function makeSummary(overrides: Partial<WatchSummary> = {}): WatchSummary {
  return {
    entriesSeen: 47,
    claimsSeen: 0,
    rulesTriggered: 3,
    bySeverity: { critical: 1, high: 1, medium: 1, low: 0 },
    durationMs: 720000,
    ...overrides,
  };
}

describe("renderCompact", () => {
  it("includes timestamp", () => {
    const entry = makeEntry({ ts: "2026-02-15T18:32:05.000Z" });
    const output = renderCompact(entry, []);
    expect(output.includes("18:32:05")).toBe(true);
  });

  it("includes action type", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://example.com/api",
        detail: "Called API",
      },
    });
    const output = renderCompact(entry, []);
    expect(output.includes("api.call")).toBe(true);
  });

  it("includes target", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/test.txt",
        detail: "Read test file",
      },
    });
    const output = renderCompact(entry, []);
    expect(output.includes("/home/user/test.txt")).toBe(true);
  });

  it("includes risk score", () => {
    const entry = makeEntry({ risk: { score: 7, labels: [], autoFlagged: false } });
    const output = renderCompact(entry, []);
    expect(output.includes("risk:7")).toBe(true);
  });

  it("includes rule IDs when matches exist", () => {
    const entry = makeEntry();
    const matches = [
      makeMatch({ ruleId: "cred-001" }),
      makeMatch({ ruleId: "esc-002" }),
    ];
    const output = renderCompact(entry, matches);
    expect(output.includes("cred-001")).toBe(true);
    expect(output.includes("esc-002")).toBe(true);
  });

  it("omits rule hint when no matches", () => {
    const entry = makeEntry();
    const output = renderCompact(entry, []);
    // The arrow separator for rules should not appear
    expect(output.includes("\u2190")).toBe(false);
  });
});

describe("renderDetailed", () => {
  it("includes action type", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "rm -rf /tmp/old",
        detail: "Cleaned temp",
      },
    });
    const output = renderDetailed(entry, []);
    expect(output.includes("exec.command")).toBe(true);
  });

  it("includes target", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/etc/passwd",
        detail: "Read passwd",
      },
    });
    const output = renderDetailed(entry, []);
    expect(output.includes("/etc/passwd")).toBe(true);
  });

  it("includes goal", () => {
    const entry = makeEntry({
      context: { goal: "Deploy to production", trigger: "chain" },
    });
    const output = renderDetailed(entry, []);
    expect(output.includes("Deploy to production")).toBe(true);
  });

  it("includes status and duration", () => {
    const entry = makeEntry({
      outcome: { status: "success", durationMs: 342 },
    });
    const output = renderDetailed(entry, []);
    expect(output.includes("success")).toBe(true);
    expect(output.includes("342ms")).toBe(true);
  });

  it("includes risk level label", () => {
    const entry = makeEntry({ risk: { score: 9, labels: [], autoFlagged: true } });
    const output = renderDetailed(entry, []);
    expect(output.includes("9/10")).toBe(true);
    expect(output.includes("CRITICAL")).toBe(true);
  });

  it("includes rule details when matches exist", () => {
    const entry = makeEntry();
    const matches = [makeMatch({ ruleId: "cred-001", reason: "SSH key accessed: ~/.ssh/id_rsa" })];
    const output = renderDetailed(entry, matches);
    expect(output.includes("cred-001")).toBe(true);
    expect(output.includes("SSH key accessed")).toBe(true);
  });

  it("includes claim info when provided", () => {
    const entry = makeEntry();
    const claim = makeClaim({
      intent: {
        plannedAction: "file.read" as ClaimEntry["intent"]["plannedAction"],
        plannedTarget: "/home/user/config.yaml",
        goal: "Read config",
        expectedOutcome: "success",
        selfAssessedRisk: 2,
      },
    });
    const output = renderDetailed(entry, [], claim);
    expect(output.includes("file.read")).toBe(true);
    expect(output.includes("/home/user/config.yaml")).toBe(true);
  });

  it("shows unclaimed when no claim but has matches", () => {
    const entry = makeEntry();
    const matches = [makeMatch()];
    const output = renderDetailed(entry, matches, undefined);
    expect(output.includes("unclaimed")).toBe(true);
  });

  it("includes labels when present", () => {
    const entry = makeEntry({
      risk: {
        score: 8,
        labels: ["data_access", "escalation"],
        autoFlagged: true,
      },
    });
    const output = renderDetailed(entry, []);
    expect(output.includes("data_access")).toBe(true);
    expect(output.includes("escalation")).toBe(true);
  });
});

describe("renderClaimArrival", () => {
  it("includes planned action", () => {
    const claim = makeClaim({
      intent: {
        plannedAction: "api.call" as ClaimEntry["intent"]["plannedAction"],
        plannedTarget: "https://api.stripe.com/charges",
        goal: "Process payment",
        expectedOutcome: "success",
        selfAssessedRisk: 7,
      },
    });
    const output = renderClaimArrival(claim);
    expect(output.includes("api.call")).toBe(true);
  });

  it("includes planned target", () => {
    const claim = makeClaim({
      intent: {
        plannedAction: "file.write" as ClaimEntry["intent"]["plannedAction"],
        plannedTarget: "/home/user/output.json",
        goal: "Write output",
        expectedOutcome: "success",
        selfAssessedRisk: 2,
      },
    });
    const output = renderClaimArrival(claim);
    expect(output.includes("/home/user/output.json")).toBe(true);
  });

  it("includes self-assessed risk", () => {
    const claim = makeClaim({
      intent: {
        plannedAction: "file.read" as ClaimEntry["intent"]["plannedAction"],
        plannedTarget: "/home/user/test.txt",
        goal: "Read test file",
        expectedOutcome: "success",
        selfAssessedRisk: 5,
      },
    });
    const output = renderClaimArrival(claim);
    expect(output.includes("self-risk: 5")).toBe(true);
  });
});

describe("renderWatchSummary", () => {
  it("includes entries seen", () => {
    const summary = makeSummary({ entriesSeen: 47 });
    const output = renderWatchSummary(summary);
    expect(output.includes("Entries seen: 47")).toBe(true);
  });

  it("includes rules triggered", () => {
    const summary = makeSummary({ rulesTriggered: 3 });
    const output = renderWatchSummary(summary);
    expect(output.includes("Rules triggered: 3")).toBe(true);
  });

  it("includes severity counts", () => {
    const summary = makeSummary({
      bySeverity: { critical: 2, high: 5, medium: 3, low: 1 },
    });
    const output = renderWatchSummary(summary);
    expect(output.includes("Critical: 2")).toBe(true);
    expect(output.includes("High: 5")).toBe(true);
    expect(output.includes("Medium: 3")).toBe(true);
    expect(output.includes("Low: 1")).toBe(true);
  });

  it("includes duration formatted as minutes for 720000ms", () => {
    const summary = makeSummary({ durationMs: 720000 });
    const output = renderWatchSummary(summary);
    expect(output.includes("12 minutes")).toBe(true);
  });

  it("includes claims seen when > 0", () => {
    const summary = makeSummary({ claimsSeen: 12 });
    const output = renderWatchSummary(summary);
    expect(output.includes("Claims seen: 12")).toBe(true);
  });

  it("omits claims line when claims seen is 0", () => {
    const summary = makeSummary({ claimsSeen: 0 });
    const output = renderWatchSummary(summary);
    expect(output.includes("Claims seen")).toBe(false);
  });
});
