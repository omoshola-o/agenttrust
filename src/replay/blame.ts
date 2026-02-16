import type { ATFEntry } from "../ledger/entry.js";
import type { CausalNode, CausalGraph, BlameReport, BlameFactor } from "./types.js";
import type { RuleMatch } from "../analyzer/types.js";
import type { ConsistencyFinding } from "../consistency/types.js";
import { getChain } from "./causal-graph.js";
import { generateNarrative, generateRecommendation } from "./narrative.js";

/**
 * Find the blame root in a causal chain.
 * The blame root is the first node in the chain where any rule matched (risk appeared).
 */
export function findBlameRoot(chain: CausalNode[]): CausalNode {
  for (const node of chain) {
    if (node.ruleMatches.length > 0) {
      return node;
    }
  }
  // If no rule matches in the chain, the incident itself is the blame root
  return chain[chain.length - 1]!;
}

/**
 * Identify contributing factors in a causal chain.
 */
export function identifyFactors(chain: CausalNode[]): BlameFactor[] {
  const factors: BlameFactor[] = [];

  for (const node of chain) {
    // Check for escalation
    const actionType = node.entry.action.type;
    if (actionType.startsWith("elevated.") || actionType.startsWith("payment.")) {
      factors.push({
        type: "escalation",
        description: `Action type "${actionType}" represents privilege escalation or financial operation`,
        node,
      });
    }

    // Check for scope drift (consistency finding)
    if (node.consistencyFinding) {
      const finding = node.consistencyFinding;
      if (
        finding.type === "target_mismatch" ||
        finding.type === "action_type_mismatch" ||
        finding.type === "risk_underestimate" ||
        finding.type === "scope_violation"
      ) {
        factors.push({
          type: "scope_drift",
          description: `${finding.type}: ${finding.description}`,
          node,
        });
      }
    }

    // Check for missing claim
    if (!node.claim && node.ruleMatches.length > 0) {
      factors.push({
        type: "missing_claim",
        description: `Action ${node.entry.action.type} on ${node.entry.action.target} was executed without a prior claim`,
        node,
      });
    }

    // Check for rule violations
    for (const match of node.ruleMatches) {
      factors.push({
        type: "rule_violation",
        description: `Rule ${match.ruleId}: ${match.reason}`,
        node,
      });
    }
  }

  // Check for initial trigger (root of chain)
  if (chain.length > 0) {
    const root = chain[0]!;
    if (root.entry.context.trigger === "inbound_message" || root.entry.context.trigger === "chain") {
      factors.push({
        type: "trigger",
        description: `Chain initiated by ${root.entry.context.trigger}: ${root.entry.action.detail}`,
        node: root,
      });
    }
  }

  return factors;
}

/**
 * Perform blame analysis for an incident entry.
 */
export function analyzeBlame(
  incident: ATFEntry,
  graph: CausalGraph,
  ruleMatchesByEntry?: Map<string, RuleMatch[]>,
  findingsByEntry?: Map<string, ConsistencyFinding>,
): BlameReport {
  // Get the causal chain to the incident
  const chain = getChain(graph, incident.id);

  if (chain.length === 0) {
    // Entry not in graph — create a minimal single-node chain
    const node: CausalNode = {
      entry: incident,
      children: [],
      depth: 0,
      ruleMatches: ruleMatchesByEntry?.get(incident.id) ?? [],
      isBlameRoot: true,
      consistencyFinding: findingsByEntry?.get(incident.id),
    };
    chain.push(node);
  }

  // Mark blame root
  const blameRoot = findBlameRoot(chain);
  blameRoot.isBlameRoot = true;

  // Identify factors
  const factors = identifyFactors(chain);

  // Generate narrative and recommendation
  const report: BlameReport = {
    incident,
    chain,
    blameRoot,
    factors,
    narrative: "",
    recommendation: "",
  };

  report.narrative = generateNarrative(report);
  report.recommendation = generateRecommendation(report);

  return report;
}
