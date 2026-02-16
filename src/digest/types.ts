import type { ActionType } from "../schema/action-types.js";
import type { ATFEntry } from "../ledger/entry.js";
import type { RuleMatch } from "../analyzer/types.js";
import type { ConsistencyFinding } from "../consistency/types.js";
import type { BlameReport } from "../replay/types.js";

export interface DigestConfig {
  /** Output directory for digest files */
  outputDir: string;

  /** Which digest types to generate */
  types: ("daily" | "weekly")[];

  /** Minimum risk score to include in highlights */
  highlightThreshold: number;

  /** Maximum entries to show in detail (rest are summarized) */
  maxDetailEntries: number;
}

export const DEFAULT_DIGEST_CONFIG: DigestConfig = {
  outputDir: "",
  types: ["daily"],
  highlightThreshold: 7,
  maxDetailEntries: 20,
};

export interface DigestData {
  /** Time range covered */
  period: {
    from: string;
    to: string;
    label: string;
  };

  /** Activity summary */
  activity: {
    totalActions: number;
    byType: Partial<Record<ActionType, number>>;
    byRiskLevel: { low: number; medium: number; high: number; critical: number };
    byStatus: Record<string, number>;
    uniqueSessions: number;
    uniqueTargets: number;
  };

  /** Risk highlights */
  highlights: {
    ruleMatches: Array<{ entry: ATFEntry; matches: RuleMatch[] }>;
    highRiskEntries: ATFEntry[];
    consistencyFindings: ConsistencyFinding[];
  };

  /** Consistency summary */
  consistency: {
    totalClaims: number;
    totalExecutions: number;
    consistencyScore: number;
    topFindings: ConsistencyFinding[];
  };

  /** Blame chains for high-risk incidents */
  incidents: BlameReport[];

  /** Action timeline (abbreviated) */
  timeline: Array<{ ts: string; action: string; target: string; risk: number }>;
}
