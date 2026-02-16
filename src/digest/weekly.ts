import type { DigestData } from "./types.js";

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(isoStr: string): string {
  return new Date(isoStr).toISOString().slice(11, 19);
}

function riskEmoji(risk: number): string {
  if (risk >= 9) return "\uD83D\uDD34";
  if (risk >= 7) return "\uD83D\uDFE1";
  if (risk >= 4) return "\uD83D\uDFE0";
  return "\uD83D\uDFE2";
}

function severityLabel(risk: number): string {
  if (risk >= 9) return "CRITICAL";
  if (risk >= 7) return "HIGH";
  if (risk >= 4) return "MEDIUM";
  return "LOW";
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "..." : str;
}

/**
 * Generate a weekly markdown digest from collected data.
 */
export function generateWeeklyDigest(data: DigestData): string {
  const lines: string[] = [];
  const fromLabel = formatDate(data.period.from);
  const toLabel = formatDate(data.period.to);

  // Header
  lines.push(`# AgentTrust Weekly Digest \u2014 ${data.period.label}`);
  lines.push(`> ${fromLabel} \u2014 ${toLabel}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push(`- **Total actions**: ${data.activity.totalActions}`);
  lines.push(`- **Sessions**: ${data.activity.uniqueSessions}`);
  lines.push(`- **Unique targets**: ${data.activity.uniqueTargets}`);
  lines.push(`- **Consistency score**: ${data.consistency.consistencyScore}/100`);

  const ruleMatchCount = data.highlights.ruleMatches.length;
  lines.push(
    `- **Risk alerts**: ${ruleMatchCount} (${data.activity.byRiskLevel.critical} critical, ${data.activity.byRiskLevel.high} high, ${data.activity.byRiskLevel.medium} medium)`,
  );
  lines.push("");

  // Risk Overview
  lines.push("## Risk Overview");
  lines.push("");
  lines.push("| Level | Count |");
  lines.push("|---|---|");
  lines.push(`| \uD83D\uDD34 Critical | ${data.activity.byRiskLevel.critical} |`);
  lines.push(`| \uD83D\uDFE1 High | ${data.activity.byRiskLevel.high} |`);
  lines.push(`| \uD83D\uDFE0 Medium | ${data.activity.byRiskLevel.medium} |`);
  lines.push(`| \uD83D\uDFE2 Low | ${data.activity.byRiskLevel.low} |`);
  lines.push("");

  // Risk Highlights
  if (data.highlights.ruleMatches.length > 0) {
    lines.push("## Risk Highlights");
    lines.push("");

    for (const { entry, matches } of data.highlights.ruleMatches) {
      const maxSeverity = Math.max(...matches.map((m) => m.riskContribution));
      const emoji = riskEmoji(maxSeverity);
      const sev = severityLabel(maxSeverity);
      const ruleIds = matches.map((m) => m.ruleId).join(", ");
      const time = formatTime(entry.ts);
      const date = formatDate(entry.ts);

      lines.push(
        `### ${emoji} ${sev}: ${matches[0]!.reason}`,
      );
      lines.push(`**When**: ${date} at ${time}`);
      lines.push(`**Action**: \`${entry.action.type}\` on \`${truncate(entry.action.target, 60)}\``);
      lines.push(`**Rule**: ${ruleIds}`);
      lines.push("");
    }
  }

  // Activity Breakdown
  lines.push("## Activity Breakdown");
  lines.push("");
  lines.push("| Action Type | Count |");
  lines.push("|---|---|");

  const sortedTypes = Object.entries(data.activity.byType)
    .sort(([, a], [, b]) => (b as number) - (a as number));

  for (const [type, count] of sortedTypes) {
    lines.push(`| ${type} | ${count} |`);
  }
  lines.push("");

  // Status Breakdown
  lines.push("## Outcome Status");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("|---|---|");

  for (const [status, count] of Object.entries(data.activity.byStatus)) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push("");

  // Consistency
  lines.push("## Consistency");
  lines.push(`- Claims filed: ${data.consistency.totalClaims}`);
  lines.push(`- Executions logged: ${data.consistency.totalExecutions}`);
  lines.push(`- Score: ${data.consistency.consistencyScore}/100`);

  if (data.consistency.topFindings.length > 0) {
    lines.push("");
    lines.push("### Findings");
    for (const finding of data.consistency.topFindings) {
      lines.push(`- **${finding.type}** (${finding.severity}): ${finding.description}`);
    }
  }
  lines.push("");

  // Timeline
  if (data.timeline.length > 0) {
    lines.push("## Timeline (highlights only)");
    lines.push("");
    lines.push("| Time | Action | Target | Risk |");
    lines.push("|---|---|---|---|");

    for (const item of data.timeline) {
      const time = formatTime(item.ts);
      const date = formatDate(item.ts);
      const emoji = riskEmoji(item.risk);
      lines.push(
        `| ${date} ${time} | ${item.action} | ${truncate(item.target, 35)} | ${item.risk} ${emoji} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
