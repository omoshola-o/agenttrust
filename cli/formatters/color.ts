import chalk from "chalk";
import type { OutcomeStatus } from "../../src/schema/outcome.js";
import type { FindingSeverity } from "../../src/consistency/types.js";
import type { RuleSeverity } from "../../src/analyzer/types.js";
import type { CorrelationSeverity, TrustLevel } from "../../src/correlation/types.js";

export function colorizeRisk(score: number, text: string): string {
  if (score >= 9) return chalk.red.bold(text);
  if (score >= 7) return chalk.red(text);
  if (score >= 4) return chalk.yellow(text);
  return chalk.green(text);
}

export function colorizeStatus(status: OutcomeStatus, text: string): string {
  switch (status) {
    case "success":
      return chalk.green(text);
    case "failure":
      return chalk.red(text);
    case "partial":
    case "blocked":
      return chalk.yellow(text);
  }
}

export function colorizeSeverity(severity: FindingSeverity | RuleSeverity | CorrelationSeverity, text: string): string {
  switch (severity) {
    case "critical":
      return chalk.red.bold(text);
    case "high":
    case "warning":
      return chalk.red(text);
    case "medium":
    case "info":
      return chalk.yellow(text);
    case "low":
      return chalk.blue(text);
  }
}

export function colorizeTrustLevel(level: TrustLevel, text: string): string {
  switch (level) {
    case "verified":
      return chalk.green.bold(text);
    case "high":
      return chalk.blue.bold(text);
    case "moderate":
      return chalk.yellow(text);
    case "low":
      return chalk.red(text);
    case "untrusted":
      return chalk.red.bold(text);
  }
}

export const icons = {
  pass: chalk.green("\u2714"),
  fail: chalk.red("\u2718"),
  warn: chalk.yellow("\u26A0"),
  info: chalk.blue("\u2139"),
} as const;

/**
 * Render a Unicode progress bar colorized by value.
 *
 * @param value — 0 to 100
 * @param width — character width of the bar (default 25)
 * @returns e.g. "████████████░░░░░░░░░░░░░"
 */
export function renderBar(value: number, width = 25): string {
  const clamped = Math.max(0, Math.min(100, value));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);

  if (clamped >= 90) return chalk.green(bar);
  if (clamped >= 70) return chalk.blue(bar);
  if (clamped >= 50) return chalk.yellow(bar);
  return chalk.red(bar);
}

/**
 * Colorize a numeric score based on trust-level thresholds.
 */
export function colorizeScore(score: number, text: string): string {
  if (score >= 90) return chalk.green.bold(text);
  if (score >= 70) return chalk.blue.bold(text);
  if (score >= 50) return chalk.yellow(text);
  return chalk.red(text);
}

/**
 * Render a health status indicator: ok / warn / fail / none.
 */
export function renderHealthStatus(status: "ok" | "warn" | "fail" | "none"): string {
  switch (status) {
    case "ok":
      return chalk.green("ok");
    case "warn":
      return chalk.yellow("warn");
    case "fail":
      return chalk.red("fail");
    case "none":
      return chalk.dim("--");
  }
}
