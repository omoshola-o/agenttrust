import type { Command } from "commander";
import { getAllBuiltinRules, getRuleById } from "../../src/analyzer/rules/index.js";
import { loadPreset } from "../../src/analyzer/config-loader.js";
import { DEFAULT_CONFIG } from "../../src/analyzer/types.js";
import type { RiskRule, RuleEngineConfig } from "../../src/analyzer/types.js";
import { colorizeSeverity, icons } from "../formatters/color.js";
import Table from "cli-table3";

function severityOrder(s: string): number {
  switch (s) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
}

function formatRuleRow(rule: RiskRule, config: RuleEngineConfig): string[] {
  const override = config.ruleOverrides[rule.id];
  const enabled = override !== undefined ? override : rule.enabledByDefault;
  const status = enabled ? icons.pass + " enabled" : icons.fail + " disabled";
  return [
    rule.id,
    rule.name,
    rule.category,
    colorizeSeverity(rule.severity, rule.severity.toUpperCase()),
    status,
  ];
}

export function registerRulesCommand(program: Command): void {
  const rulesCmd = program
    .command("rules")
    .description("Manage risk detection rules");

  rulesCmd
    .command("list")
    .description("Show all rules and their enabled status")
    .option("--preset <name>", "Use a specific preset (default/strict/minimal)")
    .option("--category <cat>", "Filter by category")
    .option("--json", "Output as JSON for scripting")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      (opts: { preset?: string; category?: string; json?: boolean; workspace?: string }) => {
        let config = DEFAULT_CONFIG;
        if (opts.preset) {
          try {
            config = loadPreset(opts.preset as "default" | "strict" | "minimal");
          } catch {
            console.error(`${icons.fail} Unknown preset: ${opts.preset}`);
            process.exitCode = 1;
            return;
          }
        }

        let rules = getAllBuiltinRules();
        if (opts.category) {
          rules = rules.filter((r) => r.category === opts.category);
        }

        rules.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));

        const table = new Table({
          head: ["ID", "Name", "Category", "Severity", "Status"],
          colWidths: [12, 32, 16, 12, 14],
          wordWrap: true,
        });

        for (const rule of rules) {
          table.push(formatRuleRow(rule, config));
        }

        if (opts.json) {
          const json = rules.map((r) => {
            const override = config.ruleOverrides[r.id];
            const enabled = override !== undefined ? override : r.enabledByDefault;
            return {
              id: r.id,
              name: r.name,
              category: r.category,
              severity: r.severity,
              enabled,
              description: r.description,
            };
          });
          console.log(JSON.stringify(json, null, 2));
          return;
        }

        const presetLabel = opts.preset ?? "default";
        console.log(`\nAgentTrust Risk Rules (preset: ${presetLabel})\n`);
        console.log(table.toString());

        const enabledCount = rules.filter((r) => {
          const override = config.ruleOverrides[r.id];
          return override !== undefined ? override : r.enabledByDefault;
        }).length;
        console.log(`\n${enabledCount}/${rules.length} rules enabled`);
      },
    );

  rulesCmd
    .command("info <rule-id>")
    .description("Show detailed information about a specific rule")
    .action((ruleId: string) => {
      const rule = getRuleById(ruleId);
      if (!rule) {
        console.error(`${icons.fail} Unknown rule: ${ruleId}`);
        process.exitCode = 1;
        return;
      }

      console.log(`\nRule: ${rule.id}`);
      console.log(`Name: ${rule.name}`);
      console.log(`Category: ${rule.category}`);
      console.log(`Severity: ${colorizeSeverity(rule.severity, rule.severity.toUpperCase())}`);
      console.log(`Enabled by default: ${rule.enabledByDefault ? "yes" : "no"}`);
      console.log(`Description: ${rule.description}`);
    });

  rulesCmd
    .command("preset <name>")
    .description("Show configuration for a preset (default/strict/minimal)")
    .action((name: string) => {
      try {
        const config = loadPreset(name as "default" | "strict" | "minimal");
        console.log(`\nPreset: ${name}`);
        console.log(`Risk Threshold: ${config.riskThreshold}`);
        console.log(`Max Actions/Min: ${config.maxActionsPerMinute}`);
        console.log(`Sensitive Paths: ${config.sensitivePathPatterns.length} patterns`);
        console.log(`Sensitive Domains: ${config.sensitiveDomains.join(", ")}`);

        const overrides = Object.entries(config.ruleOverrides);
        if (overrides.length > 0) {
          console.log(`\nRule Overrides:`);
          for (const [id, enabled] of overrides) {
            console.log(`  ${id}: ${enabled ? "enabled" : "disabled"}`);
          }
        }
      } catch {
        console.error(`${icons.fail} Unknown preset: ${name}`);
        console.error("Available presets: default, strict, minimal");
        process.exitCode = 1;
      }
    });
}
