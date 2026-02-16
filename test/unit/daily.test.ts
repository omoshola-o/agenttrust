import { describe, it, expect } from "vitest";
import { generateDailyDigest } from "../../src/digest/daily.js";
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
      from: "2026-02-15T00:00:00.000Z",
      to: "2026-02-15T23:59:59.999Z",
      label: "2026-02-15",
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

describe("generateDailyDigest", () => {
  it("contains AgentTrust Daily Digest header", () => {
    const data = makeDigestData();
    const md = generateDailyDigest(data);
    expect(md).toContain("# AgentTrust Daily Digest");
  });

  it("contains the date in the header", () => {
    const data = makeDigestData();
    const md = generateDailyDigest(data);
    // formatDate uses toLocaleDateString which is timezone-dependent;
    // compute expected value the same way the source does
    const expected = new Date(data.period.from).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(md).toContain(expected);
  });

  it("contains a Summary section", () => {
    const data = makeDigestData();
    const md = generateDailyDigest(data);
    expect(md).toContain("## Summary");
  });

  it("shows total actions count in summary", () => {
    const data = makeDigestData({ activity: { ...makeDigestData().activity, totalActions: 47 } });
    const md = generateDailyDigest(data);
    expect(md).toContain("**Total actions**: 47");
  });

  it("shows sessions count in summary", () => {
    const data = makeDigestData();
    const md = generateDailyDigest(data);
    expect(md).toContain("**Sessions**: 3");
  });

  it("shows consistency score in summary", () => {
    const data = makeDigestData();
    const md = generateDailyDigest(data);
    expect(md).toContain("**Consistency score**: 89/100");
  });

  it("shows risk alerts count in summary", () => {
    const data = makeDigestData();
    const md = generateDailyDigest(data);
    // ruleMatches.length = 0, critical=2, high=5, medium=10
    expect(md).toContain("**Risk alerts**: 0");
    expect(md).toContain("2 critical");
    expect(md).toContain("5 high");
    expect(md).toContain("10 medium");
  });

  it("contains Activity Breakdown section", () => {
    const data = makeDigestData();
    const md = generateDailyDigest(data);
    expect(md).toContain("## Activity Breakdown");
  });

  it("contains action type table rows", () => {
    const data = makeDigestData();
    const md = generateDailyDigest(data);
    expect(md).toContain("| Action Type | Count |");
    expect(md).toContain("| exec.command | 18 |");
    expect(md).toContain("| file.read | 12 |");
    expect(md).toContain("| file.write | 8 |");
  });

  it("contains Consistency section", () => {
    const data = makeDigestData();
    const md = generateDailyDigest(data);
    expect(md).toContain("## Consistency");
  });

  it("shows claims count in consistency section", () => {
    const data = makeDigestData();
    const md = generateDailyDigest(data);
    expect(md).toContain("Claims filed: 35");
  });

  it("shows consistency score in consistency section", () => {
    const data = makeDigestData();
    const md = generateDailyDigest(data);
    expect(md).toContain("Score: 89/100");
  });

  it("includes risk highlights when ruleMatches are present", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/.ssh/id_rsa",
        detail: "Read SSH key",
      },
      risk: { score: 9, labels: ["data_access"], autoFlagged: true },
    });

    const match: RuleMatch = {
      ruleId: "sensitive-file-access",
      severity: "critical",
      reason: "Accessed sensitive credential file",
      riskContribution: 9,
      labels: ["data_access"],
      evidence: { path: "/home/user/.ssh/id_rsa" },
    };

    const data = makeDigestData({
      highlights: {
        ruleMatches: [{ entry, matches: [match] }],
        highRiskEntries: [entry],
        consistencyFindings: [],
      },
    });

    const md = generateDailyDigest(data);
    expect(md).toContain("## Risk Highlights");
    expect(md).toContain("CRITICAL");
    expect(md).toContain("Accessed sensitive credential file");
    expect(md).toContain("sensitive-file-access");
  });

  it("includes timeline when timeline items are present", () => {
    const data = makeDigestData({
      timeline: [
        {
          ts: "2026-02-15T14:30:00.000Z",
          action: "file.read",
          target: "/home/user/.ssh/id_rsa",
          risk: 9,
        },
        {
          ts: "2026-02-15T15:00:00.000Z",
          action: "exec.command",
          target: "rm -rf /tmp/data",
          risk: 7,
        },
      ],
    });

    const md = generateDailyDigest(data);
    expect(md).toContain("## Timeline (highlights only)");
    expect(md).toContain("| Time | Action | Target | Risk |");
    expect(md).toContain("file.read");
    expect(md).toContain("exec.command");
  });

  it("does not include timeline section when no timeline items exist", () => {
    const data = makeDigestData({ timeline: [] });
    const md = generateDailyDigest(data);
    expect(md).not.toContain("## Timeline");
  });

  it("does not include risk highlights section when no ruleMatches exist", () => {
    const data = makeDigestData({
      highlights: { ruleMatches: [], highRiskEntries: [], consistencyFindings: [] },
    });
    const md = generateDailyDigest(data);
    expect(md).not.toContain("## Risk Highlights");
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

    const md = generateDailyDigest(data);
    expect(md).toContain("# AgentTrust Daily Digest");
    expect(md).toContain("**Total actions**: 0");
    expect(md).toContain("**Sessions**: 0");
    expect(md).toContain("Score: 100/100");
    expect(md).not.toContain("## Risk Highlights");
    expect(md).not.toContain("## Timeline");
  });
});
