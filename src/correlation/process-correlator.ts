import type { ATFEntry } from "../ledger/entry.js";
import type { WitnessEntry, ProcessWitnessEvent } from "../witness/types.js";
import type { CorrelationMatch, CorrelationFinding } from "./types.js";

/** Maximum time difference (ms) for a process event match */
const PROCESS_TIME_WINDOW_MS = 5_000;

/** Action types that correspond to process operations */
const PROCESS_ACTION_TYPES = new Set(["exec.command", "exec.script"]);

/**
 * Check if a witness command matches an execution target.
 * Fuzzy matching: strip path prefixes, compare base command + args.
 */
export function commandMatches(witnessCmd: string, executionTarget: string): boolean {
  // Normalize both
  const normWitness = normalizeCommand(witnessCmd);
  const normExec = normalizeCommand(executionTarget);

  // Exact match
  if (normWitness === normExec) return true;

  // One contains the other
  if (normWitness.includes(normExec) || normExec.includes(normWitness)) return true;

  // Base command match (first token)
  const witnessBase = normWitness.split(/\s+/)[0] ?? "";
  const execBase = normExec.split(/\s+/)[0] ?? "";

  // Strip path prefixes from base command
  const witnessBaseCmd = witnessBase.split("/").pop() ?? "";
  const execBaseCmd = execBase.split("/").pop() ?? "";

  if (witnessBaseCmd.length > 0 && witnessBaseCmd === execBaseCmd) return true;

  return false;
}

/**
 * Normalize a command string for comparison.
 */
function normalizeCommand(cmd: string): string {
  return cmd.trim().replace(/\s+/g, " ");
}

/**
 * Correlate process witness events with exec.* execution entries.
 */
export function correlateProcessEvents(
  witnessEntries: WitnessEntry[],
  executions: ATFEntry[],
): CorrelationMatch[] {
  const matches: CorrelationMatch[] = [];
  const processWitnesses = witnessEntries.filter(
    (w) => w.source === "process" && (w.event as ProcessWitnessEvent).type === "process_spawned",
  );
  const processExecs = executions.filter((e) => PROCESS_ACTION_TYPES.has(e.action.type));

  for (const witness of processWitnesses) {
    const event = witness.event as ProcessWitnessEvent;

    for (const exec of processExecs) {
      // Check command match
      if (!commandMatches(event.command, exec.action.target)) continue;

      // Check time window
      const timeDiff = Math.abs(
        new Date(witness.ts).getTime() - new Date(exec.ts).getTime(),
      );
      if (timeDiff > PROCESS_TIME_WINDOW_MS) continue;

      const discrepancies: CorrelationFinding[] = [];

      // Check PID evidence
      const execEvidence = exec.meta?.["processEvidence"] as
        | { pid?: number; exitCode?: number }
        | undefined;

      if (execEvidence?.pid !== undefined && execEvidence.pid !== event.pid) {
        discrepancies.push({
          type: "evidence_mismatch",
          severity: "warning",
          description: `PID mismatch: witness observed PID ${event.pid}, execution claimed PID ${execEvidence.pid}`,
          execution: exec,
          witnessEvent: witness,
          details: {
            witnessPid: event.pid,
            executionPid: execEvidence.pid,
          },
        });
      }

      // Timing discrepancy
      if (timeDiff > 2000) {
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
      if (timeDiff > 2000) confidence -= 10;
      if (discrepancies.some((d) => d.type === "evidence_mismatch")) confidence -= 20;
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
