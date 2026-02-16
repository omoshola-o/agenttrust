import type { ATFEntry } from "../ledger/entry.js";
import type { ClaimEntry } from "../ledger/claim.js";
import type { RuleMatch } from "../analyzer/types.js";
import type { ConsistencyFinding } from "../consistency/types.js";

/** A node in the causal action graph */
export interface CausalNode {
  /** The action entry */
  entry: ATFEntry;

  /** The paired claim, if any */
  claim?: ClaimEntry;

  /** Parent node (the action that triggered this one) */
  parent?: CausalNode;

  /** Child nodes (actions triggered by this one) */
  children: CausalNode[];

  /** Depth in the chain (0 = root trigger) */
  depth: number;

  /** Risk assessment from rules engine */
  ruleMatches: RuleMatch[];

  /** Was this the first node where risk exceeded threshold? */
  isBlameRoot: boolean;

  /** Consistency finding for this node, if any */
  consistencyFinding?: ConsistencyFinding;
}

/** The full causal graph for a session or time range */
export interface CausalGraph {
  /** All root nodes (actions with no parent) */
  roots: CausalNode[];

  /** All nodes indexed by entry ID */
  nodeIndex: Map<string, CausalNode>;

  /** Total depth of the deepest chain */
  maxDepth: number;

  /** Total nodes in graph */
  totalNodes: number;
}

/** Blame analysis result */
export interface BlameReport {
  /** The entry being investigated (the "incident") */
  incident: ATFEntry;

  /** The full causal chain from root to incident */
  chain: CausalNode[];

  /** The blame root — first node where risk appeared */
  blameRoot: CausalNode;

  /** Contributing factors */
  factors: BlameFactor[];

  /** Narrative explanation */
  narrative: string;

  /** Recommendation */
  recommendation: string;
}

export interface BlameFactor {
  type: "trigger" | "escalation" | "scope_drift" | "missing_claim" | "rule_violation";
  description: string;
  node: CausalNode;
}
