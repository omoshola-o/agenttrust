import type { Command } from "commander";
import { Ledger, resolveWorkspace } from "../../src/ledger/ledger.js";
import { parseTimeRange } from "../../src/query/filters.js";
import { RuleEngine } from "../../src/analyzer/engine.js";
import { loadPreset, loadRuleConfig, mergeConfigs } from "../../src/analyzer/config-loader.js";
import { getRuleById } from "../../src/analyzer/rules/index.js";
import { DEFAULT_CONFIG } from "../../src/analyzer/types.js";
import type { RuleEngineConfig, RuleSeverity, RuleCategory } from "../../src/analyzer/types.js";
import { formatEntriesTable } from "../formatters/table.js";
import { colorizeRisk, colorizeSeverity, icons } from "../formatters/color.js";
import Table from "cli-table3";

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

export function registerAuditCommand(program: Command): void {
  program
    .command("audit")
    .description("Run risk detection rules against the ledger")
    .option("--preset <name>", "Use a rule preset (default/strict/minimal)")
    .option("--config <path>", "Path to a custom YAML rule config")
    .option("--rules <ids>", "Comma-separated list of specific rule IDs to run")
    .option("--category <cat>", "Only run rules in this category")
    .option("--severity <level>", "Only show matches at or above this severity")
    .option("-l, --last <time>", "Time range (e.g. 24h, 7d)", "24h")
    .option("--flag-risky", "Only show auto-flagged entries (legacy mode)")
    .option("--above <score>", "Minimum risk score for legacy mode", "7")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      async (opts: {
        preset?: string;
        config?: string;
        rules?: string;
        category?: string;
        severity?: string;
        last: string;
        flagRisky?: boolean;
        above: string;
        workspace?: string;
      }) => {
        const workspace = await resolveWorkspace(opts.workspace);
        const ledger = new Ledger({ workspacePath: workspace });
        const timeRange = parseTimeRange(opts.last);

        // Legacy mode: simple threshold filter
        if (opts.flagRisky && !opts.preset && !opts.rules && !opts.category) {
          const threshold = parseInt(opts.above, 10);
          const result = await ledger.read({
            timeRange: timeRange ?? undefined,
            riskScoreMin: threshold,
          });

          if (!result.ok) {
            console.error(`${icons.fail} Failed to read ledger: ${result.error}`);
            process.exitCode = 1;
            return;
          }

          const entries = result.value.filter((e) => e.risk.autoFlagged);
          console.log(formatEntriesTable(entries));
          console.log(`\n${entries.length} auto-flagged entries (last ${opts.last}, score >= ${threshold})`);
          return;
        }

        // Build rule engine config
        let config: RuleEngineConfig = DEFAULT_CONFIG;
        if (opts.preset) {
          try {
            config = loadPreset(opts.preset as "default" | "strict" | "minimal");
          } catch {
            console.error(`${icons.fail} Unknown preset: ${opts.preset}`);
            process.exitCode = 1;
            return;
          }
        }
        if (opts.config) {
          try {
            const userConfig = loadRuleConfig(opts.config);
            config = mergeConfigs(config, userConfig);
          } catch (err) {
            console.error(`${icons.fail} Failed to load config: ${(err as Error).message}`);
            process.exitCode = 1;
            return;
          }
        }

        // If specific rules requested, disable all others
        if (opts.rules) {
          const requestedIds = opts.rules.split(",").map((s) => s.trim());
          const overrides: Record<string, boolean> = {};
          for (const id of requestedIds) {
            if (!getRuleById(id)) {
              console.error(`${icons.fail} Unknown rule: ${id}`);
              process.exitCode = 1;
              return;
            }
            overrides[id] = true;
          }
          // Disable all rules first, then enable requested ones
          const allRuleIds = new RuleEngine().getAllRules().map((r) => r.id);
          for (const id of allRuleIds) {
            if (!overrides[id]) {
              overrides[id] = false;
            }
          }
          config = mergeConfigs(config, { ruleOverrides: overrides });
        }

        // If category filter, disable rules outside category
        if (opts.category) {
          const cat = opts.category as RuleCategory;
          const overrides: Record<string, boolean> = { ...config.ruleOverrides };
          const engine = new RuleEngine();
          for (const rule of engine.getAllRules()) {
            if (rule.category !== cat) {
              overrides[rule.id] = false;
            }
          }
          config = mergeConfigs(config, { ruleOverrides: overrides });
        }

        // Read entries
        const result = await ledger.read({
          timeRange: timeRange ?? undefined,
        });

        if (!result.ok) {
          console.error(`${icons.fail} Failed to read ledger: ${result.error}`);
          process.exitCode = 1;
          return;
        }

        const entries = result.value;

        // Read claims for context
        let claims;
        try {
          const claimsResult = await ledger.readClaims({
            timeRange: timeRange ?? undefined,
          });
          if (claimsResult.ok) {
            claims = claimsResult.value;
          }
        } catch {
          // Claims are optional for audit
        }

        // Run rule engine
        const engine = new RuleEngine(undefined, config);
        const report = engine.evaluateBatch(entries, claims);

        // Filter by severity if requested
        let filteredMatches = report.matches;
        if (opts.severity) {
          const minSev = opts.severity as RuleSeverity;
          const severityRank: Record<string, number> = {
            critical: 0,
            high: 1,
            medium: 2,
            low: 3,
          };
          const minRank = severityRank[minSev] ?? 3;
          filteredMatches = filteredMatches.filter((m) =>
            m.ruleMatches.some((rm) => (severityRank[rm.severity] ?? 3) <= minRank),
          );
        }

        // Output header
        const presetLabel = opts.preset ?? "default";
        const enabledCount = engine.getEnabledRules().length;
        console.log("\nAgentTrust Risk Audit");
        console.log(`Period: last ${opts.last} | Preset: ${presetLabel} | Rules: ${enabledCount} enabled\n`);

        if (filteredMatches.length === 0) {
          console.log(`${icons.pass} No rule matches found.`);
          console.log(`\n${report.entriesEvaluated} entries evaluated`);
          return;
        }

        // Print matches
        console.log(`Matches (${filteredMatches.length})\n`);
        for (const match of filteredMatches) {
          for (const rm of match.ruleMatches) {
            if (opts.severity) {
              const severityRank: Record<string, number> = {
                critical: 0,
                high: 1,
                medium: 2,
                low: 3,
              };
              const minRank = severityRank[opts.severity] ?? 3;
              if ((severityRank[rm.severity] ?? 3) > minRank) continue;
            }

            const severityLabel = colorizeSeverity(
              rm.severity as "critical" | "warning" | "info",
              rm.severity.toUpperCase(),
            );
            const rule = getRuleById(rm.ruleId);
            const ruleName = rule ? rule.name : rm.ruleId;
            const icon =
              rm.severity === "critical" || rm.severity === "high"
                ? "\uD83D\uDD34"
                : rm.severity === "medium"
                  ? "\uD83D\uDFE1"
                  : "\uD83D\uDFE2";

            console.log(`  ${icon} ${severityLabel} ${rm.ruleId} (${ruleName}) \u2014 ${rm.reason}`);
            console.log(
              `    Entry: ${match.entry.id.slice(0, 9)}... (${formatTs(match.entry.ts)}) | Risk: ${rm.riskContribution} | Labels: ${rm.labels.join(", ")}`,
            );
            if (rm.evidence) {
              const evidenceParts = Object.entries(rm.evidence)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ");
              console.log(`    Evidence: ${evidenceParts}`);
            }
            console.log("");
          }
        }

        // Summary table
        console.log("Summary");
        const summaryTable = new Table({
          colWidths: [14, 8],
        });
        summaryTable.push(
          [colorizeSeverity("critical", "Critical"), String(report.matchesBySeverity.critical)],
          [colorizeSeverity("warning", "High"), String(report.matchesBySeverity.high)],
          [colorizeSeverity("info", "Medium"), String(report.matchesBySeverity.medium)],
          ["Low", String(report.matchesBySeverity.low)],
          ["Total", String(report.totalMatches)],
        );
        console.log(summaryTable.toString());

        console.log(`\n${report.entriesEvaluated} entries evaluated`);
      },
    );
}
