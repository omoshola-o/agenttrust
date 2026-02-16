import type { ATFEntry } from "../ledger/entry.js";
import type { WitnessEntry, NetworkWitnessEvent } from "../witness/types.js";
import type { CorrelationMatch, CorrelationFinding } from "./types.js";

/** Maximum time difference (ms) for a network event match */
const NETWORK_TIME_WINDOW_MS = 10_000;

/** Action types that correspond to network operations */
const NETWORK_ACTION_TYPES = new Set([
  "api.call",
  "web.fetch",
  "web.search",
  "web.browse",
]);

/**
 * Extract hostname from a URL string.
 * Handles both plain hostnames and full URLs.
 */
export function extractHostFromTarget(target: string): string | null {
  try {
    // If it looks like a URL, parse it
    if (target.includes("://")) {
      const url = new URL(target);
      return url.hostname;
    }

    // If it contains a colon but no scheme, might be host:port
    if (target.includes(":") && !target.includes("/")) {
      return target.split(":")[0] ?? null;
    }

    // Could be a bare hostname or path
    const firstSlash = target.indexOf("/");
    if (firstSlash > 0) {
      return target.slice(0, firstSlash);
    }

    // Return as-is if it looks like a hostname
    if (target.includes(".") && !target.includes(" ")) {
      return target;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a witness remote host matches an execution target.
 */
export function hostMatches(witnessHost: string, executionTarget: string): boolean {
  const targetHost = extractHostFromTarget(executionTarget);
  if (!targetHost) return false;

  // Exact match
  if (witnessHost === targetHost) return true;

  // IP might resolve to hostname or vice versa — can't resolve in sync code
  // so do substring matching for now
  if (witnessHost.includes(targetHost) || targetHost.includes(witnessHost)) return true;

  return false;
}

/**
 * Correlate network witness events with api/web execution entries.
 */
export function correlateNetworkEvents(
  witnessEntries: WitnessEntry[],
  executions: ATFEntry[],
): CorrelationMatch[] {
  const matches: CorrelationMatch[] = [];
  const networkWitnesses = witnessEntries.filter(
    (w) => w.source === "network" && (w.event as NetworkWitnessEvent).type === "connection_opened",
  );
  const networkExecs = executions.filter((e) => NETWORK_ACTION_TYPES.has(e.action.type));

  for (const witness of networkWitnesses) {
    const event = witness.event as NetworkWitnessEvent;

    for (const exec of networkExecs) {
      // Check host match
      if (!hostMatches(event.remoteHost, exec.action.target)) continue;

      // Check time window
      const timeDiff = Math.abs(
        new Date(witness.ts).getTime() - new Date(exec.ts).getTime(),
      );
      if (timeDiff > NETWORK_TIME_WINDOW_MS) continue;

      const discrepancies: CorrelationFinding[] = [];

      // Check network evidence
      const execEvidence = exec.meta?.["networkEvidence"] as
        | { remoteHost?: string; port?: number }
        | undefined;

      if (execEvidence?.remoteHost && execEvidence.remoteHost !== event.remoteHost) {
        discrepancies.push({
          type: "evidence_mismatch",
          severity: "warning",
          description: `Network evidence host mismatch: witness=${event.remoteHost} vs execution=${execEvidence.remoteHost}`,
          execution: exec,
          witnessEvent: witness,
          details: {
            witnessHost: event.remoteHost,
            executionHost: execEvidence.remoteHost,
          },
        });
      }

      if (execEvidence?.port !== undefined && event.remotePort !== undefined) {
        if (execEvidence.port !== event.remotePort) {
          discrepancies.push({
            type: "evidence_mismatch",
            severity: "warning",
            description: `Port mismatch: witness=${event.remotePort} vs execution=${execEvidence.port}`,
            execution: exec,
            witnessEvent: witness,
            details: {
              witnessPort: event.remotePort,
              executionPort: execEvidence.port,
            },
          });
        }
      }

      // Timing discrepancy
      if (timeDiff > 5000) {
        discrepancies.push({
          type: "timing_discrepancy",
          severity: timeDiff > 30_000 ? "critical" : "info",
          description: `Timing difference of ${(timeDiff / 1000).toFixed(1)}s between witness and execution`,
          execution: exec,
          witnessEvent: witness,
          details: { timeDiffMs: timeDiff },
        });
      }

      let confidence = 100;
      if (timeDiff > 5000) confidence -= 10;
      if (discrepancies.some((d) => d.type === "evidence_mismatch")) confidence -= 15;
      confidence = Math.max(0, confidence);

      matches.push({
        witnessEntry: witness,
        executionEntry: exec,
        confidence,
        discrepancies,
      });
    }
  }

  return matches;
}
