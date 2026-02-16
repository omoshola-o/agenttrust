import type { ATFEntry } from "../ledger/entry.js";
import type { WitnessEntry } from "../witness/types.js";

/** Types of correlation findings */
export type CorrelationFindingType =
  | "unwitnessed_execution"  // Agent says it did X, witness never saw X
  | "unlogged_observation"   // Witness saw X, agent never logged X
  | "target_discrepancy"     // Agent logged target A, witness saw target B
  | "timing_discrepancy"     // Agent timestamp differs from witness by >5s
  | "evidence_mismatch"      // Agent's evidence receipt doesn't match witness
  | "phantom_process"        // Agent logged exec.command but no matching process
  | "silent_network"         // Witness saw network activity not in any log
  | "silent_file_access";    // Witness saw file access not in any log

/** Severity of a correlation finding */
export type CorrelationSeverity = "info" | "warning" | "critical";

/** A single correlation finding */
export interface CorrelationFinding {
  /** Finding type */
  type: CorrelationFindingType;
  /** Severity: info | warning | critical */
  severity: CorrelationSeverity;
  /** Human-readable description */
  description: string;
  /** The execution entry (if exists) */
  execution?: ATFEntry;
  /** The witness event (if exists) */
  witnessEvent?: WitnessEntry;
  /** Specific details */
  details: Record<string, unknown>;
}

/** A matched pair between a witness event and an execution entry */
export interface CorrelationMatch {
  /** The witness entry that was matched */
  witnessEntry: WitnessEntry;
  /** The execution entry that was matched */
  executionEntry: ATFEntry;
  /** Confidence score for this match (0-100) */
  confidence: number;
  /** Any discrepancies found between the pair */
  discrepancies: CorrelationFinding[];
}

/** Result of correlating witness events with execution entries */
export interface CorrelationReport {
  /** Report generation timestamp */
  generatedAt: string;
  /** Time range analyzed */
  timeRange: { from: string; to: string };
  /** Summary */
  summary: {
    totalWitnessEvents: number;
    totalExecutionEntries: number;
    correlatedPairs: number;
    unwitnessedExecutions: number;
    unloggedObservations: number;
    mismatchedPairs: number;
    /** Count of witness events classified as background system noise (filtered out) */
    backgroundNoise: number;
    /** Count of witness events classified as expected agent infrastructure traffic (filtered out) */
    infrastructureTraffic: number;
  };
  /** Individual findings */
  findings: CorrelationFinding[];
  /** All matched pairs */
  matches: CorrelationMatch[];
  /** Overall witness confidence score (0-100) */
  witnessConfidence: number;
}

/**
 * A host pattern for matching infrastructure traffic.
 * Supports:
 * - Exact hostnames: "api.anthropic.com"
 * - Wildcard subdomains: "*.anthropic.com"
 * - IP prefixes: "140.82.112.*"
 * - CIDR-like IP ranges: "3.*" (first octet match)
 */
export interface InfrastructurePattern {
  /** Host pattern (see format above) */
  host: string;
  /** Optional port restriction. If omitted, any port matches. */
  port?: number;
  /** Human-readable label for grouping (e.g., "anthropic", "github") */
  label: string;
}

/** Trust level label */
export type TrustLevel = "verified" | "high" | "moderate" | "low" | "untrusted";

/** Combined trust verdict from all three engines */
export interface TrustVerdict {
  /** Overall trust score (0-100) */
  trustScore: number;
  /** Component scores */
  components: {
    /** Hash chain integrity (from verify) */
    integrity: number;
    /** Claim-execution consistency (from consistency engine) */
    consistency: number;
    /** Witness correlation confidence */
    witnessConfidence: number;
  };
  /** Trust level label */
  level: TrustLevel;
  /** Explanation */
  explanation: string;
}
