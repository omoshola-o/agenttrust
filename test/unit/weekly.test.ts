import { describe, it, expect } from "vitest";
import { generateWeeklyDigest } from "../../src/digest/weekly.js";
import type { DigestData } from "../../src/digest/types.js";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type { RuleMatch } from "../../src/analyzer/types.js";

function makeEntry(overrides: Partial<ATFEntry> = {}): ATFEntry {
  return {
    id: "01TEST0000000000000000001",
    v: 1,
    ts: "2026-02-15T18:32:05.000Z",
    prevHash: "",
    hash: "testhash",
    agent: "default",
    session: "ses_test",
    action: {
      type: "file.read" as ATFEntry["action"]["type"],
      target: "/home/user/test.txt",
      detail: "Read file",
    },
    context: { goal: "Test", trigger: "test" },
    outcome: { status: "success" },
    risk: { score: 1, labels: [], autoFlagged: false },
    ...overrides,
  };
}

function makeDigestData(overrides: Partial<DigestData> = {}): DigestData {
  return {
    period: {
      from: "2026-02-09T00:00:00.000Z",
      to: "2026-02-15T23:59:59.999Z",
      label: "2026-W07",
    },
    activity: {
      totalActions: 47,
      byType: {
        "exec.command": 18,
        "file.read": 12,
        "file.write": 8,
        "message.send": 4,
        "api.call": 3,
        "web.search": 2,
      },
      byRiskLevel: { low: 30, medium: 10, high: 5, critical: 2 },
      byStatus: { success: 40, failure: 5, partial: 2 },
      uniqueSessions: 3,
      uniqueTargets: 25,
    },
    highlights: {
      ruleMatches: [],
      highRiskEntries: [],
      consistencyFindings: [],
    },
    consistency: {
      totalClaims: 35,
      totalExecutions: 47,
      consistencyScore: 89,
      topFindings: [],
    },
    incidents: [],
    timeline: [],
    ...overrides,
  };
}

describe("generateWeeklyDigest", () => {
  it("contains AgentTrust Weekly Digest header", () => {
    const data = makeDigestData();
    const md = generateWeeklyDigest(data);
    expect(md).toContain("# AgentTrust Weekly Digest");
  });

  it("contains the week label in the header", () => {
    const data = makeDigestData();
    const md = generateWeeklyDigest(data);
    expect(md).toContain("2026-W07");
  });

  it("contains a Summary section", () => {
    const data = makeDigestData();
    const md = generateWeeklyDigest(data);
    expect(md).toContain("## Summary");
  });

  it("shows total actions in summary", () => {
    const data = makeDigestData();
    const md = generateWeeklyDigest(data);
    expect(md).toContain("**Total actions**: 47");
  });

  it("shows unique targets in summary", () => {
    const data = makeDigestData();
    const md = generateWeeklyDigest(data);
    expect(md).toContain("**Unique targets**: 25");
  });

  it("contains Risk Overview section with table", () => {
    const data = makeDigestData();
    const md = generateWeeklyDigest(data);
    expect(md).toContain("## Risk Overview");
    expect(md).toContain("| Level | Count |");
    expect(md).toContain("Critical | 2 |");
    expect(md).toContain("High | 5 |");
    expect(md).toContain("Medium | 10 |");
    expect(md).toContain("Low | 30 |");
  });

  it("contains Activity Breakdown section", () => {
    const data = makeDigestData();
    const md = generateWeeklyDigest(data);
    expect(md).toContain("## Activity Breakdown");
    expect(md).toContain("| Action Type | Count |");
    expect(md).toContain("| exec.command | 18 |");
    expect(md).toContain("| file.read | 12 |");
  });

  it("contains Outcome Status section", () => {
    const data = makeDigestData();
    const md = generateWeeklyDigest(data);
    expect(md).toContain("## Outcome Status");
    expect(md).toContain("| Status | Count |");
    expect(md).toContain("| success | 40 |");
    expect(md).toContain("| failure | 5 |");
    expect(md).toContain("| partial | 2 |");
  });

  it("contains Consistency section", () => {
    const data = makeDigestData();
    const md = generateWeeklyDigest(data);
    expect(md).toContain("## Consistency");
    expect(md).toContain("Claims filed: 35");
    expect(md).toContain("Executions logged: 47");
    expect(md).toContain("Score: 89/100");
  });

  it("includes risk highlights when ruleMatches are present", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "rm -rf /important",
        detail: "Destructive command",
      },
      risk: { score: 10, labels: ["execution"], autoFlagged: true },
    });

    const match: RuleMatch = {
      ruleId: "destructive-command",
      severity: "critical",
      reason: "Destructive shell command executed",
      riskContribution: 10,
      labels: ["execution"],
    };

    const data = makeDigestData({
      highlights: {
        ruleMatches: [{ entry, matches: [match] }],
        highRiskEntries: [entry],
        consistencyFindings: [],
      },
    });

    const md = generateWeeklyDigest(data);
    expect(md).toContain("## Risk Highlights");
    expect(md).toContain("CRITICAL");
    expect(md).toContain("Destructive shell command executed");
    expect(md).toContain("destructive-command");
  });

  it("does not include risk highlights section when no ruleMatches exist", () => {
    const data = makeDigestData({
      highlights: { ruleMatches: [], highRiskEntries: [], consistencyFindings: [] },
    });
    const md = generateWeeklyDigest(data);
    expect(md).not.toContain("## Risk Highlights");
  });

  it("includes timeline when timeline items are present", () => {
    const data = makeDigestData({
      timeline: [
        {
          ts: "2026-02-12T09:15:00.000Z",
          action: "api.call",
          target: "https://stripe.com/v1/charges",
          risk: 8,
        },
      ],
    });

    const md = generateWeeklyDigest(data);
    expect(md).toContain("## Timeline (highlights only)");
    expect(md).toContain("api.call");
    expect(md).toContain("stripe.com");
  });

  it("does not include timeline section when no timeline items exist", () => {
    const data = makeDigestData({ timeline: [] });
    const md = generateWeeklyDigest(data);
    expect(md).not.toContain("## Timeline");
  });

  it("handles empty data with zero actions", () => {
    const data = makeDigestData({
      activity: {
        totalActions: 0,
        byType: {},
        byRiskLevel: { low: 0, medium: 0, high: 0, critical: 0 },
        byStatus: {},
        uniqueSessions: 0,
        uniqueTargets: 0,
      },
      consistency: {
        totalClaims: 0,
        totalExecutions: 0,
        consistencyScore: 100,
        topFindings: [],
      },
      highlights: { ruleMatches: [], highRiskEntries: [], consistencyFindings: [] },
      timeline: [],
    });

    const md = generateWeeklyDigest(data);
    expect(md).toContain("# AgentTrust Weekly Digest");
    expect(md).toContain("**Total actions**: 0");
    expect(md).toContain("**Unique targets**: 0");
    expect(md).toContain("Score: 100/100");
    expect(md).not.toContain("## Risk Highlights");
    expect(md).not.toContain("## Timeline");
  });

  it("shows sessions count in summary", () => {
    const data = makeDigestData();
    const md = generateWeeklyDigest(data);
    expect(md).toContain("**Sessions**: 3");
  });

  it("shows consistency score in summary", () => {
    const data = makeDigestData();
    const md = generateWeeklyDigest(data);
    expect(md).toContain("**Consistency score**: 89/100");
  });
});
