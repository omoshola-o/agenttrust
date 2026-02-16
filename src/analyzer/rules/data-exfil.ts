import type { RiskRule, RuleContext } from "../types.js";
import type { ATFEntry } from "../../ledger/entry.js";

const EXFIL_WINDOW_MS = 60_000;

function isSensitivePath(target: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(target));
}

function isNetworkAction(type: string): boolean {
  return type === "api.call" || type === "web.fetch" || type === "web.search";
}

function findRecentSensitiveRead(
  entry: ATFEntry,
  history: ATFEntry[],
  patterns: string[],
): ATFEntry | undefined {
  const entryTime = new Date(entry.ts).getTime();
  for (let i = history.length - 1; i >= 0; i--) {
    const prev = history[i]!;
    if (prev.id === entry.id) continue;
    const prevTime = new Date(prev.ts).getTime();
    if (entryTime - prevTime > EXFIL_WINDOW_MS) break;
    if (prev.action.type === "file.read" && isSensitivePath(prev.action.target, patterns)) {
      return prev;
    }
  }
  return undefined;
}

export const sensitiveFileThenNetwork: RiskRule = {
  id: "exfil-001",
  name: "sensitive_file_then_network",
  category: "data_exfil",
  severity: "critical",
  description:
    "Detects a sensitive file read followed by a network call within 60 seconds (potential data exfiltration pattern)",
  enabledByDefault: true,
  evaluate(entry: ATFEntry, context: RuleContext) {
    if (!isNetworkAction(entry.action.type)) return null;

    const sensitiveRead = findRecentSensitiveRead(
      entry,
      context.sessionHistory,
      context.config.sensitivePathPatterns,
    );

    if (!sensitiveRead) return null;

    const timeDiff = new Date(entry.ts).getTime() - new Date(sensitiveRead.ts).getTime();
    const seconds = Math.round(timeDiff / 1000);

    return {
      ruleId: "exfil-001",
      severity: "critical",
      reason: `Sensitive file read followed by network call within ${seconds}s`,
      riskContribution: 10,
      labels: ["data_access"],
      evidence: {
        sensitiveFile: sensitiveRead.action.target,
        networkTarget: entry.action.target,
        timeDeltaMs: timeDiff,
        sensitiveEntryId: sensitiveRead.id,
      },
    };
  },
};

export const dataExfilRules: RiskRule[] = [sensitiveFileThenNetwork];
