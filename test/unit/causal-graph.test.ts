import { describe, it, expect } from "vitest";
import {
  buildGraph,
  getChain,
  getRoots,
  getNodesAtDepth,
  getLeafNodes,
} from "../../src/replay/causal-graph.js";
import type { CausalNode, CausalGraph } from "../../src/replay/types.js";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type { ClaimEntry } from "../../src/ledger/claim.js";
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

// --- Linear chain: entry1 -> entry2 -> entry3 -> entry4 ---

const entry1 = makeEntry({
  id: "01A",
  ts: "2026-02-15T10:00:00.000Z",
  context: { goal: "Handle request", trigger: "inbound_message" },
  action: { type: "message.read", target: "inbox:user@test.com", detail: "Read message" },
});

const entry2 = makeEntry({
  id: "01B",
  ts: "2026-02-15T10:00:05.000Z",
  context: { goal: "Process data", trigger: "chain", parentAction: "01A" },
  action: { type: "file.read", target: "/tmp/data.csv", detail: "Read data" },
});

const entry3 = makeEntry({
  id: "01C",
  ts: "2026-02-15T10:00:10.000Z",
  context: { goal: "Transform data", trigger: "chain", parentAction: "01B" },
  action: { type: "file.write", target: "/tmp/output.json", detail: "Wrote output" },
});

const entry4 = makeEntry({
  id: "01D",
  ts: "2026-02-15T10:00:15.000Z",
  context: { goal: "Send results", trigger: "chain", parentAction: "01C" },
  action: { type: "message.send", target: "email:user@test.com", detail: "Sent results" },
});

const linearEntries = [entry1, entry2, entry3, entry4];

// --- Branching: branchRoot -> branchChild1, branchRoot -> branchChild2 ---

const branchRoot = makeEntry({
  id: "01BR_ROOT",
  ts: "2026-02-15T11:00:00.000Z",
  context: { goal: "Multi-task", trigger: "inbound_message" },
  action: { type: "message.read", target: "inbox:admin@corp.com", detail: "Read request" },
});

const branchChild1 = makeEntry({
  id: "01BR_CH1",
  ts: "2026-02-15T11:00:05.000Z",
  context: { goal: "Subtask A", trigger: "chain", parentAction: "01BR_ROOT" },
  action: { type: "file.read", target: "/var/log/app.log", detail: "Read log" },
});

const branchChild2 = makeEntry({
  id: "01BR_CH2",
  ts: "2026-02-15T11:00:06.000Z",
  context: { goal: "Subtask B", trigger: "chain", parentAction: "01BR_ROOT" },
  action: { type: "api.call", target: "https://metrics.internal/query", detail: "Queried metrics" },
});

const branchEntries = [branchRoot, branchChild1, branchChild2];

describe("buildGraph", () => {
  it("creates nodes for all entries", () => {
    const graph = buildGraph(linearEntries);
    expect(graph.totalNodes).toBe(4);
    expect(graph.nodeIndex.size).toBe(4);
  });

  it("links parent/child via context.parentAction", () => {
    const graph = buildGraph(linearEntries);
    const nodeA = graph.nodeIndex.get("01A")!;
    const nodeB = graph.nodeIndex.get("01B")!;
    expect(nodeA.children).toHaveLength(1);
    expect(nodeA.children[0]!.entry.id).toBe("01B");
    expect(nodeB.parent?.entry.id).toBe("01A");
  });

  it("handles entries with no parentAction as roots", () => {
    const graph = buildGraph(linearEntries);
    expect(graph.roots).toHaveLength(1);
    expect(graph.roots[0]!.entry.id).toBe("01A");
  });

  it("calculates depth correctly (root=0, child=1, grandchild=2)", () => {
    const graph = buildGraph(linearEntries);
    expect(graph.nodeIndex.get("01A")!.depth).toBe(0);
    expect(graph.nodeIndex.get("01B")!.depth).toBe(1);
    expect(graph.nodeIndex.get("01C")!.depth).toBe(2);
    expect(graph.nodeIndex.get("01D")!.depth).toBe(3);
  });

  it("handles missing parent reference gracefully (treats as root)", () => {
    const orphan = makeEntry({
      id: "01ORPHAN",
      context: { goal: "Lost", trigger: "chain", parentAction: "01NONEXISTENT" },
    });
    const graph = buildGraph([orphan]);
    expect(graph.roots).toHaveLength(1);
    expect(graph.roots[0]!.entry.id).toBe("01ORPHAN");
    expect(graph.roots[0]!.depth).toBe(0);
  });

  it("pairs claims via meta.claimId", () => {
    const claim: ClaimEntry = {
      id: "CLAIM_01",
      v: 1,
      ts: "2026-02-15T09:59:00.000Z",
      prevHash: "",
      hash: "claimhash1",
      agent: "default",
      session: "ses_test",
      intent: {
        plannedAction: "message.read",
        plannedTarget: "inbox:user@test.com",
        goal: "Handle request",
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

    const entryWithClaim = makeEntry({
      id: "01CLAIMED",
      meta: { claimId: "CLAIM_01" },
      action: { type: "message.read", target: "inbox:user@test.com", detail: "Read message" },
    });

    const graph = buildGraph([entryWithClaim], { claims: [claim] });
    const node = graph.nodeIndex.get("01CLAIMED")!;
    expect(node.claim).toBeDefined();
    expect(node.claim!.id).toBe("CLAIM_01");
  });

  it("attaches ruleMatches from ruleMatchesByEntry", () => {
    const ruleMatchesByEntry = new Map<string, Array<{ ruleId: string; description: string }>>([
      ["01A", [{ ruleId: "rule-1", description: "High risk detected" }]],
    ]);

    const graph = buildGraph(linearEntries, { ruleMatchesByEntry });
    const nodeA = graph.nodeIndex.get("01A")!;
    expect(nodeA.ruleMatches).toHaveLength(1);
    expect(nodeA.ruleMatches[0]!.ruleId).toBe("rule-1");
  });

  it("attaches consistency findings from findingsByEntry", () => {
    const finding: ConsistencyFinding = {
      type: "target_mismatch",
      severity: "critical",
      description: "Target differs from claim",
      details: { claimed: "/tmp/safe.txt", actual: "/etc/passwd" },
    };
    const findingsByEntry = new Map<string, ConsistencyFinding>([["01B", finding]]);

    const graph = buildGraph(linearEntries, { findingsByEntry });
    const nodeB = graph.nodeIndex.get("01B")!;
    expect(nodeB.consistencyFinding).toBeDefined();
    expect(nodeB.consistencyFinding!.type).toBe("target_mismatch");
  });

  it("handles branching (one parent, two children)", () => {
    const graph = buildGraph(branchEntries);
    const root = graph.nodeIndex.get("01BR_ROOT")!;
    expect(root.children).toHaveLength(2);
    const childIds = root.children.map((c) => c.entry.id).sort();
    expect(childIds).toEqual(["01BR_CH1", "01BR_CH2"]);
  });

  it("calculates maxDepth correctly", () => {
    const graph = buildGraph(linearEntries);
    expect(graph.maxDepth).toBe(3);
  });

  it("calculates maxDepth for branching graph", () => {
    const graph = buildGraph(branchEntries);
    expect(graph.maxDepth).toBe(1);
  });
});

describe("getChain", () => {
  it("returns root-to-target chain", () => {
    const graph = buildGraph(linearEntries);
    const chain = getChain(graph, "01D");
    expect(chain).toHaveLength(4);
    expect(chain[0]!.entry.id).toBe("01A");
    expect(chain[1]!.entry.id).toBe("01B");
    expect(chain[2]!.entry.id).toBe("01C");
    expect(chain[3]!.entry.id).toBe("01D");
  });

  it("returns empty array for missing entry", () => {
    const graph = buildGraph(linearEntries);
    const chain = getChain(graph, "NONEXISTENT");
    expect(chain).toEqual([]);
  });

  it("returns single-element array for root node", () => {
    const graph = buildGraph(linearEntries);
    const chain = getChain(graph, "01A");
    expect(chain).toHaveLength(1);
    expect(chain[0]!.entry.id).toBe("01A");
  });
});

describe("getRoots", () => {
  it("returns all root nodes", () => {
    const graph = buildGraph(linearEntries);
    const roots = getRoots(graph);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.entry.id).toBe("01A");
  });

  it("returns multiple roots for independent chains", () => {
    const independent = makeEntry({
      id: "01INDEPENDENT",
      context: { goal: "Separate task", trigger: "cron" },
    });
    const graph = buildGraph([entry1, independent]);
    const roots = getRoots(graph);
    expect(roots).toHaveLength(2);
  });
});

describe("getNodesAtDepth", () => {
  it("returns correct nodes at depth 0", () => {
    const graph = buildGraph(linearEntries);
    const atZero = getNodesAtDepth(graph, 0);
    expect(atZero).toHaveLength(1);
    expect(atZero[0]!.entry.id).toBe("01A");
  });

  it("returns correct nodes at depth 1", () => {
    const graph = buildGraph(linearEntries);
    const atOne = getNodesAtDepth(graph, 1);
    expect(atOne).toHaveLength(1);
    expect(atOne[0]!.entry.id).toBe("01B");
  });

  it("returns multiple nodes at same depth in branching graph", () => {
    const graph = buildGraph(branchEntries);
    const atOne = getNodesAtDepth(graph, 1);
    expect(atOne).toHaveLength(2);
  });

  it("returns empty array for depth beyond maxDepth", () => {
    const graph = buildGraph(linearEntries);
    const atTen = getNodesAtDepth(graph, 10);
    expect(atTen).toEqual([]);
  });
});

describe("getLeafNodes", () => {
  it("returns nodes with no children in linear chain", () => {
    const graph = buildGraph(linearEntries);
    const leaves = getLeafNodes(graph);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.entry.id).toBe("01D");
  });

  it("returns multiple leaves in branching graph", () => {
    const graph = buildGraph(branchEntries);
    const leaves = getLeafNodes(graph);
    expect(leaves).toHaveLength(2);
    const leafIds = leaves.map((l) => l.entry.id).sort();
    expect(leafIds).toEqual(["01BR_CH1", "01BR_CH2"]);
  });

  it("returns all nodes when none have children (single entry)", () => {
    const graph = buildGraph([entry1]);
    const leaves = getLeafNodes(graph);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.entry.id).toBe("01A");
  });
});
