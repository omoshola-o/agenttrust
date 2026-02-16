import type { ClaimEntry } from "../ledger/claim.js";
import type { ATFEntry } from "../ledger/entry.js";
import type { ConsistencyReport } from "./types.js";
import { matchClaimsToExecutions } from "./matcher.js";
import { detectDivergences } from "./divergence.js";
import { computeConsistencyScore } from "./scorer.js";

export function generateReport(
  claims: readonly ClaimEntry[],
  executions: readonly ATFEntry[],
  timeRange: { from: string; to: string },
): ConsistencyReport {
  const matches = matchClaimsToExecutions(claims, executions);
  const findings = detectDivergences(matches);
  const consistencyScore = computeConsistencyScore(findings);

  const pairedMatches = matches.filter((m) => m.claim && m.execution);
  const unclaimedExecutions = matches.filter((m) => m.execution && !m.claim);
  const unfulfilledClaims = matches.filter((m) => m.claim && !m.execution);

  const divergentPairs = pairedMatches.filter((m) => {
    return findings.some(
      (f) =>
        f.claim?.id === m.claim?.id &&
        f.execution?.id === m.execution?.id &&
        f.type !== "unclaimed_execution" &&
        f.type !== "unfulfilled_claim",
    );
  });

  return {
    generatedAt: new Date().toISOString(),
    timeRange,
    summary: {
      totalClaims: claims.length,
      totalExecutions: executions.length,
      pairedCount: pairedMatches.length,
      unclaimedExecutions: unclaimedExecutions.length,
      unfulfilledClaims: unfulfilledClaims.length,
      divergentPairs: divergentPairs.length,
      consistentPairs: pairedMatches.length - divergentPairs.length,
    },
    findings,
    consistencyScore,
  };
}
