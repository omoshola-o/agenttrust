import type { Ledger } from "../ledger/ledger.js";
import type { ATFEntry } from "../ledger/entry.js";
import type { ClaimEntry } from "../ledger/claim.js";
import type { ActionType } from "../schema/action-types.js";
import { getRiskLevel } from "../schema/risk.js";
import { RuleEngine } from "../analyzer/engine.js";
import type { RuleEngineConfig, RuleMatch } from "../analyzer/types.js";
import { matchClaimsToExecutions, detectDivergences, computeConsistencyScore } from "../consistency/index.js";
import type { ConsistencyFinding } from "../consistency/types.js";
import { buildGraph, analyzeBlame } from "../replay/index.js";
import type { BlameReport } from "../replay/types.js";
import type { DigestData, DigestConfig } from "./types.js";

function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getStartOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getEndOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function getWeekStartUTC(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday as start
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getWeekEndUTC(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + 6);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

async function loadEntries(
  ledger: Ledger,
  from: Date,
  to: Date,
): Promise<ATFEntry[]> {
  const result = await ledger.read({
    timeRange: { from, to },
  });
  return result.ok ? result.value : [];
}

async function loadClaims(
  ledger: Ledger,
  from: Date,
  to: Date,
): Promise<ClaimEntry[]> {
  try {
    const result = await ledger.readClaims({
      timeRange: { from, to },
    });
    return result.ok ? result.value : [];
  } catch {
    return [];
  }
}

function buildDigestData(
  entries: ATFEntry[],
  claims: ClaimEntry[],
  from: Date,
  to: Date,
  label: string,
  config: DigestConfig,
  engineConfig?: Partial<RuleEngineConfig>,
): DigestData {
  // Activity summary
  const byType: Partial<Record<ActionType, number>> = {};
  const byRiskLevel = { low: 0, medium: 0, high: 0, critical: 0 };
  const byStatus: Record<string, number> = {};
  const sessions = new Set<string>();
  const targets = new Set<string>();

  for (const entry of entries) {
    // By type
    const t = entry.action.type as ActionType;
    byType[t] = (byType[t] ?? 0) + 1;

    // By risk level
    byRiskLevel[getRiskLevel(entry.risk.score)]++;

    // By status
    byStatus[entry.outcome.status] = (byStatus[entry.outcome.status] ?? 0) + 1;

    // Unique sessions/targets
    sessions.add(entry.session);
    targets.add(entry.action.target);
  }

  // Run rules engine
  const engine = new RuleEngine(undefined, engineConfig);
  const report = engine.evaluateBatch(entries, claims);

  // Build rule matches by entry
  const ruleMatchesByEntry = new Map<string, RuleMatch[]>();
  const ruleMatchHighlights: Array<{ entry: ATFEntry; matches: RuleMatch[] }> = [];
  for (const match of report.matches) {
    ruleMatchesByEntry.set(match.entry.id, match.ruleMatches);
    ruleMatchHighlights.push({ entry: match.entry, matches: match.ruleMatches });
  }

  // High risk entries
  const highRiskEntries = entries.filter(
    (e) => e.risk.score >= config.highlightThreshold,
  );

  // Consistency analysis
  let consistencyFindings: ConsistencyFinding[] = [];
  let consistencyScore = 100;
  if (claims.length > 0) {
    try {
      const matchResults = matchClaimsToExecutions(claims, entries);
      consistencyFindings = detectDivergences(matchResults);
      consistencyScore = computeConsistencyScore(consistencyFindings);
    } catch {
      // Consistency is optional
    }
  }

  // Build blame reports for top incidents
  const incidents: BlameReport[] = [];
  const findingsByEntry = new Map<string, ConsistencyFinding>();
  for (const f of consistencyFindings) {
    if (f.execution) {
      findingsByEntry.set(f.execution.id, f);
    }
  }

  const riskyEntries = entries
    .filter((e) => ruleMatchesByEntry.has(e.id))
    .sort((a, b) => {
      const aMax = Math.max(
        ...(ruleMatchesByEntry.get(a.id) ?? []).map((m) => m.riskContribution),
        0,
      );
      const bMax = Math.max(
        ...(ruleMatchesByEntry.get(b.id) ?? []).map((m) => m.riskContribution),
        0,
      );
      return bMax - aMax;
    })
    .slice(0, config.maxDetailEntries);

  if (riskyEntries.length > 0) {
    const graph = buildGraph(entries, {
      claims,
      ruleMatchesByEntry,
      findingsByEntry,
    });

    for (const entry of riskyEntries) {
      try {
        const blame = analyzeBlame(entry, graph, ruleMatchesByEntry, findingsByEntry);
        incidents.push(blame);
      } catch {
        // Skip entries that can't be analyzed
      }
    }
  }

  // Timeline (high-risk only)
  const timeline = entries
    .filter(
      (e) =>
        e.risk.score >= config.highlightThreshold || ruleMatchesByEntry.has(e.id),
    )
    .map((e) => ({
      ts: e.ts,
      action: e.action.type,
      target: e.action.target,
      risk: e.risk.score,
    }));

  return {
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      label,
    },
    activity: {
      totalActions: entries.length,
      byType,
      byRiskLevel,
      byStatus,
      uniqueSessions: sessions.size,
      uniqueTargets: targets.size,
    },
    highlights: {
      ruleMatches: ruleMatchHighlights,
      highRiskEntries,
      consistencyFindings,
    },
    consistency: {
      totalClaims: claims.length,
      totalExecutions: entries.length,
      consistencyScore,
      topFindings: consistencyFindings.slice(0, 10),
    },
    incidents,
    timeline,
  };
}

/**
 * Collect data for a daily digest.
 */
export async function collectDailyData(
  date: Date,
  ledger: Ledger,
  config: DigestConfig,
  engineConfig?: Partial<RuleEngineConfig>,
): Promise<DigestData> {
  const from = getStartOfDayUTC(date);
  const to = getEndOfDayUTC(date);
  const label = formatDateUTC(date);

  const entries = await loadEntries(ledger, from, to);
  const claims = await loadClaims(ledger, from, to);

  return buildDigestData(entries, claims, from, to, label, config, engineConfig);
}

/**
 * Collect data for a weekly digest.
 */
export async function collectWeeklyData(
  weekContainingDate: Date,
  ledger: Ledger,
  config: DigestConfig,
  engineConfig?: Partial<RuleEngineConfig>,
): Promise<DigestData> {
  const from = getWeekStartUTC(weekContainingDate);
  const to = getWeekEndUTC(from);
  const weekNum = getWeekNumber(weekContainingDate);
  const year = from.getUTCFullYear();
  const label = `${year}-W${String(weekNum).padStart(2, "0")}`;

  const entries = await loadEntries(ledger, from, to);
  const claims = await loadClaims(ledger, from, to);

  return buildDigestData(entries, claims, from, to, label, config, engineConfig);
}
