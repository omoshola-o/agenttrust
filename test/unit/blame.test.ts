import { describe, it, expect } from "vitest";
import {
  findBlameRoot,
  identifyFactors,
  analyzeBlame,
} from "../../src/replay/blame.js";
import { buildGraph, getChain } from "../../src/replay/causal-graph.js";
import type { CausalNode } from "../../src/replay/types.js";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type { ConsistencyFinding } from "../../src/consistency/types.js";

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
    entry: makeEntry({ id: "01NODE0000000000000000001" }),
    children: [],
    depth: 0,
    ruleMatches: [],
    isBlameRoot: false,
    ...overrides,
  };
}

// --- Chain entries for blame tests ---

const chainEntry1 = makeEntry({
  id: "01BL_A",
  ts: "2026-02-15T12:00:00.000Z",
  context: { goal: "Handle ops request", trigger: "inbound_message" },
  action: { type: "message.read", target: "inbox:ops@company.com", detail: "Read ops request" },
});

const chainEntry2 = makeEntry({
  id: "01BL_B",
  ts: "2026-02-15T12:00:05.000Z",
  context: { goal: "Read config", trigger: "chain", parentAction: "01BL_A" },
  action: { type: "file.read", target: "/home/deploy/config.yaml", detail: "Read config" },
});

const chainEntry3 = makeEntry({
  id: "01BL_C",
  ts: "2026-02-15T12:00:10.000Z",
  context: { goal: "Deploy", trigger: "chain", parentAction: "01BL_B" },
  action: {
    type: "elevated.enable" as ATFEntry["action"]["type"],
    target: "host:prod-server",
    detail: "Enabled elevated mode",
  },
  risk: { score: 9, labels: ["escalation"], autoFlagged: true },
});

const chainEntry4 = makeEntry({
  id: "01BL_D",
  ts: "2026-02-15T12:00:15.000Z",
  context: { goal: "Execute deploy", trigger: "chain", parentAction: "01BL_C" },
  action: {
    type: "elevated.command" as ATFEntry["action"]["type"],
    target: "kubectl apply -f deploy.yaml",
    detail: "Applied deployment",
  },
  risk: { score: 9, labels: ["escalation", "execution"], autoFlagged: true },
});

const chainEntries = [chainEntry1, chainEntry2, chainEntry3, chainEntry4];

describe("findBlameRoot", () => {
  it("returns first node with ruleMatches", () => {
    const nodeA = makeNode({
      entry: chainEntry1,
      depth: 0,
      ruleMatches: [],
    });
    const nodeB = makeNode({
      entry: chainEntry2,
      depth: 1,
      ruleMatches: [{ ruleId: "rule-1", description: "Violation detected" }],
    });
    const nodeC = makeNode({
      entry: chainEntry3,
      depth: 2,
      ruleMatches: [{ ruleId: "rule-2", description: "Another violation" }],
    });

    const chain = [nodeA, nodeB, nodeC];
    const root = findBlameRoot(chain);
    expect(root.entry.id).toBe("01BL_B");
  });

  it("returns last node when no matches exist", () => {
    const nodeA = makeNode({ entry: chainEntry1, depth: 0 });
    const nodeB = makeNode({ entry: chainEntry2, depth: 1 });
    const nodeC = makeNode({ entry: chainEntry3, depth: 2 });

    const chain = [nodeA, nodeB, nodeC];
    const root = findBlameRoot(chain);
    expect(root.entry.id).toBe("01BL_C");
  });
});

describe("identifyFactors", () => {
  it("detects escalation for elevated.enable", () => {
    const node = makeNode({
      entry: chainEntry3,
      depth: 2,
    });
    const chain = [node];
    const factors = identifyFactors(chain);
    const escalation = factors.find((f) => f.type === "escalation");
    expect(escalation).toBeDefined();
  });

  it("detects escalation for payment.initiate", () => {
    const paymentEntry = makeEntry({
      id: "01PAY",
      action: {
        type: "payment.initiate" as ATFEntry["action"]["type"],
        target: "stripe:txn_123",
        detail: "Initiated payment",
      },
      risk: { score: 8, labels: ["financial"], autoFlagged: true },
    });
    const node = makeNode({ entry: paymentEntry, depth: 0 });
    const factors = identifyFactors([node]);
    const escalation = factors.find((f) => f.type === "escalation");
    expect(escalation).toBeDefined();
  });

  it("detects scope_drift for consistency findings", () => {
    const finding: ConsistencyFinding = {
      type: "target_mismatch",
      severity: "critical",
      description: "Target differs from claim",
      details: { claimed: "/tmp/safe.txt", actual: "/etc/passwd" },
    };
    const node = makeNode({
      entry: chainEntry2,
      depth: 1,
      consistencyFinding: finding,
    });
    const factors = identifyFactors([node]);
    const drift = factors.find((f) => f.type === "scope_drift");
    expect(drift).toBeDefined();
  });

  it("detects scope_drift for action_type_mismatch finding", () => {
    const finding: ConsistencyFinding = {
      type: "action_type_mismatch",
      severity: "warning",
      description: "Action type differs from claim",
      details: { claimed: "file.read", actual: "file.write" },
    };
    const node = makeNode({
      entry: chainEntry2,
      depth: 1,
      consistencyFinding: finding,
    });
    const factors = identifyFactors([node]);
    const drift = factors.find((f) => f.type === "scope_drift");
    expect(drift).toBeDefined();
  });

  it("detects missing_claim (no claim + rule matches)", () => {
    const node = makeNode({
      entry: chainEntry3,
      depth: 2,
      ruleMatches: [{ ruleId: "rule-1", description: "Elevated access" }],
      // no claim attached
    });
    const factors = identifyFactors([node]);
    const missing = factors.find((f) => f.type === "missing_claim");
    expect(missing).toBeDefined();
  });

  it("detects rule_violation for each rule match", () => {
    const node = makeNode({
      entry: chainEntry3,
      depth: 2,
      ruleMatches: [
        { ruleId: "rule-1", description: "Violation A" },
        { ruleId: "rule-2", description: "Violation B" },
      ],
    });
    const factors = identifyFactors([node]);
    const violations = factors.filter((f) => f.type === "rule_violation");
    expect(violations).toHaveLength(2);
  });

  it("detects trigger for root with inbound_message trigger", () => {
    const node = makeNode({
      entry: chainEntry1,
      depth: 0,
    });
    // Root node has trigger "inbound_message"
    const factors = identifyFactors([node]);
    const trigger = factors.find((f) => f.type === "trigger");
    expect(trigger).toBeDefined();
  });

  it("returns empty for clean chain (no issues)", () => {
    const cleanEntry = makeEntry({
      id: "01CLEAN",
      context: { goal: "Simple read", trigger: "test" },
      action: { type: "file.read", target: "/tmp/safe.txt", detail: "Safe read" },
    });
    const node = makeNode({
      entry: cleanEntry,
      depth: 0,
    });
    const factors = identifyFactors([node]);
    expect(factors).toHaveLength(0);
  });
});

describe("analyzeBlame", () => {
  it("returns complete report", () => {
    const ruleMatchesByEntry = new Map([
      [
        "01BL_C",
        [{ ruleId: "escalation-rule", description: "Escalated to elevated mode" }],
      ],
    ]);
    const graph = buildGraph(chainEntries, { ruleMatchesByEntry });

    const report = analyzeBlame(chainEntry4, graph, ruleMatchesByEntry);
    expect(report).toBeDefined();
    expect(report.incident.id).toBe("01BL_D");
    expect(report.chain.length).toBeGreaterThan(0);
    expect(report.blameRoot).toBeDefined();
    expect(report.factors).toBeDefined();
    expect(Array.isArray(report.factors)).toBe(true);
    expect(typeof report.narrative).toBe("string");
    expect(typeof report.recommendation).toBe("string");
  });

  it("generates narrative (non-empty string)", () => {
    const graph = buildGraph(chainEntries);
    const report = analyzeBlame(chainEntry4, graph);
    expect(report.narrative.length).toBeGreaterThan(0);
  });

  it("generates recommendation (non-empty string)", () => {
    const ruleMatchesByEntry = new Map([
      [
        "01BL_C",
        [{ ruleId: "escalation-rule", description: "Escalated to elevated mode" }],
      ],
    ]);
    const graph = buildGraph(chainEntries, { ruleMatchesByEntry });
    const report = analyzeBlame(chainEntry4, graph, ruleMatchesByEntry);
    expect(report.recommendation.length).toBeGreaterThan(0);
  });

  it("handles entry not in graph (creates single-node chain)", () => {
    const graph = buildGraph(chainEntries);
    const outsideEntry = makeEntry({
      id: "01OUTSIDE",
      context: { goal: "Unknown", trigger: "unknown" },
    });
    const report = analyzeBlame(outsideEntry, graph);
    expect(report.incident.id).toBe("01OUTSIDE");
    expect(report.chain.length).toBeGreaterThanOrEqual(1);
    expect(report.blameRoot).toBeDefined();
  });
});
