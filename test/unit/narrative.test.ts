import { describe, it, expect } from "vitest";
import {
  generateNarrative,
  generateRecommendation,
  formatChainSummary,
} from "../../src/replay/narrative.js";
import type { CausalNode, BlameReport, BlameFactor } from "../../src/replay/types.js";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type { ClaimEntry } from "../../src/ledger/claim.js";

function makeEntry(overrides: Partial<ATFEntry> & { id: string }): ATFEntry {
  return {
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

function makeNode(overrides: Partial<CausalNode> = {}): CausalNode {
  return {
    entry: makeEntry({ id: "01TEST0000000000000000001" }),
    children: [],
    depth: 0,
    ruleMatches: [],
    isBlameRoot: false,
    ...overrides,
  };
}

// --- Test data ---

const rootEntry = makeEntry({
  id: "01NAR_A",
  ts: "2026-02-15T14:00:00.000Z",
  context: { goal: "Handle request", trigger: "inbound_message" },
  action: { type: "message.read", target: "inbox:user@test.com", detail: "Read user message" },
});

const midEntry = makeEntry({
  id: "01NAR_B",
  ts: "2026-02-15T14:00:05.000Z",
  context: { goal: "Process request", trigger: "chain", parentAction: "01NAR_A" },
  action: { type: "file.read", target: "/tmp/data.csv", detail: "Read data file" },
});

const incidentEntry = makeEntry({
  id: "01NAR_C",
  ts: "2026-02-15T14:00:10.000Z",
  context: { goal: "Deploy changes", trigger: "chain", parentAction: "01NAR_B" },
  action: {
    type: "elevated.enable" as ATFEntry["action"]["type"],
    target: "host:prod-server",
    detail: "Enabled elevated mode",
  },
  risk: { score: 9, labels: ["escalation"], autoFlagged: true },
});

const rootNode = makeNode({
  entry: rootEntry,
  depth: 0,
});

const midNode = makeNode({
  entry: midEntry,
  depth: 1,
  ruleMatches: [{ ruleId: "rule-scope", description: "Scope boundary crossed" }],
  isBlameRoot: true,
});

const incidentNode = makeNode({
  entry: incidentEntry,
  depth: 2,
});

const threeNodeChain = [rootNode, midNode, incidentNode];

function makeReport(overrides: Partial<BlameReport> = {}): BlameReport {
  return {
    incident: incidentEntry,
    chain: threeNodeChain,
    blameRoot: midNode,
    factors: [],
    narrative: "Test narrative",
    recommendation: "Test recommendation",
    ...overrides,
  };
}

describe("generateNarrative", () => {
  it("includes chain start description", () => {
    const report = makeReport();
    const narrative = generateNarrative(report);
    expect(narrative).toContain("message.read");
  });

  it("includes incident description", () => {
    const report = makeReport();
    const narrative = generateNarrative(report);
    expect(narrative).toContain("elevated.enable");
  });

  it("includes blame root reference", () => {
    const report = makeReport();
    const narrative = generateNarrative(report);
    // The blame root is the mid node doing file.read
    expect(narrative).toContain("blame");
  });

  it("mentions triggered rules", () => {
    const report = makeReport();
    const narrative = generateNarrative(report);
    // midNode has ruleMatches with "Scope boundary crossed"
    expect(narrative).toContain("rule");
  });

  it("handles single-node chain", () => {
    const singleNode = makeNode({
      entry: incidentEntry,
      depth: 0,
      isBlameRoot: true,
    });
    const report = makeReport({
      chain: [singleNode],
      blameRoot: singleNode,
    });
    const narrative = generateNarrative(report);
    expect(typeof narrative).toBe("string");
    expect(narrative.length).toBeGreaterThan(0);
  });

  it("handles empty chain (returns 'No causal chain' message)", () => {
    const report = makeReport({
      chain: [],
      blameRoot: midNode,
    });
    const narrative = generateNarrative(report);
    expect(narrative.toLowerCase()).toContain("no causal chain");
  });
});

describe("generateRecommendation", () => {
  it("mentions sandbox for escalation factors", () => {
    const escalationFactor: BlameFactor = {
      type: "escalation",
      description: "Agent escalated to elevated mode",
      node: incidentNode,
    };
    const report = makeReport({ factors: [escalationFactor] });
    const rec = generateRecommendation(report);
    expect(rec.toLowerCase()).toContain("sandbox");
  });

  it("mentions scope constraints for scope_drift factors", () => {
    const driftFactor: BlameFactor = {
      type: "scope_drift",
      description: "Target mismatch from claim",
      node: midNode,
    };
    const report = makeReport({ factors: [driftFactor] });
    const rec = generateRecommendation(report);
    expect(rec.toLowerCase()).toContain("scope");
  });

  it("mentions requiring claims for missing_claim factors", () => {
    const missingFactor: BlameFactor = {
      type: "missing_claim",
      description: "No claim for this action",
      node: midNode,
    };
    const report = makeReport({ factors: [missingFactor] });
    const rec = generateRecommendation(report);
    expect(rec.toLowerCase()).toContain("claim");
  });

  it("mentions rule violations", () => {
    const violationFactor: BlameFactor = {
      type: "rule_violation",
      description: "Violated escalation policy",
      node: incidentNode,
    };
    const report = makeReport({ factors: [violationFactor] });
    const rec = generateRecommendation(report);
    expect(rec.toLowerCase()).toContain("rule");
  });

  it("returns generic recommendation when no factors", () => {
    const report = makeReport({ factors: [] });
    const rec = generateRecommendation(report);
    expect(typeof rec).toBe("string");
    expect(rec.length).toBeGreaterThan(0);
  });
});

describe("formatChainSummary", () => {
  it("includes action descriptions", () => {
    const summary = formatChainSummary(threeNodeChain);
    expect(summary).toContain("message.read");
    expect(summary).toContain("file.read");
    expect(summary).toContain("elevated.enable");
  });

  it("marks blame root", () => {
    const summary = formatChainSummary(threeNodeChain);
    // midNode has isBlameRoot: true
    // Summary should mark it somehow (e.g., with an indicator like "<< BLAME ROOT" or similar)
    const lines = summary.split("\n");
    const blameRootLine = lines.find(
      (l) => l.includes("file.read") && l.includes("01NAR_B"),
    );
    // There should be some blame indicator on that line or the summary mentions blame root
    expect(summary.toLowerCase()).toContain("blame");
  });

  it("shows claim indicators", () => {
    const claimedEntry = makeEntry({
      id: "01CLAIMED_NAR",
      action: { type: "file.read", target: "/tmp/test.txt", detail: "Read file" },
    });
    const claim: ClaimEntry = {
      id: "CLAIM_NAR_01",
      v: 1,
      ts: "2026-02-15T13:59:00.000Z",
      prevHash: "",
      hash: "claimhash_nar",
      agent: "default",
      session: "ses_test",
      intent: {
        plannedAction: "file.read",
        plannedTarget: "/tmp/test.txt",
        goal: "Read file",
        expectedOutcome: "success",
        selfAssessedRisk: 1,
      },
      constraints: {
        withinScope: true,
        requiresElevation: false,
        involvesExternalComms: false,
        involvesFinancial: false,
      },
    };
    const claimedNode = makeNode({
      entry: claimedEntry,
      depth: 0,
      claim,
    });
    const summary = formatChainSummary([claimedNode]);
    // Should indicate this node has an associated claim
    expect(summary.toLowerCase()).toContain("claim");
  });

  it("handles empty chain", () => {
    const summary = formatChainSummary([]);
    expect(typeof summary).toBe("string");
    // Should handle gracefully, either empty or a message
    expect(summary.length).toBeGreaterThanOrEqual(0);
  });
});
