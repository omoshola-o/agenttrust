import chalk from "chalk";
import type { ATFEntry } from "../ledger/entry.js";
import type { ClaimEntry } from "../ledger/claim.js";
import type { RuleMatch } from "../analyzer/types.js";
import type { WatchSummary } from "./watcher.js";

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toISOString().slice(11, 19);
}

function riskIcon(score: number): string {
  if (score >= 9) return chalk.red("\uD83D\uDD34");
  if (score >= 7) return chalk.red("\uD83D\uDFE0");
  if (score >= 4) return chalk.yellow("\uD83D\uDFE1");
  return chalk.green("\uD83D\uDFE2");
}

function severityColor(text: string, severity: string): string {
  switch (severity) {
    case "critical":
      return chalk.red.bold(text);
    case "high":
      return chalk.red(text);
    case "medium":
      return chalk.yellow(text);
    default:
      return chalk.green(text);
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

/**
 * Render a compact one-line summary of an entry.
 */
export function renderCompact(entry: ATFEntry, matches: RuleMatch[]): string {
  const time = formatTime(entry.ts);
  const icon = riskIcon(entry.risk.score);
  const action = entry.action.type.padEnd(16);
  const target = truncate(entry.action.target, 45).padEnd(45);
  const risk = `risk:${entry.risk.score}`;

  const ruleHint = matches.length > 0
    ? ` \u2190 ${matches.map((m) => m.ruleId).join(", ")}`
    : "";

  return `[${time}] ${icon} ${action} ${target} ${risk}${ruleHint}`;
}

/**
 * Render a detailed multi-line summary of an entry.
 */
export function renderDetailed(
  entry: ATFEntry,
  matches: RuleMatch[],
  claim?: ClaimEntry,
): string {
  const time = formatTime(entry.ts);
  const lines: string[] = [];

  lines.push(chalk.dim(`\u250C\u2500 ${time} ${"─".repeat(50)}`));
  lines.push(`\u2502 Action:  ${entry.action.type}`);
  lines.push(`\u2502 Target:  ${entry.action.target}`);
  lines.push(`\u2502 Goal:    ${entry.context.goal}`);

  const durationStr = entry.outcome.durationMs
    ? ` (${entry.outcome.durationMs}ms)`
    : "";
  lines.push(`\u2502 Status:  ${entry.outcome.status}${durationStr}`);

  const riskLevel =
    entry.risk.score >= 9
      ? "CRITICAL"
      : entry.risk.score >= 7
        ? "HIGH"
        : entry.risk.score >= 4
          ? "MEDIUM"
          : "LOW";
  lines.push(
    `\u2502 Risk:    ${entry.risk.score}/10 ${severityColor(riskLevel, riskLevel.toLowerCase())}`,
  );

  if (matches.length > 0) {
    const ruleStr = matches.map((m) => `${m.ruleId} (${m.reason})`).join(", ");
    lines.push(`\u2502 Rules:   ${ruleStr}`);
  }

  if (claim) {
    lines.push(
      `\u2502 Claim:   ${claim.intent.plannedAction} on ${claim.intent.plannedTarget}`,
    );
  } else if (matches.length > 0) {
    lines.push(`\u2502 Claim:   \u2717 unclaimed`);
  }

  if (entry.risk.labels.length > 0) {
    lines.push(`\u2502 Labels:  ${entry.risk.labels.join(", ")}`);
  }

  lines.push(chalk.dim(`\u2514${"─".repeat(57)}`));

  return lines.join("\n");
}

/**
 * Render a claim arrival notification.
 */
export function renderClaimArrival(claim: ClaimEntry): string {
  const time = formatTime(claim.ts);
  const action = claim.intent.plannedAction;
  const target = truncate(claim.intent.plannedTarget, 40);
  const risk = claim.intent.selfAssessedRisk;

  return chalk.cyan(
    `[${time}] \uD83D\uDCCB CLAIM: ${action} on ${target} (self-risk: ${risk})`,
  );
}

/**
 * Render the watch exit summary.
 */
export function renderWatchSummary(summary: WatchSummary): string {
  const durationMin = Math.round(summary.durationMs / 60_000);
  const durationStr = durationMin > 0 ? `${durationMin} minutes` : `${Math.round(summary.durationMs / 1000)}s`;

  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold(`Watch Summary (${durationStr})`));
  lines.push(`  Entries seen: ${summary.entriesSeen}`);
  if (summary.claimsSeen > 0) {
    lines.push(`  Claims seen: ${summary.claimsSeen}`);
  }
  lines.push(`  Rules triggered: ${summary.rulesTriggered}`);
  lines.push(
    `  Critical: ${summary.bySeverity.critical} | High: ${summary.bySeverity.high} | Medium: ${summary.bySeverity.medium} | Low: ${summary.bySeverity.low}`,
  );

  return lines.join("\n");
}
