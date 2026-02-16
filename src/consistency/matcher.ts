import type { ClaimEntry } from "../ledger/claim.js";
import type { ATFEntry } from "../ledger/entry.js";
import type { MatchResult } from "./types.js";

const TEMPORAL_WINDOW_MS = 30_000;

export function matchClaimsToExecutions(
  claims: readonly ClaimEntry[],
  executions: readonly ATFEntry[],
): MatchResult[] {
  const results: MatchResult[] = [];

  const matchedClaimIds = new Set<string>();
  const matchedExecIds = new Set<string>();

  // Pass 1: Explicit matches via claimId in execution meta
  for (const exec of executions) {
    const claimId = (exec.meta as Record<string, unknown> | undefined)?.["claimId"];
    if (typeof claimId === "string") {
      const claim = claims.find((c) => c.id === claimId);
      if (claim) {
        results.push({ claim, execution: exec, matchType: "explicit" });
        matchedClaimIds.add(claim.id);
        matchedExecIds.add(exec.id);
      }
    }
  }

  // Pass 2: Temporal + type matching for unmatched entries
  const unmatchedExecs = executions.filter((e) => !matchedExecIds.has(e.id));
  const unmatchedClaims = claims.filter((c) => !matchedClaimIds.has(c.id));

  for (const exec of unmatchedExecs) {
    const execTime = new Date(exec.ts).getTime();
    let bestClaim: ClaimEntry | undefined;
    let bestTimeDiff = Infinity;

    for (const claim of unmatchedClaims) {
      if (matchedClaimIds.has(claim.id)) continue;

      const claimTime = new Date(claim.ts).getTime();
      const timeDiff = execTime - claimTime;

      // Claim must be BEFORE execution and within window
      if (timeDiff < 0 || timeDiff > TEMPORAL_WINDOW_MS) continue;

      // Action type must match
      if (claim.intent.plannedAction !== exec.action.type) continue;

      if (timeDiff < bestTimeDiff) {
        bestTimeDiff = timeDiff;
        bestClaim = claim;
      }
    }

    if (bestClaim) {
      results.push({ claim: bestClaim, execution: exec, matchType: "temporal" });
      matchedClaimIds.add(bestClaim.id);
      matchedExecIds.add(exec.id);
    }
  }

  // Pass 3: Add unmatched executions
  for (const exec of executions) {
    if (!matchedExecIds.has(exec.id)) {
      results.push({ execution: exec, matchType: "unmatched" });
    }
  }

  // Pass 4: Add unmatched claims
  for (const claim of claims) {
    if (!matchedClaimIds.has(claim.id)) {
      results.push({ claim, matchType: "unmatched" });
    }
  }

  return results;
}
