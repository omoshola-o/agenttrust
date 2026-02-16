import { normalize } from "node:path";
import type { ATFEntry } from "../ledger/entry.js";
import type { WitnessEntry, FileWitnessEvent } from "../witness/types.js";
import type { CorrelationMatch, CorrelationFinding } from "./types.js";

/** Maximum time difference (ms) for a file event match */
const FILE_TIME_WINDOW_MS = 10_000;

/** Action types that correspond to file operations */
const FILE_ACTION_TYPES = new Set(["file.read", "file.write", "file.delete"]);

/** Sensitive file path patterns */
const SENSITIVE_PATHS = [
  "/.ssh/",
  "/.env",
  "/.gnupg/",
  "/credentials",
  "/.aws/",
  "/.config/",
  "/id_rsa",
  "/id_ed25519",
  "/authorized_keys",
];

function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return SENSITIVE_PATHS.some((p) => lower.includes(p));
}

/**
 * Check if a witness file path matches an execution target.
 * Normalizes both paths and does prefix/suffix matching.
 */
export function pathMatches(witnessPath: string, executionTarget: string): boolean {
  const normWitness = normalize(witnessPath);
  const normExec = normalize(executionTarget);

  // Exact match
  if (normWitness === normExec) return true;

  // One may be absolute and the other relative
  if (normWitness.endsWith(normExec) || normExec.endsWith(normWitness)) return true;

  // Basename match for short targets
  const witnessBase = normWitness.split("/").pop() ?? "";
  const execBase = normExec.split("/").pop() ?? "";
  if (witnessBase === execBase && witnessBase.length > 0) return true;

  return false;
}

/**
 * Map witness event type to expected execution action type.
 */
function eventTypeToActionType(eventType: FileWitnessEvent["type"]): string | null {
  switch (eventType) {
    case "file_created":
    case "file_modified":
      return "file.write";
    case "file_deleted":
      return "file.delete";
    case "file_accessed":
      return "file.read";
    default:
      return null;
  }
}

/**
 * Verify file evidence between a witness event and execution entry.
 */
function verifyFileEvidence(
  witnessEvent: FileWitnessEvent,
  execution: ATFEntry,
): CorrelationFinding[] {
  const findings: CorrelationFinding[] = [];

  // Check content hash if available
  const witnessHash = witnessEvent.stat?.contentHashPrefix;
  const execEvidence = execution.meta?.["fileEvidence"] as
    | { contentHashPrefix?: string; sizeBytes?: number }
    | undefined;

  if (witnessHash && execEvidence?.contentHashPrefix) {
    if (witnessHash !== execEvidence.contentHashPrefix) {
      findings.push({
        type: "evidence_mismatch",
        severity: isSensitivePath(witnessEvent.path) ? "critical" : "warning",
        description: `Content hash mismatch: witness=${witnessHash.slice(0, 16)}... vs execution=${execEvidence.contentHashPrefix.slice(0, 16)}...`,
        details: {
          witnessHash,
          executionHash: execEvidence.contentHashPrefix,
          path: witnessEvent.path,
        },
      });
    }
  }

  // Check file size if available
  if (witnessEvent.stat?.sizeBytes !== undefined && execEvidence?.sizeBytes !== undefined) {
    if (witnessEvent.stat.sizeBytes !== execEvidence.sizeBytes) {
      findings.push({
        type: "evidence_mismatch",
        severity: "warning",
        description: `File size mismatch: witness=${witnessEvent.stat.sizeBytes} bytes vs execution=${execEvidence.sizeBytes} bytes`,
        details: {
          witnessSize: witnessEvent.stat.sizeBytes,
          executionSize: execEvidence.sizeBytes,
          path: witnessEvent.path,
        },
      });
    }
  }

  return findings;
}

/**
 * Correlate file witness events with file.* execution entries.
 */
export function correlateFileEvents(
  witnessEntries: WitnessEntry[],
  executions: ATFEntry[],
): CorrelationMatch[] {
  const matches: CorrelationMatch[] = [];
  const fileWitnesses = witnessEntries.filter((w) => w.source === "filesystem");
  const fileExecs = executions.filter((e) => FILE_ACTION_TYPES.has(e.action.type));

  for (const witness of fileWitnesses) {
    const event = witness.event as FileWitnessEvent;
    const expectedActionType = eventTypeToActionType(event.type);

    for (const exec of fileExecs) {
      // Check path match
      if (!pathMatches(event.path, exec.action.target)) continue;

      // Check time window
      const timeDiff = Math.abs(
        new Date(witness.ts).getTime() - new Date(exec.ts).getTime(),
      );
      if (timeDiff > FILE_TIME_WINDOW_MS) continue;

      // Check discrepancies
      const discrepancies: CorrelationFinding[] = [];

      // Action type mismatch (e.g., witness saw delete, agent logged write)
      if (expectedActionType && exec.action.type !== expectedActionType) {
        discrepancies.push({
          type: "target_discrepancy",
          severity: "critical",
          description: `Witness saw ${event.type} but agent logged ${exec.action.type} on ${event.path}`,
          execution: exec,
          witnessEvent: witness,
          details: {
            witnessEventType: event.type,
            executionActionType: exec.action.type,
            path: event.path,
          },
        });
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

      // Evidence verification
      const evidenceFindings = verifyFileEvidence(event, exec);
      discrepancies.push(...evidenceFindings);

      // Compute confidence
      let confidence = 100;
      if (timeDiff > 5000) confidence -= 10;
      if (discrepancies.some((d) => d.type === "target_discrepancy")) confidence -= 30;
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
