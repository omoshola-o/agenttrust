import type { ATFEntry } from "../ledger/entry.js";
import type { ClaimEntry } from "../ledger/claim.js";
import type { RuleMatch } from "../analyzer/types.js";
import type { ConsistencyFinding } from "../consistency/types.js";
import type { CausalNode, CausalGraph } from "./types.js";

export interface BuildGraphOptions {
  /** Claims to pair with entries */
  claims?: ClaimEntry[];

  /** Rule matches indexed by entry ID */
  ruleMatchesByEntry?: Map<string, RuleMatch[]>;

  /** Consistency findings indexed by entry ID (execution side) */
  findingsByEntry?: Map<string, ConsistencyFinding>;
}

/**
 * Build a causal graph from a list of entries.
 * Uses context.parentAction to link children to parents.
 */
export function buildGraph(entries: ATFEntry[], options: BuildGraphOptions = {}): CausalGraph {
  const { claims, ruleMatchesByEntry, findingsByEntry } = options;

  // Build claim map for pairing
  const claimMap = new Map<string, ClaimEntry>();
  if (claims) {
    for (const c of claims) {
      claimMap.set(c.id, c);
    }
  }

  // Create all nodes first
  const nodeIndex = new Map<string, CausalNode>();
  for (const entry of entries) {
    const claimId = (entry.meta as Record<string, unknown> | undefined)?.["claimId"];
    const claim = typeof claimId === "string" ? claimMap.get(claimId) : undefined;

    const node: CausalNode = {
      entry,
      claim,
      children: [],
      depth: 0,
      ruleMatches: ruleMatchesByEntry?.get(entry.id) ?? [],
      isBlameRoot: false,
      consistencyFinding: findingsByEntry?.get(entry.id),
    };
    nodeIndex.set(entry.id, node);
  }

  // Link parents and children
  const roots: CausalNode[] = [];
  for (const node of nodeIndex.values()) {
    const parentId = node.entry.context.parentAction;
    if (parentId) {
      const parent = nodeIndex.get(parentId);
      if (parent) {
        node.parent = parent;
        parent.children.push(node);
      } else {
        // Parent not in the entry set — treat as root
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  // Calculate depths via BFS from roots
  let maxDepth = 0;
  const queue = [...roots];
  for (const root of queue) {
    root.depth = 0;
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const child of node.children) {
      child.depth = node.depth + 1;
      if (child.depth > maxDepth) {
        maxDepth = child.depth;
      }
      queue.push(child);
    }
  }

  return {
    roots,
    nodeIndex,
    maxDepth,
    totalNodes: nodeIndex.size,
  };
}

/**
 * Get the causal chain from a root to a specific entry.
 * Returns the chain from root to the target node (inclusive), ordered root-first.
 */
export function getChain(graph: CausalGraph, entryId: string): CausalNode[] {
  const targetNode = graph.nodeIndex.get(entryId);
  if (!targetNode) return [];

  const chain: CausalNode[] = [];
  let current: CausalNode | undefined = targetNode;
  while (current) {
    chain.unshift(current);
    current = current.parent;
  }
  return chain;
}

/**
 * Get all root nodes in the graph.
 */
export function getRoots(graph: CausalGraph): CausalNode[] {
  return [...graph.roots];
}

/**
 * Get all nodes at a given depth.
 */
export function getNodesAtDepth(graph: CausalGraph, depth: number): CausalNode[] {
  const result: CausalNode[] = [];
  for (const node of graph.nodeIndex.values()) {
    if (node.depth === depth) {
      result.push(node);
    }
  }
  return result;
}

/**
 * Find all leaf nodes (nodes with no children).
 */
export function getLeafNodes(graph: CausalGraph): CausalNode[] {
  const result: CausalNode[] = [];
  for (const node of graph.nodeIndex.values()) {
    if (node.children.length === 0) {
      result.push(node);
    }
  }
  return result;
}
