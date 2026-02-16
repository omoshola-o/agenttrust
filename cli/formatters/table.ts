import Table from "cli-table3";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type { ClaimEntry } from "../../src/ledger/claim.js";
import type { LedgerStats } from "../../src/ledger/ledger.js";
import type { IntegrityReport } from "../../src/ledger/integrity.js";
import type { ConsistencyReport } from "../../src/consistency/types.js";
import type { CorrelationReport } from "../../src/correlation/types.js";
import type { TrustVerdict } from "../../src/correlation/types.js";
import { colorizeRisk, colorizeStatus, colorizeSeverity, colorizeTrustLevel, icons } from "./color.js";

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatEntriesTable(entries: readonly ATFEntry[]): string {
  if (entries.length === 0) return "No entries found.";

  const table = new Table({
    head: ["Time", "Action", "Target", "Risk", "Status"],
    colWidths: [20, 20, 30, 8, 10],
    wordWrap: true,
  });

  for (const e of entries) {
    table.push([
      formatTs(e.ts),
      e.action.type,
      truncate(e.action.target, 28),
      colorizeRisk(e.risk.score, String(e.risk.score)),
      colorizeStatus(e.outcome.status, e.outcome.status),
    ]);
  }

  return table.toString();
}

export function formatStatsTable(stats: LedgerStats): string {
  const table = new Table();
  table.push(
    { "Total entries": String(stats.totalEntries) },
    { "Total files": String(stats.totalFiles) },
    { "Oldest entry": stats.oldestEntry ?? "N/A" },
    { "Newest entry": stats.newestEntry ?? "N/A" },
    { Critical: colorizeRisk(10, String(stats.riskyCounts.critical)) },
    { High: colorizeRisk(7, String(stats.riskyCounts.high)) },
    { Medium: colorizeRisk(4, String(stats.riskyCounts.medium)) },
    { Low: colorizeRisk(1, String(stats.riskyCounts.low)) },
  );
  return table.toString();
}

export function formatIntegrityTable(report: IntegrityReport): string {
  const lines: string[] = [];

  if (report.valid) {
    lines.push(`${icons.pass} Integrity check passed`);
  } else {
    lines.push(`${icons.fail} Integrity check FAILED`);
  }

  lines.push(`  Files checked: ${report.filesChecked}`);
  lines.push(`  Total entries: ${report.totalEntries}`);
  lines.push(`  Errors: ${report.errors.length}`);

  if (report.errors.length > 0) {
    lines.push("");
    const table = new Table({
      head: ["File", "Line", "Type", "Detail"],
      colWidths: [30, 8, 18, 40],
      wordWrap: true,
    });
    for (const err of report.errors) {
      table.push([truncate(err.file, 28), String(err.line), err.type, truncate(err.detail, 38)]);
    }
    lines.push(table.toString());
  }

  return lines.join("\n");
}

export function formatClaimsTable(claims: readonly ClaimEntry[]): string {
  if (claims.length === 0) return "No claims found.";

  const table = new Table({
    head: ["Time", "Action", "Target", "Risk", "Scope"],
    colWidths: [20, 20, 30, 8, 10],
    wordWrap: true,
  });

  for (const c of claims) {
    table.push([
      formatTs(c.ts),
      c.intent.plannedAction,
      truncate(c.intent.plannedTarget, 28),
      colorizeRisk(c.intent.selfAssessedRisk, String(c.intent.selfAssessedRisk)),
      c.constraints.withinScope ? icons.pass : icons.warn,
    ]);
  }

  return table.toString();
}

export function formatPairedTable(claims: readonly ClaimEntry[], executions: readonly ATFEntry[]): string {
  if (claims.length === 0 && executions.length === 0) return "No claims or executions found.";

  const execMap = new Map<string, ATFEntry>();
  for (const e of executions) {
    const claimId = (e.meta as Record<string, unknown> | undefined)?.["claimId"];
    if (typeof claimId === "string") {
      execMap.set(claimId, e);
    }
  }

  const lines: string[] = [];
  const table = new Table({
    head: ["Claim Time", "Planned", "Target", "Execution", "Status"],
    colWidths: [20, 18, 24, 14, 10],
    wordWrap: true,
  });

  const pairedExecIds = new Set<string>();

  for (const c of claims) {
    const exec = execMap.get(c.id);
    if (exec) {
      pairedExecIds.add(exec.id);
      table.push([
        formatTs(c.ts),
        c.intent.plannedAction,
        truncate(c.intent.plannedTarget, 22),
        truncate(exec.id, 12),
        colorizeStatus(exec.outcome.status, exec.outcome.status),
      ]);
    } else {
      table.push([
        formatTs(c.ts),
        c.intent.plannedAction,
        truncate(c.intent.plannedTarget, 22),
        icons.warn + " none",
        "unfulfilled",
      ]);
    }
  }

  for (const e of executions) {
    if (!pairedExecIds.has(e.id)) {
      table.push([
        formatTs(e.ts),
        e.action.type,
        truncate(e.action.target, 22),
        truncate(e.id, 12),
        icons.info + " unclaimed",
      ]);
    }
  }

  lines.push(table.toString());
  lines.push(`\n${claims.length} claims, ${executions.length} executions, ${pairedExecIds.size} paired`);
  return lines.join("\n");
}

export function formatConsistencyReport(report: ConsistencyReport): string {
  const lines: string[] = [];

  lines.push("\nAgentTrust Consistency Report");
  const from = formatTs(report.timeRange.from);
  const to = formatTs(report.timeRange.to);
  lines.push(`Period: ${from} \u2014 ${to}\n`);

  // Summary table
  lines.push("Summary");
  const summary = new Table();
  summary.push(
    { "Total Claims": String(report.summary.totalClaims) },
    { "Total Executions": String(report.summary.totalExecutions) },
    { Paired: String(report.summary.pairedCount) },
    { "Unclaimed Executions": String(report.summary.unclaimedExecutions) },
    { "Unfulfilled Claims": String(report.summary.unfulfilledClaims) },
    { "Divergent Pairs": String(report.summary.divergentPairs) },
    { "Consistent Pairs": String(report.summary.consistentPairs) },
  );
  lines.push(summary.toString());

  // Score
  const scoreText = `${report.consistencyScore}/100`;
  const colorized =
    report.consistencyScore >= 90
      ? colorizeRisk(0, scoreText)
      : report.consistencyScore >= 70
        ? colorizeRisk(5, scoreText)
        : colorizeRisk(9, scoreText);
  lines.push(`\nConsistency Score: ${colorized}\n`);

  // Findings
  if (report.findings.length > 0) {
    lines.push(`Findings (${report.findings.length})`);
    for (const f of report.findings) {
      const severityIcon =
        f.severity === "critical" ? icons.fail : f.severity === "warning" ? icons.warn : icons.info;
      lines.push(
        `  ${severityIcon} ${colorizeSeverity(f.severity, f.type)} \u2014 ${f.description}`,
      );
      const parts: string[] = [];
      if (f.claim) parts.push(`Claim: ${f.claim.id.slice(0, 9)}... (${formatTs(f.claim.ts)})`);
      if (f.execution) parts.push(`Execution: ${f.execution.id.slice(0, 9)}... (${formatTs(f.execution.ts)})`);
      parts.push(`Severity: ${f.severity.toUpperCase()}`);
      lines.push(`    ${parts.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

export function formatCorrelationReport(report: CorrelationReport, showMatches: boolean): string {
  const lines: string[] = [];

  lines.push("\nAgentTrust Correlation Report");
  const from = formatTs(report.timeRange.from);
  const to = formatTs(report.timeRange.to);
  lines.push(`Period: ${from} \u2014 ${to}\n`);

  // Summary table
  lines.push("Summary");
  const summary = new Table();
  summary.push(
    { "Witness Events": String(report.summary.totalWitnessEvents) },
    { "Execution Entries": String(report.summary.totalExecutionEntries) },
    { "Correlated Pairs": String(report.summary.correlatedPairs) },
    { "Unwitnessed Executions": String(report.summary.unwitnessedExecutions) },
    { "Unlogged Observations": String(report.summary.unloggedObservations) },
    { "Mismatched Pairs": String(report.summary.mismatchedPairs) },
    { "Background Noise": String(report.summary.backgroundNoise) },
    { "Infrastructure Traffic": String(report.summary.infrastructureTraffic) },
  );
  lines.push(summary.toString());

  // Confidence score
  const confText = `${report.witnessConfidence}/100`;
  const confColor =
    report.witnessConfidence >= 90
      ? colorizeRisk(0, confText)
      : report.witnessConfidence >= 70
        ? colorizeRisk(5, confText)
        : colorizeRisk(9, confText);
  lines.push(`\nWitness Confidence: ${confColor}\n`);

  // Findings
  if (report.findings.length > 0) {
    lines.push(`Findings (${report.findings.length})`);
    for (const f of report.findings) {
      const severityIcon =
        f.severity === "critical" ? icons.fail : f.severity === "warning" ? icons.warn : icons.info;
      lines.push(`  ${severityIcon} ${colorizeSeverity(f.severity, f.type)} \u2014 ${f.description}`);

      const parts: string[] = [];
      if (f.execution) parts.push(`Execution: ${f.execution.id.slice(0, 9)}... (${formatTs(f.execution.ts)})`);
      if (f.witnessEvent) parts.push(`Witness: ${f.witnessEvent.id.slice(0, 9)}... (${formatTs(f.witnessEvent.ts)})`);
      parts.push(`Severity: ${f.severity.toUpperCase()}`);
      lines.push(`    ${parts.join(" | ")}`);
    }
  } else {
    lines.push(`${icons.pass} No findings \u2014 witness observations are consistent with execution logs.`);
  }

  // Matched pairs
  if (showMatches && report.matches.length > 0) {
    lines.push(`\nMatched Pairs (${report.matches.length})`);
    const matchTable = new Table({
      head: ["Witness ID", "Exec ID", "Source", "Confidence", "Discrepancies"],
      colWidths: [16, 16, 14, 14, 12],
      wordWrap: true,
    });
    for (const m of report.matches) {
      matchTable.push([
        truncate(m.witnessEntry.id, 14),
        truncate(m.executionEntry.id, 14),
        m.witnessEntry.source,
        `${m.confidence}%`,
        String(m.discrepancies.length),
      ]);
    }
    lines.push(matchTable.toString());
  }

  // Filtered events note
  const bgNoise = report.summary.backgroundNoise;
  const infraTraffic = report.summary.infrastructureTraffic;
  if (bgNoise > 0 || infraTraffic > 0) {
    const parts: string[] = [];
    if (bgNoise > 0) parts.push(`${bgNoise} background`);
    if (infraTraffic > 0) parts.push(`${infraTraffic} infrastructure`);
    lines.push(
      `\nNote: ${parts.join(" + ")} event(s) filtered`,
    );
  }

  return lines.join("\n");
}

export function formatTrustVerdict(verdict: TrustVerdict, period: string): string {
  const lines: string[] = [];

  lines.push("\nAgentTrust Trust Verdict");
  lines.push(`Period: last ${period}\n`);

  // Trust score box
  const levelText = verdict.level.toUpperCase();
  const scoreText = `TRUST SCORE: ${verdict.trustScore}/100 \u2014 ${levelText}`;
  lines.push(colorizeTrustLevel(verdict.level, `  ${scoreText}`));
  lines.push("");

  // Components table
  lines.push("Components");
  const compTable = new Table({
    head: ["Component", "Score", "Status"],
    colWidths: [28, 10, 40],
    wordWrap: true,
  });

  const intStatus =
    verdict.components.integrity === 100
      ? `${icons.pass} All chains intact`
      : verdict.components.integrity > 0
        ? `${icons.warn} Some integrity issues`
        : `${icons.fail} Integrity verification failed`;

  const consStatus =
    verdict.components.consistency >= 95
      ? `${icons.pass} Fully consistent`
      : verdict.components.consistency >= 70
        ? `${icons.warn} Minor inconsistencies`
        : `${icons.fail} Significant mismatches`;

  const witStatus =
    verdict.components.witnessConfidence >= 95
      ? `${icons.pass} Fully corroborated`
      : verdict.components.witnessConfidence >= 70
        ? `${icons.warn} Some uncorroborated actions`
        : `${icons.fail} Significant witness concerns`;

  compTable.push(
    ["Integrity (hash chains)", String(verdict.components.integrity), intStatus],
    ["Consistency (intent)", String(verdict.components.consistency), consStatus],
    ["Witness (independent)", String(verdict.components.witnessConfidence), witStatus],
  );
  lines.push(compTable.toString());

  // Explanation
  lines.push("\nExplanation:");
  lines.push(`  ${verdict.explanation}`);

  return lines.join("\n");
}
