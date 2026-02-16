import type { CorrelationFinding } from "./types.js";

/**
 * Context needed for proportional witness confidence scoring.
 */
export interface WitnessConfidenceContext {
  /** Total witness events (before filtering) */
  totalWitnessEvents: number;
  /** Total execution entries */
  totalExecutionEntries: number;
  /** Number of correlated (matched) pairs */
  correlatedPairs: number;
  /** Events filtered as background system noise */
  backgroundNoise: number;
  /** Events filtered as expected infrastructure traffic */
  infrastructureTraffic: number;
}

/**
 * Critical finding types that always incur a fixed penalty regardless of
 * proportional scoring. These indicate severe trust violations.
 */
const CRITICAL_FINDING_TYPES = new Set<string>([
  "phantom_process",
  "evidence_mismatch",
]);

/**
 * Per-critical-finding fixed penalty.
 */
const CRITICAL_FINDING_PENALTY = 15;

/**
 * Compute witness confidence using a proportional scoring model.
 *
 * The key insight: confidence should reflect "did the witness see what we
 * expected AND nothing alarming we didn't expect?" — not "were there zero
 * anomalies?"
 *
 * Algorithm:
 * 1. Compute totalAgentEvents = totalWitnessEvents - backgroundNoise - infrastructureTraffic
 * 2. Edge cases:
 *    - If totalAgentEvents == 0 AND executionEntries == 0 → 100 (nothing to verify)
 *    - If totalAgentEvents == 0 AND executionEntries > 0  → 50  (witness wasn't watching)
 * 3. Count severity WARNING/CRITICAL findings as "unmatched"
 * 4. unmatchedRatio = unmatchedCount / max(totalAgentEvents, 1)
 * 5. Penalty from unmatched ratio:
 *    - < 5%:  no penalty (noise tolerance)
 *    - 5-20%: penalty = unmatchedRatio * 100
 *    - > 20%: penalty = 20 + (unmatchedRatio - 0.20) * 200
 * 6. Fixed penalty: -15 per phantom_process or evidence_mismatch finding
 * 7. Floor at 0, cap at 100
 */
export function computeWitnessConfidence(
  findings: CorrelationFinding[],
  context?: WitnessConfidenceContext,
): number {
  // Backward-compatible: if no context provided, use findings-only legacy scoring
  if (!context) {
    return computeLegacyConfidence(findings);
  }

  const totalAgentEvents =
    context.totalWitnessEvents - context.backgroundNoise - context.infrastructureTraffic;

  // Edge case: nothing to verify
  if (totalAgentEvents <= 0 && context.totalExecutionEntries === 0) {
    return 100;
  }

  // Edge case: executions exist but witness saw no agent events
  if (totalAgentEvents <= 0 && context.totalExecutionEntries > 0) {
    return 50;
  }

  // Count findings with severity WARNING or CRITICAL as "unmatched"
  let unmatchedCount = 0;
  let criticalFixedPenalty = 0;

  for (const finding of findings) {
    // Critical types always incur a fixed penalty
    if (CRITICAL_FINDING_TYPES.has(finding.type)) {
      criticalFixedPenalty += CRITICAL_FINDING_PENALTY;
    }

    // Count warning/critical findings for proportional penalty
    if (finding.severity === "warning" || finding.severity === "critical") {
      unmatchedCount++;
    }
  }

  // Proportional penalty based on unmatched ratio
  const unmatchedRatio = unmatchedCount / Math.max(totalAgentEvents, 1);
  let proportionalPenalty = 0;

  if (unmatchedRatio < 0.05) {
    // Under 5%: noise tolerance, no penalty
    proportionalPenalty = 0;
  } else if (unmatchedRatio <= 0.20) {
    // 5-20%: linear penalty
    proportionalPenalty = unmatchedRatio * 100;
  } else {
    // > 20%: accelerated penalty
    proportionalPenalty = 20 + (unmatchedRatio - 0.20) * 200;
  }

  const totalPenalty = proportionalPenalty + criticalFixedPenalty;
  return Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));
}

/**
 * Legacy scoring for backward compatibility when no context is provided.
 * Used by callers that only have findings (e.g., direct scorer tests).
 */
function computeLegacyConfidence(findings: CorrelationFinding[]): number {
  let score = 100;

  for (const finding of findings) {
    score -= getLegacyPenalty(finding);
  }

  return Math.max(0, score);
}

function getLegacyPenalty(finding: CorrelationFinding): number {
  switch (finding.type) {
    case "unwitnessed_execution":
      return finding.severity === "critical" ? 10 : 5;

    case "unlogged_observation":
      return finding.severity === "warning" ? 5 : 2;

    case "target_discrepancy":
      return 15;

    case "timing_discrepancy":
      return finding.severity === "critical" ? 5 : 1;

    case "evidence_mismatch":
      return 10;

    case "phantom_process":
      return 20;

    case "silent_network":
      return finding.severity === "critical" ? 10 : 5;

    case "silent_file_access":
      return (finding.details?.["sensitive"] === true) ? 10 : 5;

    default:
      return 0;
  }
}
