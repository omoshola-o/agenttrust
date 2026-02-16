import chalk from "chalk";
import type { TrustVerdict } from "../../src/correlation/types.js";
import { renderBar, colorizeScore, colorizeRisk, renderHealthStatus, colorizeTrustLevel } from "./color.js";

/** All data the status command collects for the dashboard. */
export interface StatusData {
  workspace: string;
  trust: TrustVerdict | null;
  activity: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    period: string;
  };
  health: {
    workspaceValid: boolean;
    ledgerFiles: number;
    ledgerEntries: number;
    chainIntact: boolean | null;
    claimFiles: number;
    claimCount: number;
    witnessFiles: number;
    witnessEventsToday: number;
  };
  lastVerified: string | null;
  findingsCount: number;
  findingsSummary: string | null;
}

// ─── Section Renderers ────────────────────────────────────────────

export function renderHeader(workspace: string): string {
  const lines: string[] = [];
  lines.push(chalk.bold("AgentTrust") + "  Trust & audit layer for AI agents");
  lines.push(chalk.dim("Workspace") + `   ${workspace}`);
  return lines.join("\n");
}

export function renderTrustSection(trust: TrustVerdict | null): string {
  const lines: string[] = [];
  lines.push(chalk.dim("TRUST SCORE"));
  lines.push("");

  if (!trust) {
    lines.push("  --/100");
    lines.push("  No data yet. Start using your agent to see trust metrics.");
    return lines.join("\n");
  }

  const levelText = trust.level.toUpperCase();
  const scoreText = `${trust.trustScore}/100`;
  lines.push("  " + colorizeScore(trust.trustScore, scoreText) + "  " + colorizeTrustLevel(trust.level, levelText));
  lines.push("  " + renderBar(trust.trustScore));
  lines.push("");

  const components: Array<{ label: string; score: number; status: string }> = [
    {
      label: "Integrity",
      score: trust.components.integrity,
      status: trust.components.integrity === 100
        ? "All chains intact"
        : trust.components.integrity > 0
          ? "Some integrity issues"
          : "Integrity verification failed",
    },
    {
      label: "Consistency",
      score: trust.components.consistency,
      status: trust.components.consistency >= 95
        ? "Fully consistent"
        : trust.components.consistency >= 70
          ? "Minor inconsistencies"
          : "Significant mismatches",
    },
    {
      label: "Witness",
      score: trust.components.witnessConfidence,
      status: trust.components.witnessConfidence >= 95
        ? "Fully corroborated"
        : trust.components.witnessConfidence >= 70
          ? "Some uncorroborated actions"
          : "Significant witness concerns",
    },
  ];

  for (const c of components) {
    const scoreStr = String(c.score).padStart(3);
    const label = c.label.padEnd(14);
    lines.push(`  ${label} ${colorizeScore(c.score, scoreStr)}  ${renderBar(c.score)}  ${chalk.dim(c.status)}`);
  }

  return lines.join("\n");
}

export function renderActivitySection(activity: StatusData["activity"]): string {
  const lines: string[] = [];
  lines.push(chalk.dim(`RECENT ACTIVITY`) + chalk.dim(`  (last ${activity.period})`));
  lines.push("");

  if (activity.total === 0) {
    lines.push("  No actions recorded yet.");
    return lines.join("\n");
  }

  lines.push(`  Total actions ${chalk.bold(String(activity.total).padStart(5))}`);
  lines.push(`  Critical     ${colorizeRisk(10, String(activity.critical).padStart(5))}`);
  lines.push(`  High         ${colorizeRisk(7, String(activity.high).padStart(5))}`);
  lines.push(`  Medium       ${colorizeRisk(4, String(activity.medium).padStart(5))}`);
  lines.push(`  Low          ${colorizeRisk(1, String(activity.low).padStart(5))}`);

  return lines.join("\n");
}

export function renderHealthSection(
  health: StatusData["health"],
  lastVerified: string | null,
): string {
  const lines: string[] = [];
  lines.push(chalk.dim("HEALTH"));
  lines.push("");

  // Workspace
  const wsStatus = health.workspaceValid ? "ok" as const : "fail" as const;
  lines.push(`  Workspace     ${renderHealthStatus(wsStatus)}`);

  // Ledger
  const ledgerDetail = health.ledgerFiles > 0
    ? `${health.ledgerFiles} file${health.ledgerFiles === 1 ? "" : "s"}, ${health.ledgerEntries.toLocaleString()} entr${health.ledgerEntries === 1 ? "y" : "ies"}`
    : "No files";
  const ledgerStatus = health.ledgerFiles > 0 ? "ok" as const : "none" as const;
  lines.push(`  Ledger        ${renderHealthStatus(ledgerStatus)}      ${chalk.dim(ledgerDetail)}`);

  // Chain
  const chainStatus = health.chainIntact === null
    ? "none" as const
    : health.chainIntact
      ? "ok" as const
      : "fail" as const;
  const chainDetail = health.chainIntact === null
    ? "No entries"
    : health.chainIntact
      ? "Intact"
      : "Broken";
  lines.push(`  Chain         ${renderHealthStatus(chainStatus)}      ${chalk.dim(chainDetail)}`);

  // Claims
  const claimDetail = health.claimFiles > 0
    ? `${health.claimFiles} file${health.claimFiles === 1 ? "" : "s"}, ${health.claimCount} claim${health.claimCount === 1 ? "" : "s"}`
    : "No files";
  const claimStatus = health.claimFiles > 0 ? "ok" as const : "none" as const;
  lines.push(`  Claims        ${renderHealthStatus(claimStatus)}      ${chalk.dim(claimDetail)}`);

  // Witness
  const witnessDetail = health.witnessFiles > 0
    ? `${health.witnessEventsToday} event${health.witnessEventsToday === 1 ? "" : "s"} today`
    : "Not started";
  const witnessStatus = health.witnessFiles > 0 ? "ok" as const : "none" as const;
  lines.push(`  Witness       ${renderHealthStatus(witnessStatus)}      ${chalk.dim(witnessDetail)}`);

  // Last verified
  if (lastVerified) {
    const d = new Date(lastVerified);
    const formatted = d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    lines.push("");
    lines.push(`  Last verified ${chalk.dim(formatted)}`);
  }

  return lines.join("\n");
}

export function renderFindingsFooter(count: number, summary: string | null): string {
  if (count === 0) return "";
  const lines: string[] = [];
  const desc = summary ?? `${count} finding${count === 1 ? "" : "s"} detected`;
  lines.push(chalk.yellow(`  ${count} finding${count === 1 ? "" : "s"}: ${desc}`));
  lines.push(chalk.dim("  Run 'agenttrust audit' for details."));
  return lines.join("\n");
}

export function renderGettingStarted(): string {
  const lines: string[] = [];
  lines.push(chalk.dim("GETTING STARTED"));
  lines.push("");
  lines.push("  1. Start your agent normally \u2014 AgentTrust observes automatically");
  lines.push("  2. Run " + chalk.bold("agenttrust log") + " to see recorded actions");
  lines.push("  3. Run " + chalk.bold("agenttrust verify") + " to check ledger integrity");
  lines.push("  4. Run " + chalk.bold("agenttrust trust") + " for a full trust report");
  lines.push("  5. Run " + chalk.bold("agenttrust witness start") + " for independent monitoring");
  return lines.join("\n");
}

export function renderNoWorkspace(): string {
  const lines: string[] = [];
  lines.push(chalk.bold("AgentTrust") + "  Trust & audit layer for AI agents");
  lines.push("");
  lines.push("  No workspace found.");
  lines.push("");
  lines.push("  Run " + chalk.bold("agenttrust init") + " to create one, or pass " + chalk.bold("--workspace <path>") + ".");
  return lines.join("\n");
}

// ─── Composers ────────────────────────────────────────────────────

export function formatStatusDashboard(data: StatusData): string {
  const sections: string[] = [];

  sections.push(renderHeader(data.workspace));
  sections.push(""); // blank separator

  // Trust score section
  sections.push(renderTrustSection(data.trust));
  sections.push(""); // blank separator

  // If no trust data, show getting started instead of activity/health
  if (!data.trust) {
    sections.push(renderGettingStarted());
    sections.push(""); // blank separator
  }

  // Activity section
  sections.push(renderActivitySection(data.activity));
  sections.push(""); // blank separator

  // Health section
  sections.push(renderHealthSection(data.health, data.lastVerified));

  // Findings footer
  const footer = renderFindingsFooter(data.findingsCount, data.findingsSummary);
  if (footer) {
    sections.push(""); // blank separator
    sections.push(footer);
  }

  return sections.join("\n");
}

export function formatStatusJson(data: StatusData): string {
  const json: Record<string, unknown> = {
    trust: data.trust
      ? {
          score: data.trust.trustScore,
          level: data.trust.level,
          components: {
            integrity: data.trust.components.integrity,
            consistency: data.trust.components.consistency,
            witnessConfidence: data.trust.components.witnessConfidence,
          },
        }
      : null,
    activity: {
      period: data.activity.period,
      total: data.activity.total,
      risk: {
        critical: data.activity.critical,
        high: data.activity.high,
        medium: data.activity.medium,
        low: data.activity.low,
      },
    },
    health: {
      workspace: data.health.workspaceValid,
      ledgerFiles: data.health.ledgerFiles,
      ledgerEntries: data.health.ledgerEntries,
      chainIntact: data.health.chainIntact,
      claimFiles: data.health.claimFiles,
      claimCount: data.health.claimCount,
      witnessFiles: data.health.witnessFiles,
      witnessEventsToday: data.health.witnessEventsToday,
    },
    lastVerified: data.lastVerified,
    findings: data.findingsCount,
  };

  return JSON.stringify(json, null, 2);
}
