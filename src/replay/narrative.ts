import type { CausalNode, BlameReport, BlameFactor } from "./types.js";

/**
 * Format a concise action description for a node.
 */
function describeAction(node: CausalNode): string {
  const entry = node.entry;
  return `${entry.action.type} on ${entry.action.target}`;
}

/**
 * Format a timestamp to a readable time string.
 */
function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toISOString().slice(11, 19);
}

/**
 * Generate a human-readable narrative for a blame report.
 * Deterministic — no LLM calls, pure template-based generation.
 */
export function generateNarrative(report: BlameReport): string {
  const { chain, blameRoot } = report;
  const parts: string[] = [];

  if (chain.length === 0) {
    return "No causal chain could be reconstructed for this incident.";
  }

  // Describe chain start
  const root = chain[0]!;
  parts.push(
    `The chain started when the agent performed ${describeAction(root)} at ${formatTime(root.entry.ts)}.`,
  );

  // Describe intermediate steps
  for (let i = 1; i < chain.length - 1; i++) {
    const node = chain[i]!;
    parts.push(
      `At step ${i}, the agent performed ${describeAction(node)} (goal: "${node.entry.context.goal}").`,
    );
  }

  // Describe the incident
  if (chain.length > 1) {
    const incident = chain[chain.length - 1]!;
    parts.push(
      `The incident occurred at step ${chain.length - 1}: ${describeAction(incident)} at ${formatTime(incident.entry.ts)}.`,
    );
  }

  // Describe blame root
  const blameIndex = chain.indexOf(blameRoot);
  if (blameIndex >= 0) {
    parts.push(
      `The blame root is step ${blameIndex}: ${describeAction(blameRoot)}.`,
    );

    if (blameRoot.ruleMatches.length > 0) {
      const ruleNames = blameRoot.ruleMatches.map((m) => m.ruleId).join(", ");
      parts.push(`This was detected because rules [${ruleNames}] triggered.`);
    }

    if (blameRoot.consistencyFinding) {
      parts.push(
        `Consistency check found: ${blameRoot.consistencyFinding.description}.`,
      );
    }
  }

  return parts.join(" ");
}

/**
 * Generate a recommendation based on the blame report.
 */
export function generateRecommendation(report: BlameReport): string {
  const { factors, blameRoot, chain } = report;
  const parts: string[] = [];

  // Analyze factor types to determine recommendation
  const factorTypes = new Set(factors.map((f) => f.type));

  if (factorTypes.has("escalation")) {
    parts.push(
      "Review the agent's workflow. Consider enabling sandbox mode for tasks involving elevated permissions or financial operations.",
    );
  }

  if (factorTypes.has("scope_drift")) {
    parts.push(
      "The agent drifted from its declared scope. Consider enforcing stricter scope constraints in claims.",
    );
  }

  if (factorTypes.has("missing_claim")) {
    parts.push(
      "Some actions were executed without prior claims. Consider requiring claims for all sensitive operations.",
    );
  }

  if (factorTypes.has("rule_violation")) {
    const ruleIds = new Set<string>();
    for (const f of factors) {
      if (f.type === "rule_violation") {
        const match = f.description.match(/^Rule (\S+):/);
        if (match) ruleIds.add(match[1]!);
      }
    }
    if (ruleIds.size > 0) {
      parts.push(
        `Rules ${[...ruleIds].join(", ")} were violated. Review the agent's access to sensitive resources.`,
      );
    }
  }

  if (parts.length === 0) {
    // Generic recommendation
    if (chain.length > 3) {
      parts.push(
        "This is a deep causal chain. Consider breaking complex workflows into smaller, auditable steps.",
      );
    } else {
      parts.push(
        "Review the agent's behavior and consider adjusting risk thresholds or enabling additional rules.",
      );
    }
  }

  return parts.join(" ");
}

/**
 * Format a concise chain summary suitable for terminal output.
 */
export function formatChainSummary(chain: CausalNode[]): string {
  if (chain.length === 0) return "Empty chain.";

  const lines: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]!;
    const prefix = i === 0 ? "" : "\u2502\n";
    const riskStr = node.ruleMatches.length > 0
      ? ` \u2190 ${node.ruleMatches.map((m) => m.ruleId).join(", ")}`
      : "";
    const blameStr = node.isBlameRoot ? " \u2190 BLAME ROOT" : "";
    const claimStr = node.claim
      ? " | Claim: \u2713"
      : node.ruleMatches.length > 0
        ? " | Claim: \u2717 unclaimed"
        : "";

    lines.push(
      `${prefix}  [${i}] ${describeAction(node)} (${formatTime(node.entry.ts)})${riskStr}${blameStr}${claimStr}`,
    );
  }

  return lines.join("\n");
}
